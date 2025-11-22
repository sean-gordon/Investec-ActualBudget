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
const SCRIPT_VERSION = "2.3.0 - Debug Mode";

// --- Middleware ---
app.use(cors());
app.use(bodyParser.json());

// Request logging for debug
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url}`);
  next();
});

// --- State ---
let currentTask = null;
let isProcessing = false;
let logs = [];
const MAX_LOGS = 100;

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
  if (sanitizedConfig.actualServerUrl && sanitizedConfig.actualServerUrl.endsWith('/')) {
    sanitizedConfig.actualServerUrl = sanitizedConfig.actualServerUrl.slice(0, -1);
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(sanitizedConfig, null, 2));
  setupCron(sanitizedConfig.syncSchedule);
};

// --- Logic ---
const getInvestecToken = async (clientId, secretId, apiKey) => {
  const authString = `${clientId}:${secretId}`;
  const base64Auth = Buffer.from(authString).toString('base64');
  
  const response = await fetch("https://openapi.investec.com/identity/v2/oauth2/token", {
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
  const response = await fetch("https://openapi.investec.com/za/pb/v1/accounts", {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  });
  if (!response.ok) throw new Error(`Get Accounts failed: ${await response.text()}`);
  const data = await response.json();
  if (!data?.data?.accounts) throw new Error("Invalid account data received");
  return data.data.accounts; 
};

const getTransactions = async (token, accountId, fromDate, toDate) => {
  const url = `https://openapi.investec.com/za/pb/v1/accounts/${accountId}/transactions?fromDate=${fromDate}&toDate=${toDate}`;
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

  const safeDesc = (t.description || '').replace(/[^a-z0-9]/gi, '').substring(0, 30);
  const importId = `${t.accountId}:${t.postedOrder ?? 0}:${date}:${Math.abs(amount)}:${safeDesc}`;

  return {
    date: date,
    amount: amount, 
    payee_name: t.description,
    imported_payee: t.description,
    notes: notes,
    imported_id: importId, 
    cleared: true,
  };
};

const runSync = async () => {
  if (isProcessing) {
    addLog('Sync already in progress.', 'info');
    return;
  }
  
  const config = loadConfig();
  
  if (!config.investecClientId || !config.actualServerUrl || !config.actualBudgetId) {
    addLog('Missing configuration. Check settings.', 'error');
    return;
  }

  isProcessing = true;
  addLog(`Starting sync process (Server v${SCRIPT_VERSION})`, 'info');

  try {
    // 1. Investec
    addLog('Authenticating with Investec...', 'info');
    const token = await getInvestecToken(config.investecClientId, config.investecSecretId, config.investecApiKey);
    addLog('Investec Authenticated.', 'success');

    const investecAccounts = await getInvestecAccounts(token);
    addLog(`Found ${investecAccounts.length} Investec accounts.`, 'info');

    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 1);
    const fromStr = startDate.toISOString().split('T')[0];
    const toStr = endDate.toISOString().split('T')[0];

    // 2. Actual Budget Init
    addLog(`Initializing Actual API (Target: ${config.actualServerUrl})...`, 'info');
    await actual.init({ dataDir: ACTUAL_DATA_DIR });

    // 3. Actual Budget Download
    addLog(`Downloading Budget ID: ${config.actualBudgetId}...`, 'info');
    try {
      await actual.downloadBudget(config.actualBudgetId, {
        password: config.actualPassword,
        serverURL: config.actualServerUrl
      });
      addLog('Budget downloaded/cached successfully.', 'success');
    } catch (e) {
      throw new Error(`Actual Budget Download Failed: ${e.message}. Ensure Server URL is reachable from Docker.`);
    }

    const actualAccounts = await actual.getAccounts();
    
    let totalImported = 0;

    // 4. Loop Accounts
    for (const invAcc of investecAccounts) {
      const invName = invAcc.accountName;
      const invId = invAcc.accountId;

      // Match Account
      const matchedActualAccount = actualAccounts.find(a => 
        a.name.toLowerCase() === invName.toLowerCase() || 
        a.name.toLowerCase().includes(invName.toLowerCase())
      );

      if (!matchedActualAccount) {
        addLog(`SKIPPING: No Actual account matches "${invName}".`, 'error');
        continue;
      }

      try {
        const rawTxs = await getTransactions(token, invId, fromStr, toStr);
        const actualTxs = rawTxs.map(transformTransaction);
        addLog(`Account "${invName}": Found ${actualTxs.length} transactions to process.`, 'info');

        if (actualTxs.length > 0) {
          const BATCH_SIZE = 500;
          for (let i = 0; i < actualTxs.length; i += BATCH_SIZE) {
             const batch = actualTxs.slice(i, i + BATCH_SIZE);
             const result = await actual.importTransactions(matchedActualAccount.id, batch);
             
             // Result handling for verbose logging
             const added = result?.added?.length || 0;
             const updated = result?.updated?.length || 0;
             totalImported += added;
             
             if (added > 0 || updated > 0) {
               addLog(`  -> Batch imported: ${added} added, ${updated} updated.`, 'info');
             }
          }
        }
      } catch (e) {
        addLog(`Error processing ${invName}: ${e.message}`, 'error');
      }
    }

    // 5. Sync
    addLog('Pushing changes to Actual Server...', 'info');
    await actual.sync();
    addLog(`Sync process complete. Total new transactions: ${totalImported}`, 'success');

  } catch (e) {
    addLog(`CRITICAL SYNC FAILURE: ${e.message}`, 'error');
    console.error(e);
  } finally {
    try {
      await actual.shutdown();
      addLog('Actual API shutdown complete.', 'info');
    } catch (e) {
      console.error("Shutdown error:", e);
    }
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

// Health check includes version to verify docker build status
app.get('/api/health', (req, res) => res.json({ status: 'ok', version: SCRIPT_VERSION }));
app.get('/api/config', (req, res) => res.json(loadConfig()));
app.post('/api/config', (req, res) => { saveConfig(req.body); res.json({ status: 'ok' }); });
app.post('/api/sync', (req, res) => { runSync(); res.json({ status: 'ok' }); });
app.get('/api/logs', (req, res) => res.json(logs));

// Static serving
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
