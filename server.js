import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as actual from '@actual-app/api';

// --- setup ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 46490;
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'settings.json');
const ACTUAL_DATA_DIR = path.join(DATA_DIR, 'actual-data');

// VERSION TRACKING
const SCRIPT_VERSION = "2.8.0 - Stable Network";

// --- Global Error Handlers ---
process.on('uncaughtException', (err) => {
  console.error('CRITICAL: Uncaught Exception:', err);
  // Attempt to log if logs array exists
  try {
    const entry = { timestamp: Date.now(), message: `System Critical: ${err.message}`, type: 'error' };
    if (typeof logs !== 'undefined') logs.push(entry);
  } catch (e) {}
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('CRITICAL: Unhandled Rejection:', reason);
});

// --- Middleware ---
app.use(cors());
app.use(bodyParser.json());

// --- State ---
let currentTask = null;
let isProcessing = false;
let logs = [];
let lastSyncTime = null;
const MAX_LOGS = 100;

// Singleton State for Actual API
let isActualInitialized = false;
let loadedBudgetId = null;

const addLog = (message, type = 'info') => {
  const entry = { timestamp: Date.now(), message, type };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs.shift();
  
  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  if (type === 'error' || type === 'success') {
    console.log(`${icon} [${type.toUpperCase()}] ${message}`);
  }
};

// --- Config Management ---
const ensureDataDir = () => {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ACTUAL_DATA_DIR)) fs.mkdirSync(ACTUAL_DATA_DIR, { recursive: true });
};

const loadConfig = () => {
  ensureDataDir();
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    } catch (e) {
      console.error("Failed to read config file", e);
    }
  }
  return {
    investecClientId: '',
    investecSecretId: '',
    investecApiKey: '',
    actualServerUrl: '',
    actualBudgetId: '',
    actualPassword: '',
    syncSchedule: '0 0 * * *'
  };
};

const saveConfig = (newConfig) => {
  ensureDataDir();
  const sanitizedConfig = { ...newConfig };
  Object.keys(sanitizedConfig).forEach(key => {
    if (typeof sanitizedConfig[key] === 'string') {
      sanitizedConfig[key] = sanitizedConfig[key].trim();
    }
  });
  
  if (sanitizedConfig.actualServerUrl) {
    sanitizedConfig.actualServerUrl = sanitizedConfig.actualServerUrl.replace(/\/+$/, "");
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(sanitizedConfig, null, 2));
  setupCron(sanitizedConfig.syncSchedule);
};

// --- Logic ---

// Helper: Check if Actual Server is reachable before trying the heavy library
const checkServerConnectivity = async (url) => {
  try {
    // Try a lightweight fetch. Even 404 means server is reachable.
    // We try the root path.
    await fetch(url, { method: 'HEAD' });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
};

const initActualApi = async () => {
  if (isActualInitialized) return;
  
  addLog('Initializing Actual API Engine...', 'info');
  try {
    await actual.init({ dataDir: ACTUAL_DATA_DIR });
    isActualInitialized = true;
  } catch (e) {
    addLog(`Failed to init Actual API: ${e.message}`, 'error');
    // Try to cleanup if init failed halfway
    try { await actual.shutdown(); } catch(err) {}
    throw e;
  }
};

const getInvestecToken = async (clientId, secretId, apiKey) => {
  const authString = `${clientId}:${secretId}`;
  const base64Auth = Buffer.from(authString).toString('base64');
  const baseUrl = process.env.INVESTEC_BASE_URL || "https://openapi.investec.com";
  
  const response = await fetch(`${baseUrl}/identity/v2/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${base64Auth}`,
      'x-api-key': apiKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ 'grant_type': 'client_credentials' }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Investec Auth failed (${response.status}): ${text}`);
  }
  const data = await response.json();
  return data.access_token;
};

const getInvestecAccounts = async (token) => {
  const baseUrl = process.env.INVESTEC_BASE_URL || "https://openapi.investec.com";
  const response = await fetch(`${baseUrl}/za/pb/v1/accounts`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  });
  if (!response.ok) throw new Error(`Get Accounts failed: ${await response.text()}`);
  const data = await response.json();
  if (!data?.data?.accounts) throw new Error("Invalid account data received from Investec");
  return data.data.accounts; 
};

const getTransactions = async (token, accountId, fromDate, toDate) => {
  const baseUrl = process.env.INVESTEC_BASE_URL || "https://openapi.investec.com";
  const url = `${baseUrl}/za/pb/v1/accounts/${accountId}/transactions?fromDate=${fromDate}&toDate=${toDate}`;
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  });
  if (!response.ok) throw new Error(`Get Transactions failed: ${await response.text()}`);
  const data = await response.json();
  return (data?.data?.transactions || []).map(t => ({ ...t, accountId }));
};

const transformTransaction = (t) => {
  let amount = Math.round(t.amount * 100); 
  if (t.type === 'DEBIT') amount = -Math.abs(amount);
  else amount = Math.abs(amount);
  
  const date = t.postingDate || t.transactionDate;
  
  const notesParts = [];
  if (t.transactionType) notesParts.push(`Type: ${t.transactionType}`);
  if (t.cardNumber) notesParts.push(`Ref: ${t.cardNumber}`);
  const notes = notesParts.join(' | ');

  const safeDesc = (t.description || 'Unknown').replace(/[^a-z0-9 ]/gi, '').substring(0, 50);
  const importId = `${t.accountId}:${t.postedOrder ?? 0}:${date}:${Math.abs(amount)}:${safeDesc}`;

  return {
    date: date,
    amount: amount, 
    payee_name: t.description || 'Unknown Payee',
    imported_payee: t.description || 'Unknown Payee',
    notes: notes,
    imported_id: importId, 
    cleared: true,
  };
};

const runSync = async () => {
  if (isProcessing) {
    addLog("Sync ignored: Process already running.", "info");
    return;
  }
  
  const config = loadConfig();
  if (!config.investecClientId || !config.actualServerUrl || !config.actualBudgetId) {
    addLog('Configuration missing. Check settings.', 'error');
    return;
  }

  isProcessing = true;
  addLog(`Starting sync process...`, 'info');

  try {
    // --- PRE-FLIGHT: Check Server Connectivity ---
    // This fixes the "hanging" issue if Docker networking is wrong
    const connTest = await checkServerConnectivity(config.actualServerUrl);
    if (!connTest.success) {
      throw new Error(`Cannot reach Actual Server at ${config.actualServerUrl}. Error: ${connTest.error}. If running in Docker, try 'http://host.docker.internal:5006'.`);
    }

    // --- 1. Setup Actual Budget ---
    try {
      // Check if we need to reset connection (e.g. budget ID changed)
      if (loadedBudgetId && loadedBudgetId !== config.actualBudgetId) {
        addLog('Budget ID changed. Resetting connection...', 'info');
        await actual.shutdown();
        isActualInitialized = false;
        loadedBudgetId = null;
      }

      await initActualApi();

      if (!loadedBudgetId) {
        addLog(`Downloading Budget ID: ${config.actualBudgetId}...`, 'info');
        await actual.downloadBudget(config.actualBudgetId, {
          password: config.actualPassword,
          serverURL: config.actualServerUrl
        });
        loadedBudgetId = config.actualBudgetId;
        addLog('Budget downloaded successfully.', 'success');
      } else {
        // Sync upstream changes first
        await actual.sync();
      }
    } catch (e) {
      // CRITICAL: If Actual fails, we must shutdown to release locks
      addLog(`Actual Budget Error: ${e.message}`, 'error');
      console.error("Actual API Stack:", e);
      try { await actual.shutdown(); } catch(err) {}
      isActualInitialized = false; 
      loadedBudgetId = null;
      throw new Error("Failed to connect/sync with Actual Budget."); // Stop execution
    }

    // --- 2. Fetch Investec ---
    let investecAccounts = [];
    let token = '';
    try {
      addLog('Connecting to Investec...', 'info');
      token = await getInvestecToken(config.investecClientId, config.investecSecretId, config.investecApiKey);
      investecAccounts = await getInvestecAccounts(token);
      addLog(`Found ${investecAccounts.length} Investec accounts.`, 'info');
    } catch (e) {
      addLog(`Investec API Error: ${e.message}`, 'error');
      throw new Error("Failed to fetch data from Investec.");
    }

    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 1);
    const fromStr = startDate.toISOString().split('T')[0];
    const toStr = endDate.toISOString().split('T')[0];

    // --- 3. Process Accounts ---
    const actualAccounts = await actual.getAccounts();
    let totalImported = 0;
    let processedAccounts = 0;

    for (const invAcc of investecAccounts) {
      const invName = invAcc.accountName;
      const matchedActualAccount = actualAccounts.find(a => 
        a.name.toLowerCase().trim() === invName.toLowerCase().trim() || 
        a.name.toLowerCase().includes(invName.toLowerCase())
      );

      if (!matchedActualAccount) {
        addLog(`Skipping "${invName}": No matching Actual account found.`, 'info');
        continue;
      }

      try {
        const rawTxs = await getTransactions(token, invAcc.accountId, fromStr, toStr);
        if (rawTxs.length > 0) {
          const actualTxs = rawTxs.map(transformTransaction);
          
          // Import in smaller batches to avoid timeouts
          const BATCH_SIZE = 100;
          let batchCount = 0;
          
          for (let i = 0; i < actualTxs.length; i += BATCH_SIZE) {
             const batch = actualTxs.slice(i, i + BATCH_SIZE);
             const result = await actual.importTransactions(matchedActualAccount.id, batch);
             batchCount += (result?.added?.length || 0) + (result?.updated?.length || 0);
          }
          
          if (batchCount > 0) {
            addLog(`Imported ${batchCount} txs into "${matchedActualAccount.name}"`, 'info');
            totalImported += batchCount;
          }
          processedAccounts++;
        }
      } catch (e) {
        addLog(`Error processing "${invName}": ${e.message}`, 'error');
      }
    }

    if (processedAccounts > 0) {
      addLog('Pushing changes to server...', 'info');
      await actual.sync();
      addLog(`Sync complete. ${totalImported} new transactions.`, 'success');
    } else {
      addLog('Sync complete. No matches or no new data.', 'info');
    }
    
    lastSyncTime = Date.now();

  } catch (e) {
    // Log the top-level error that stopped the sync
    addLog(`❌ Sync Aborted: ${e.message}`, 'error');
  } finally {
    isProcessing = false;
  }
};

// --- Cron & Routes ---
const setupCron = (schedule) => {
  if (currentTask) { currentTask.stop(); currentTask = null; }
  if (schedule && cron.validate(schedule)) {
    currentTask = cron.schedule(schedule, () => {
      runSync().catch(err => console.error("Scheduled sync failed", err));
    });
    addLog(`Schedule set: ${schedule}`, 'info');
  }
};

const initialConfig = loadConfig();
setupCron(initialConfig.syncSchedule);

app.get('/api/health', (req, res) => res.json({ status: 'ok', version: SCRIPT_VERSION }));

app.get('/api/status', (req, res) => res.json({ 
  isProcessing, 
  lastSyncTime,
  version: SCRIPT_VERSION,
  budgetLoaded: !!loadedBudgetId
}));

app.get('/api/config', (req, res) => res.json(loadConfig()));
app.post('/api/config', (req, res) => { saveConfig(req.body); res.json({ status: 'ok' }); });

app.post('/api/sync', (req, res) => { 
  // Fire and forget, but handle the promise
  if (!isProcessing) {
    runSync().catch(e => console.error("Manual sync execution error:", e));
    res.json({ status: 'started' }); 
  } else {
    res.status(409).json({ status: 'already_running' });
  }
});

app.get('/api/logs', (req, res) => res.json(logs));

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.status(404).send("Build not found.");
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  addLog(`System initialized. v${SCRIPT_VERSION}`, 'success');
});