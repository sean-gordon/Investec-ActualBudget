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
  
  // Sanitize: Trim whitespace from strings to prevent copy-paste errors
  const sanitizedConfig = { ...newConfig };
  Object.keys(sanitizedConfig).forEach(key => {
    if (typeof sanitizedConfig[key] === 'string') {
      sanitizedConfig[key] = sanitizedConfig[key].trim();
    }
  });

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
  let amount = t.amount * 100; 
  if (t.type === 'DEBIT') {
    amount = -Math.abs(amount);
  } else {
    amount = Math.abs(amount);
  }
  
  const date = t.postingDate || t.transactionDate;
  
  return {
    date: date,
    amount: Math.round(amount), 
    payee_name: t.description,
    imported_payee: t.description,
    notes: `Type: ${t.transactionType} | Ref: ${t.cardNumber || 'N/A'}`,
    imported_id: `${t.accountId}:${t.postedOrder || 0}:${date}:${Math.abs(amount)}`, 
    cleared: true,
  };
};

const runSync = async () => {
  if (isProcessing) {
    addLog('Sync already in progress.', 'info');
    return;
  }
  
  const config = loadConfig();
  
  // Detailed validation
  const missingInvestec = [];
  if (!config.investecClientId) missingInvestec.push('Client ID');
  if (!config.investecSecretId) missingInvestec.push('Secret ID');
  if (!config.investecApiKey) missingInvestec.push('API Key');
  
  if (missingInvestec.length > 0) {
    addLog(`Sync skipped: Missing Investec credentials: ${missingInvestec.join(', ')}`, 'error');
    return;
  }

  const missingActual = [];
  if (!config.actualServerUrl) missingActual.push('Server URL');
  if (!config.actualBudgetId) missingActual.push('Budget ID');

  if (missingActual.length > 0) {
     addLog(`Sync skipped: Missing Actual Budget settings: ${missingActual.join(', ')}`, 'error');
     return;
  }

  isProcessing = true;
  addLog('Starting sync process...', 'info');

  try {
    // 1. Get Investec Data
    const token = await getInvestecToken(config.investecClientId, config.investecSecretId, config.investecApiKey);
    addLog('Investec authenticated.', 'success');

    const investecAccounts = await getInvestecAccounts(token);
    addLog(`Found ${investecAccounts.length} Investec accounts.`, 'info');

    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 1); // Sync last 1 year
    const fromStr = startDate.toISOString().split('T')[0];
    const toStr = endDate.toISOString().split('T')[0];

    // 2. Connect to Actual Budget
    addLog(`Connecting to Actual Budget at ${config.actualServerUrl}...`, 'info');
    
    await actual.init({ dataDir: ACTUAL_DATA_DIR });
    
    try {
      await actual.downloadBudget(config.actualBudgetId, {
        password: config.actualPassword,
        serverURL: config.actualServerUrl
      });
      addLog('Budget downloaded successfully.', 'success');
    } catch (e) {
       throw new Error(`Failed to download budget: ${e.message}. Check URL (use IP not localhost) and Password.`);
    }

    const actualAccounts = await actual.getAccounts();
    
    // 3. Process Each Account
    let totalImported = 0;
    for (const invAcc of investecAccounts) {
      const invName = invAcc.accountName;
      const invId = invAcc.accountId;

      addLog(`Processing: ${invName}...`, 'info');
      
      const matchedActualAccount = actualAccounts.find(a => 
        a.name.toLowerCase() === invName.toLowerCase() || 
        a.name.toLowerCase().includes(invName.toLowerCase())
      );

      if (!matchedActualAccount) {
        addLog(`❌ No Actual account found matching "${invName}".`, 'error');
        addLog(`-> Rename an Actual account to contain "${invName}" to fix.`, 'info');
        continue;
      }

      try {
        const rawTxs = await getTransactions(token, invId, fromStr, toStr);
        const actualTxs = rawTxs.map(transformTransaction);

        if (actualTxs.length > 0) {
          await actual.importTransactions(matchedActualAccount.id, actualTxs);
          addLog(`✅ Imported ${actualTxs.length} txs into "${matchedActualAccount.name}"`, 'success');
          totalImported += actualTxs.length;
        } else {
          addLog(`No new transactions for ${invName}`, 'info');
        }
      } catch (e) {
        addLog(`Error syncing account ${invName}: ${e.message}`, 'error');
      }
    }

    addLog(`Sync complete. Total transactions: ${totalImported}`, 'success');

  } catch (e) {
    addLog(`Sync Failed: ${e.message}`, 'error');
    console.error(e);
  } finally {
    try {
      await actual.shutdown();
    } catch (e) {
      console.error("Error shutting down Actual API:", e);
    }
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
app.use(express.static(path.join(__dirname, 'dist')));

// SPA Fallback
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("Error: Application build not found. Container might be corrupt.");
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  addLog('System started.', 'success');
});