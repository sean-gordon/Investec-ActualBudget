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
const SCRIPT_VERSION = "2.6.0 - Robust Sync";

// --- Global Error Handlers (Prevent silent crashes) ---
process.on('uncaughtException', (err) => {
  console.error('CRITICAL: Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
});

// --- Middleware ---
app.use(cors());
app.use(bodyParser.json());

// Request logging for debug
app.use((req, res, next) => {
  if (req.url !== '/api/status' && req.url !== '/api/logs') {
    console.log(`[${req.method}] ${req.url}`);
  }
  next();
});

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
  console.log(`${icon} [${type.toUpperCase()}] ${message}`);
};

// --- Config Management ---
const ensureDataDir = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(ACTUAL_DATA_DIR)) {
    fs.mkdirSync(ACTUAL_DATA_DIR, { recursive: true });
  }
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
  
  // Remove trailing slash from URL if present
  if (sanitizedConfig.actualServerUrl) {
    sanitizedConfig.actualServerUrl = sanitizedConfig.actualServerUrl.replace(/\/+$/, "");
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(sanitizedConfig, null, 2));
  setupCron(sanitizedConfig.syncSchedule);
};

// --- Logic ---

const initActualApi = async () => {
  if (isActualInitialized) return;
  
  addLog('Initializing Actual API Engine...', 'info');
  try {
    await actual.init({ dataDir: ACTUAL_DATA_DIR });
    isActualInitialized = true;
    addLog('Actual API Engine Initialized.', 'success');
  } catch (e) {
    addLog(`Failed to init Actual API: ${e.message}`, 'error');
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
    throw new Error(`Auth failed (${response.status}): ${text}`);
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
  // Composite ID: Account + Order + Date + Amount + Description
  // Adding Description/Amount ensures uniqueness if postedOrder is not unique enough
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
    addLog('Sync request ignored: Process already running.', 'info');
    return;
  }
  
  const config = loadConfig();
  
  if (!config.investecClientId || !config.actualServerUrl || !config.actualBudgetId) {
    addLog('Configuration missing. Please check settings.', 'error');
    return;
  }

  isProcessing = true;
  addLog(`Starting sync process...`, 'info');

  try {
    // --- 1. Budget Connection (Smart Switching) ---
    
    // If the requested budget is different from the loaded one, we must reset.
    if (loadedBudgetId && loadedBudgetId !== config.actualBudgetId) {
      addLog(`Budget configuration changed. Switching from ${loadedBudgetId} to ${config.actualBudgetId}...`, 'info');
      try {
        await actual.shutdown();
      } catch (e) {
        console.warn("Shutdown warning:", e);
      }
      isActualInitialized = false;
      loadedBudgetId = null;
    }

    // Ensure engine is running
    await initActualApi();

    if (!loadedBudgetId) {
      // First time load or budget switch
      addLog(`Downloading Budget: ${config.actualBudgetId}...`, 'info');
      await actual.downloadBudget(config.actualBudgetId, {
        password: config.actualPassword,
        serverURL: config.actualServerUrl
      });
      loadedBudgetId = config.actualBudgetId;
      addLog('Budget downloaded and connected.', 'success');
    } else {
      // Already connected, just pull latest changes
      addLog('Syncing with Actual Server (Pulling)...', 'info');
      await actual.sync();
    }

    // --- 2. Investec Data Fetch ---
    addLog('Authenticating with Investec...', 'info');
    const token = await getInvestecToken(config.investecClientId, config.investecSecretId, config.investecApiKey);
    
    const investecAccounts = await getInvestecAccounts(token);
    addLog(`Found ${investecAccounts.length} Investec accounts.`, 'info');

    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 1); // Look back 1 year
    const fromStr = startDate.toISOString().split('T')[0];
    const toStr = endDate.toISOString().split('T')[0];

    // --- 3. Match and Import ---
    const actualAccounts = await actual.getAccounts();
    let totalImported = 0;
    let processedAccounts = 0;

    for (const invAcc of investecAccounts) {
      const invName = invAcc.accountName;
      const invId = invAcc.accountId;

      // Fuzzy match account name
      const matchedActualAccount = actualAccounts.find(a => 
        a.name.toLowerCase().trim() === invName.toLowerCase().trim() || 
        a.name.toLowerCase().includes(invName.toLowerCase())
      );

      if (!matchedActualAccount) {
        addLog(`Warning: No Actual Budget account matches Investec account "${invName}". Skipping.`, 'error');
        continue;
      }

      try {
        const rawTxs = await getTransactions(token, invId, fromStr, toStr);
        
        if (rawTxs.length === 0) {
           continue;
        }

        const actualTxs = rawTxs.map(transformTransaction);
        
        // Import in batches to prevent memory issues/timeouts
        const BATCH_SIZE = 200;
        let batchCount = 0;
        for (let i = 0; i < actualTxs.length; i += BATCH_SIZE) {
             const batch = actualTxs.slice(i, i + BATCH_SIZE);
             const result = await actual.importTransactions(matchedActualAccount.id, batch);
             
             const added = result?.added?.length || 0;
             const updated = result?.updated?.length || 0;
             totalImported += added;
             batchCount += added + updated;
        }
        
        if (batchCount > 0) {
            addLog(`Imported ${batchCount} txs into "${matchedActualAccount.name}"`, 'info');
        }
        processedAccounts++;

      } catch (e) {
        addLog(`Error processing account ${invName}: ${e.message}`, 'error');
      }
    }

    // --- 4. Final Sync Push ---
    if (processedAccounts > 0) {
      addLog('Pushing changes to Actual Server...', 'info');
      await actual.sync();
      addLog(`Sync complete. ${totalImported} new transactions imported.`, 'success');
    } else {
      addLog('Sync complete. No accounts processed.', 'info');
    }
    
    lastSyncTime = Date.now();

  } catch (e) {
    addLog(`CRITICAL SYNC FAILURE: ${e.message}`, 'error');
    console.error("Detailed Sync Error:", e);
    
    // Reset state on critical failure to ensure next run starts clean
    isActualInitialized = false;
    loadedBudgetId = null;
  } finally {
    isProcessing = false;
  }
};

// --- Cron & Routes ---
const setupCron = (schedule) => {
  if (currentTask) { currentTask.stop(); currentTask = null; }
  if (schedule && cron.validate(schedule)) {
    currentTask = cron.schedule(schedule, () => runSync());
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
app.post('/api/sync', (req, res) => { runSync(); res.json({ status: 'started' }); });
app.get('/api/logs', (req, res) => res.json(logs));

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.status(404).send("Build not found.");
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  addLog(`System initialized. Version: ${SCRIPT_VERSION}`, 'success');
});
