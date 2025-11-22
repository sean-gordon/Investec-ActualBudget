import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- setup ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 46490;
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'settings.json');

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
  console.log(`[${type.toUpperCase()}] ${message}`);
};

// --- Config Management ---
const ensureDataDir = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
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
    investecClientId: process.env.VITE_INVESTEC_CLIENT_ID || '',
    investecSecretId: process.env.VITE_INVESTEC_SECRET_ID || '',
    investecApiKey: process.env.VITE_INVESTEC_API_KEY || '',
    actualServerUrl: process.env.VITE_ACTUAL_SERVER_URL || '',
    actualBudgetId: process.env.VITE_ACTUAL_BUDGET_ID || '',
    actualPassword: process.env.VITE_ACTUAL_PASSWORD || '',
    syncSchedule: '0 0 * * *'
  };
};

const saveConfig = (newConfig) => {
  ensureDataDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
  setupCron(newConfig.syncSchedule);
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

  if (!response.ok) throw new Error(`Auth failed: ${await response.text()}`);
  const data = await response.json();
  return data.access_token;
};

const getAccountIds = async (token) => {
  const response = await fetch("https://openapi.investec.com/za/pb/v1/accounts", {
    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
  });
  if (!response.ok) throw new Error(`Get Accounts failed: ${await response.text()}`);
  const data = await response.json();
  if (!data?.data?.accounts) throw new Error("Invalid account data received");
  return data.data.accounts.map(acc => acc.accountId);
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
  let amount = t.amount * 100; 
  if (t.type === 'DEBIT') {
    amount = -Math.abs(amount);
  } else {
    amount = Math.abs(amount);
  }
  return {
    date: t.postingDate,
    amount: Math.round(amount), 
    payee_name: t.description,
    imported_payee: t.description,
    notes: `Type: ${t.transactionType} | Ref: ${t.cardNumber}`,
    imported_id: `${t.accountId}:${t.postedOrder}:${t.postingDate}`, 
    cleared: true,
  };
};

const pushToActual = async (serverUrl, budgetId, password, transactions) => {
  if (!serverUrl || !budgetId) return;
  
  const cleanUrl = serverUrl.replace(/\/$/, '');
  const url = `${cleanUrl}/api/v1/budgets/${budgetId}/transactions`;
  const payload = { transactions };

  const headers = { 'Content-Type': 'application/json' };
  if (password) headers['x-actual-password'] = password;

  console.log(`Attempting push to: ${url}`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Actual Sync failed (${response.status}): ${await response.text()}`);
    }
  } catch (error) {
    console.error("Push Error Detail:", error);
    throw new Error(`Connection to Actual failed at ${url}. Details: ${error.message}`);
  }
};

const runSync = async () => {
  if (isProcessing) {
    addLog('Sync already in progress.', 'info');
    return;
  }
  
  const config = loadConfig();
  if (!config.investecClientId || !config.investecApiKey) {
    addLog('Sync skipped: Missing credentials.', 'error');
    return;
  }

  isProcessing = true;
  addLog('Starting scheduled sync...', 'info');

  try {
    const token = await getInvestecToken(config.investecClientId, config.investecSecretId, config.investecApiKey);
    addLog('Investec authenticated.', 'success');

    const accounts = await getAccountIds(token);
    addLog(`Found ${accounts.length} accounts.`, 'info');

    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 5);
    const fromStr = startDate.toISOString().split('T')[0];
    const toStr = endDate.toISOString().split('T')[0];

    let allTx = [];
    for (const acc of accounts) {
      try {
        const txs = await getTransactions(token, acc, fromStr, toStr);
        allTx.push(...txs);
      } catch (e) {
        addLog(`Error fetching account ${acc}: ${e.message}`, 'error');
      }
    }
    addLog(`Fetched ${allTx.length} raw transactions.`, 'info');

    const actualTx = allTx.map(transformTransaction);

    if (config.actualServerUrl) {
      addLog(`Pushing to Actual...`, 'info');
      await pushToActual(config.actualServerUrl, config.actualBudgetId, config.actualPassword, actualTx);
      addLog(`Successfully pushed ${actualTx.length} transactions to Actual.`, 'success');
    } else {
      addLog('Actual URL not set. Skipping push.', 'info');
    }

  } catch (e) {
    addLog(`Sync Failed: ${e.message}`, 'error');
  } finally {
    isProcessing = false;
  }
};

// --- Cron ---
const setupCron = (schedule) => {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }
  
  if (schedule && cron.validate(schedule)) {
    currentTask = cron.schedule(schedule, () => {
      runSync();
    });
    addLog(`Schedule updated: ${schedule}`, 'info');
  } else {
    addLog('Schedule disabled or invalid.', 'info');
  }
};

const initialConfig = loadConfig();
setupCron(initialConfig.syncSchedule);

// --- API Routes ---

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.get('/api/config', (req, res) => {
  try {
    const config = loadConfig();
    res.json(config);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load config' });
  }
});

app.post('/api/config', (req, res) => {
  try {
    const newConfig = req.body;
    saveConfig(newConfig);
    res.json({ status: 'ok', message: 'Configuration saved' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to save config' });
  }
});

app.post('/api/sync', async (req, res) => {
  runSync();
  res.json({ status: 'ok', message: 'Sync started' });
});

app.get('/api/logs', (req, res) => {
  res.json(logs);
});

// --- Static Files ---
// Serve static files strictly from dist
app.use(express.static(path.join(__dirname, 'dist')));

// SPA Fallback - Must be the last route
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    // If index.html is missing, we can't serve the app. 
    // Returning 404 text here helps distinguish from an API 404.
    res.status(404).send("Error: Application build not found. Container might be corrupt.");
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  addLog('System started.', 'success');
});