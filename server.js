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

// Fix for self-signed certs or local network issues
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// VERSION TRACKING
const SCRIPT_VERSION = "2.15.0 - Host Network";

// --- Global Error Handlers ---
process.on('uncaughtException', (err) => {
  console.error('CRITICAL: Uncaught Exception:', err);
  try {
    if (typeof logs !== 'undefined') logs.push({ timestamp: Date.now(), message: `System Critical: ${err.message}`, type: 'error' });
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
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    
    // Ensure Actual Data Dir exists and is writable
    if (!fs.existsSync(ACTUAL_DATA_DIR)) {
        fs.mkdirSync(ACTUAL_DATA_DIR, { recursive: true });
    }
    
    // Permission Test
    const testFile = path.join(ACTUAL_DATA_DIR, 'perm-test');
    fs.writeFileSync(testFile, 'ok');
    fs.unlinkSync(testFile);
  } catch (e) {
    console.error("CRITICAL: Data directory is not writable.", e);
    addLog(`CRITICAL: Data directory permission denied: ${e.message}`, 'error');
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
  
  if (sanitizedConfig.actualServerUrl) {
    // Remove trailing slashes
    sanitizedConfig.actualServerUrl = sanitizedConfig.actualServerUrl.replace(/\/+$/, "");
  }

  fs.writeFileSync(CONFIG_FILE, JSON.stringify(sanitizedConfig, null, 2));
  setupCron(sanitizedConfig.syncSchedule);
};

// --- Helpers ---

// Investec Auth
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
    // Try to parse JSON error if possible
    try {
        const errJson = JSON.parse(text);
        throw new Error(`Investec Auth: ${errJson.error_description || errJson.message || text}`);
    } catch {
        throw new Error(`Investec Auth failed (${response.status}): ${text}`);
    }
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

// Actual Budget Helpers
const getActualServerInfo = async (serverUrl) => {
  try {
    const response = await fetch(`${serverUrl}/mode`);
    if (!response.ok) {
      return { online: false, error: `HTTP ${response.status} - ${await response.text()}` };
    }
    const mode = await response.text();
    return { online: true, mode };
  } catch (e) {
    return { online: false, error: e.message };
  }
};

const resetActualState = async () => {
  try { await actual.shutdown(); } catch(e) {}
  isActualInitialized = false;
  loadedBudgetId = null;
  
  try {
    if (fs.existsSync(ACTUAL_DATA_DIR)) {
      fs.rmSync(ACTUAL_DATA_DIR, { recursive: true, force: true });
    }
    fs.mkdirSync(ACTUAL_DATA_DIR, { recursive: true });
  } catch (e) {
    console.error("Failed to clean data dir:", e);
  }
};

const initActualApi = async (serverUrl) => {
  ensureDataDir();
  if (isActualInitialized) return;
  
  try {
    if (serverUrl) {
        fs.writeFileSync(path.join(ACTUAL_DATA_DIR, 'server-url'), serverUrl);
    }
    await actual.init({ 
      dataDir: ACTUAL_DATA_DIR,
      serverURL: serverUrl 
    });
    isActualInitialized = true;
  } catch (e) {
    try { await actual.shutdown(); } catch(err) {}
    isActualInitialized = false;
    throw e;
  }
};

// --- Data Transformation ---
// STRICT rules for Actual Budget import
const transformTransaction = (t) => {
  // 1. Amount: Actual uses integer Milliunits (e.g. 10.50 => 1050)
  // Investec provides floats. 
  let amount = Math.round(t.amount * 100); 
  
  if (t.type === 'DEBIT') {
    amount = -Math.abs(amount); // Expense
  } else {
    amount = Math.abs(amount); // Income
  }
  
  // 2. Date: ISO YYYY-MM-DD
  const date = t.postingDate || t.transactionDate || t.actionDate;
  
  // 3. Notes
  const notesParts = [];
  if (t.transactionType) notesParts.push(`Type: ${t.transactionType}`);
  if (t.cardNumber) notesParts.push(`Ref: ${t.cardNumber}`);
  const notes = notesParts.join(' | ');

  // 4. Description
  const payee = t.description || 'Unknown Payee';
  // Clean description for ID generation to ensure stability
  const safeDesc = payee.replace(/[^a-z0-9]/gi, '').substring(0, 30);
  
  // 5. Imported ID: Must be unique but deterministic
  // We use postedOrder if available (Investec stable order), otherwise fallback to composite
  const orderInfo = t.postedOrder ? `:${t.postedOrder}` : '';
  const importId = `${t.accountId}:${date}:${amount}:${safeDesc}${orderInfo}`;

  return {
    date: date,
    amount: amount, 
    payee_name: payee,
    imported_payee: payee,
    notes: notes,
    imported_id: importId, 
    cleared: true, // We assume bank API data is cleared
  };
};

// --- Routes ---

// 1. TEST INVESTEC
app.post('/api/test/investec', async (req, res) => {
    const { clientId, secretId, apiKey } = req.body;
    try {
        const token = await getInvestecToken(clientId, secretId, apiKey);
        const accounts = await getInvestecAccounts(token);
        res.json({ 
            success: true, 
            message: `Connection Successful. Found ${accounts.length} accounts.` 
        });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 2. TEST ACTUAL
app.post('/api/test/actual', async (req, res) => {
    const { serverUrl, password, budgetId } = req.body;
    
    if (isProcessing) {
        return res.json({ success: false, message: "System is busy running a sync. Wait for it to finish." });
    }

    try {
        // 1. Network Check
        const diag = await getActualServerInfo(serverUrl);
        if (!diag.online) throw new Error(`Cannot reach server: ${diag.error}`);

        // 2. Auth Check (Requires aggressive reset to not conflict with main process)
        await resetActualState();
        await initActualApi(serverUrl);
        
        await actual.downloadBudget(budgetId, {
            password: password || undefined
        });
        
        // Clean up immediately so we don't hold the lock
        await resetActualState();
        
        res.json({ success: true, message: "Connection Successful. Budget downloaded & verified." });
    } catch (e) {
        await resetActualState(); // Ensure cleanup on failure
        let msg = e.message;
        if (msg.includes('Could not get remote files')) msg = "Invalid Sync ID or Password (or server refused connection).";
        res.json({ success: false, message: msg });
    }
});


const runSync = async () => {
  if (isProcessing) {
    addLog("Sync ignored: Process already running.", "info");
    return;
  }
  
  const config = loadConfig();
  if (!config.investecClientId || !config.actualServerUrl || !config.actualBudgetId) {
    addLog('Configuration missing. Please save settings first.', 'error');
    return;
  }

  isProcessing = true;
  addLog(`Starting sync process...`, 'info');
  addLog(`Config: URL=${config.actualServerUrl} | ID=${config.actualBudgetId.substring(0,4)}...`, 'info');

  try {
    // --- 0. Diagnostic Check ---
    addLog('Running diagnostics...', 'info');
    const diag = await getActualServerInfo(config.actualServerUrl);
    if (!diag.online) {
      throw new Error(`Network Check Failed. Cannot reach Actual Server at "${config.actualServerUrl}". Details: ${diag.error}`);
    }
    addLog(`✅ Server Online. Mode: ${diag.mode}`, 'success');

    // --- 1. Setup Actual Budget ---
    try {
      // Force reset every single time to prevent "Could not get remote files" due to stale locks
      await resetActualState();

      await initActualApi(config.actualServerUrl);

      // Check budget ID format
      if (config.actualBudgetId !== config.actualBudgetId.trim()) {
         throw new Error("Budget ID contains hidden spaces. Please re-enter it in Settings.");
      }

      addLog(`Downloading Budget: ${config.actualBudgetId}...`, 'info');
      
      await actual.downloadBudget(config.actualBudgetId, {
        password: config.actualPassword || undefined
      });
      
      loadedBudgetId = config.actualBudgetId;
      addLog('Budget downloaded/connected successfully.', 'success');

    } catch (e) {
      addLog(`❌ Actual Budget Error: ${e.message}`, 'error');
      console.error("Actual API Error Detail:", e);
      
      if (e.message.includes('Could not get remote files')) {
        addLog('⚠️ CRITICAL FAILURE: Server rejected the download request.', 'error');
        addLog('1. Verify Sync ID in Actual (Settings > Advanced > Sync ID).', 'error');
        addLog('2. Verify Password (if set).', 'error');
        addLog('3. Docker: Ensure host.docker.internal is working.', 'error');
      }

      throw new Error("Failed to connect/sync with Actual Budget.");
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
    addLog(`❌ Sync Aborted: ${e.message}`, 'error');
  } finally {
    isProcessing = false;
    // Always clean up after a run in this aggressive mode
    try { await actual.shutdown(); } catch(e) {}
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