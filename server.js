import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fork } from 'child_process';
import * as actual from '@actual-app/api';
import dns from 'dns';

// --- NETWORK FIX ---
// Node 17+ prefers IPv6. In Docker/Localhost environments, this often fails if 
// the server listens on 127.0.0.1 (IPv4) but Node tries ::1.
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}

// --- CONFIGURATION ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 46490;
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'settings.json');
const ACTUAL_DATA_DIR = path.join(DATA_DIR, 'actual-data');

// Fix for self-signed certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const SCRIPT_VERSION = "3.9.0 - Remote Status Check";

// ==========================================
// WORKER PROCESS LOGIC
// ==========================================
// This block only runs when the script is spawned as a child process
if (process.env.WORKER_ACTION) {
    // Ensure TLS reject is disabled in worker too
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    const log = (msg, type = 'info') => {
        if (process.send) process.send({ type: 'log', message: msg, level: type });
    };

    const action = process.env.WORKER_ACTION;
    const payload = JSON.parse(process.env.WORKER_PAYLOAD || '{}');

    (async () => {
        try {
            log(`Worker started: ${action}`, 'info');

            // --- HELPER: Database Cleanup ---
            const cleanDataDir = () => {
                try {
                    if (fs.existsSync(ACTUAL_DATA_DIR)) {
                        fs.rmSync(ACTUAL_DATA_DIR, { recursive: true, force: true });
                    }
                    fs.mkdirSync(ACTUAL_DATA_DIR, { recursive: true });
                } catch (e) {
                    log(`Cleanup warning: ${e.message}`, 'error');
                }
            };

            // --- HELPER: Transaction Transformation ---
            const transformTransaction = (t) => {
                // 1. Amount: Actual uses integer Milliunits (e.g. 10.50 => 1050)
                let amount = Math.round(t.amount * 100);
                if (t.type === 'DEBIT') amount = -Math.abs(amount);
                else amount = Math.abs(amount);

                // 2. Date
                const date = t.postingDate || t.transactionDate || t.actionDate;

                // 3. Notes
                const notesParts = [];
                if (t.transactionType) notesParts.push(`Type: ${t.transactionType}`);
                if (t.cardNumber) notesParts.push(`Ref: ${t.cardNumber}`);
                const notes = notesParts.join(' | ');

                // 4. Description & ID
                const payee = t.description || 'Unknown Payee';
                const safeDesc = payee.replace(/[^a-z0-9]/gi, '').substring(0, 30);
                
                // CRITICAL: Deduplication Logic
                // We use postedOrder if it exists (0 is valid!). If not, we use description/amount.
                const orderSuffix = (t.postedOrder !== undefined && t.postedOrder !== null) 
                    ? `:${t.postedOrder}` 
                    : `:${Math.abs(amount)}`; // Fallback to amount if no order (less precise but safe)

                const importId = `${t.accountId}:${date}:${safeDesc}${orderSuffix}`;

                return {
                    date,
                    amount,
                    payee_name: payee,
                    imported_payee: payee,
                    notes,
                    imported_id: importId,
                    cleared: true,
                };
            };

            // --- HELPER: Investec Fetch ---
            const fetchInvestec = async (config) => {
                const baseUrl = process.env.INVESTEC_BASE_URL || "https://openapi.investec.com";
                
                // 1. Auth
                const authString = `${config.investecClientId}:${config.investecSecretId}`;
                const base64Auth = Buffer.from(authString).toString('base64');
                const authRes = await fetch(`${baseUrl}/identity/v2/oauth2/token`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${base64Auth}`,
                        'x-api-key': config.investecApiKey,
                        'Content-Type': 'application/x-www-form-urlencoded',
                    },
                    body: new URLSearchParams({ 'grant_type': 'client_credentials' }),
                });

                if (!authRes.ok) throw new Error(`Investec Auth Failed: ${authRes.statusText}`);
                const authData = await authRes.json();
                const token = authData.access_token;

                // 2. Accounts
                const accRes = await fetch(`${baseUrl}/za/pb/v1/accounts`, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
                });
                const accData = await accRes.json();
                const accounts = accData?.data?.accounts || [];

                return { token, accounts, baseUrl };
            };


            // --- ACTION: TEST INVESTEC ---
            if (action === 'test-investec') {
                const data = await fetchInvestec(payload);
                process.send({ type: 'result', success: true, message: `Success! Found ${data.accounts.length} accounts.` });
                return;
            }

            // --- ACTION: TEST ACTUAL / SYNC ---
            if (action === 'test-actual' || action === 'sync') {
                
                // --- SANITIZATION ---
                const rawUrl = payload.actualServerUrl || '';
                const serverUrl = rawUrl.replace(/\/$/, '').trim(); 
                const rawPass = payload.actualPassword || '';
                const password = rawPass.trim();
                const rawId = payload.actualBudgetId || '';
                const budgetId = rawId.trim();

                if (!serverUrl || !budgetId) {
                    throw new Error("Missing Server URL or Budget ID");
                }

                // Debug Log (Masked & Length Checked)
                const maskedPass = password ? `${password.substring(0,2)}***${password.slice(-2)}` : '(none)';
                log(`Config: URL=${serverUrl} | ID_Len=${budgetId.length} | ID=${budgetId.substring(0,8)}...`, 'info');

                // Validate UUID format (Simple regex)
                const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                if (!uuidRegex.test(budgetId)) {
                    log(`⚠️ WARNING: Sync ID format looks incorrect. It should be a UUID.`, 'error');
                }

                // 1. HTTP Network Diagnostic (Application Level Check)
                log(`Network Check: ${serverUrl}/info...`, 'info');
                try {
                    const infoRes = await fetch(`${serverUrl}/info`);
                    if (!infoRes.ok) {
                        const text = await infoRes.text();
                        throw new Error(`Server returned ${infoRes.status}: ${text}`);
                    }
                    const infoData = await infoRes.json().catch(() => ({}));
                    log(`Server reachable. Type: ${infoData.type || 'unknown'}`, 'success');
                } catch (err) {
                    throw new Error(`Network Error: Cannot reach ${serverUrl}. Is the server running? Details: ${err.message}`);
                }

                // 2. Clean Start
                cleanDataDir();
                log(`Initializing API Engine...`, 'info');
                await actual.init({ dataDir: ACTUAL_DATA_DIR, serverURL: serverUrl });
                
                // FORCE: Set Server URL explicitly again to be absolutely sure
                try { await actual.setServerURL(serverUrl); } catch(e) {}

                // 3. Download
                log(`Fetching budget context (Required for Transaction Merge)...`, 'info');
                
                try {
                    // Password handling: "" should be passed as undefined
                    const finalPass = password && password.length > 0 ? password : undefined;
                    await actual.downloadBudget(budgetId, { password: finalPass });
                } catch (dlErr) {
                    // RETRY LOGIC: If password was provided, try without it
                    if (password && password.length > 0) {
                        log(`First attempt failed. Retrying WITHOUT password...`, 'info');
                        try {
                            cleanDataDir(); // Reset data again
                            await actual.init({ dataDir: ACTUAL_DATA_DIR, serverURL: serverUrl }); // Re-init
                            try { await actual.setServerURL(serverUrl); } catch(e) {}
                            await actual.downloadBudget(budgetId); // No password
                            log(`⚠️ SUCCESS! Connected without password. Please CLEAR the password field in settings.`, 'success');
                        } catch (retryErr) {
                             log(`Retry failed: ${retryErr.message}`, 'error');
                             if (retryErr.message.includes('Could not get remote files')) {
                                throw new Error(`SERVER ERROR: The server cannot find budget file "${budgetId}".\n\n⚠️ VERIFY STATUS: Go to "File > Close File" in Actual. Is the file "Local" or "Remote"?\nIf "Local", you must Export -> Close -> Import (Actual Zip) to make it Remote.`);
                             }
                             throw retryErr;
                        }
                    } else {
                        // Log raw error for debugging
                        log(`Raw API Error: ${JSON.stringify(dlErr, Object.getOwnPropertyNames(dlErr))}`, 'error');
                        if (dlErr.message.includes('Could not get remote files')) {
                            throw new Error(`SERVER ERROR: The server cannot find budget file "${budgetId}".\n\n⚠️ VERIFY STATUS: Go to "File > Close File" in Actual. Is the file "Local" or "Remote"?\nIf "Local", you must Export -> Close -> Import (Actual Zip) to make it Remote.`);
                        }
                        throw new Error(`Download Failed. ${dlErr.message}`);
                    }
                }

                if (action === 'test-actual') {
                    process.send({ type: 'result', success: true, message: "Connection verified! Ready to merge transactions." });
                    return;
                }

                // --- SYNC LOGIC ---
                log('Actual Budget context loaded.', 'success');
                
                // Fetch Investec
                log('Fetching Investec data...', 'info');
                const investecData = await fetchInvestec(payload);
                log(`Found ${investecData.accounts.length} bank accounts.`, 'info');

                const endDate = new Date();
                const startDate = new Date();
                startDate.setFullYear(startDate.getFullYear() - 1);
                const fromStr = startDate.toISOString().split('T')[0];
                const toStr = endDate.toISOString().split('T')[0];

                const actualAccounts = await actual.getAccounts();
                let totalImported = 0;

                for (const invAcc of investecData.accounts) {
                    const invName = invAcc.accountName;
                    const matchedAccount = actualAccounts.find(a => 
                        a.name.toLowerCase().trim() === invName.toLowerCase().trim() ||
                        a.name.toLowerCase().includes(invName.toLowerCase())
                    );

                    if (!matchedAccount) {
                        log(`Skipping "${invName}" (No match in Actual)`, 'info');
                        continue;
                    }

                    // Get Txs
                    const txUrl = `${investecData.baseUrl}/za/pb/v1/accounts/${invAcc.accountId}/transactions?fromDate=${fromStr}&toDate=${toStr}`;
                    const txRes = await fetch(txUrl, {
                        headers: { 'Authorization': `Bearer ${investecData.token}`, 'Accept': 'application/json' },
                    });
                    const txData = await txRes.json();
                    const rawTxs = (txData?.data?.transactions || []).map(t => ({ ...t, accountId: invAcc.accountId }));

                    if (rawTxs.length > 0) {
                        const actualTxs = rawTxs.map(transformTransaction);
                        log(`Merging ${actualTxs.length} transactions into "${matchedAccount.name}"...`, 'info');
                        const result = await actual.importTransactions(matchedAccount.id, actualTxs);
                        
                        const count = (result?.added?.length || 0) + (result?.updated?.length || 0);
                        if (count > 0) {
                            log(`✅ Successfully added ${count} new transactions.`, 'success');
                            totalImported += count;
                        } else {
                            log(`No new transactions to add (Duplicates ignored).`, 'info');
                        }
                    }
                }

                if (totalImported > 0) {
                    log('Pushing new transactions to server...', 'info');
                    await actual.sync(); // Client push to server
                    log(`Sync Complete. Total ${totalImported} transactions added.`, 'success');
                } else {
                    log('Sync Complete. No data changes needed.', 'info');
                }
            }

        } catch (e) {
            let msg = e.message;
            
            log(`ERROR: ${msg}`, 'error');
            if (process.send) process.send({ type: 'result', success: false, message: msg });
            process.exit(1);
        } finally {
            try { await actual.shutdown(); } catch(e) {}
            process.exit(0);
        }
    })();
} else {

// ==========================================
// MAIN SERVER PROCESS
// ==========================================

const app = express();

// --- STATE ---
let isProcessing = false;
let logs = [];
let lastSyncTime = null;
const MAX_LOGS = 100;
let currentTask = null;

const addLog = (message, type = 'info') => {
    const entry = { timestamp: Date.now(), message, type };
    logs.push(entry);
    if (logs.length > MAX_LOGS) logs.shift();
    // Console output for Docker logs
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    console.log(`${icon} ${message}`);
};

// --- CONFIG UTILS ---
const ensureDataDir = () => {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
};
const loadConfig = () => {
    ensureDataDir();
    if (fs.existsSync(CONFIG_FILE)) {
        try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch (e) {}
    }
    return {};
};
const saveConfig = (cfg) => {
    ensureDataDir();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    setupCron(cfg.syncSchedule);
};

// --- WORKER SPAWNER ---
const spawnWorker = (action, payload) => {
    return new Promise((resolve) => {
        const child = fork(__filename, {
            env: { 
                ...process.env, 
                WORKER_ACTION: action,
                WORKER_PAYLOAD: JSON.stringify(payload)
            }
        });

        child.on('message', (msg) => {
            if (msg.type === 'log') addLog(msg.message, msg.level);
            if (msg.type === 'result') resolve(msg);
        });

        child.on('exit', (code) => {
            if (code !== 0) resolve({ success: false, message: "Process failed unexpectedly" });
            else resolve({ success: true });
        });
    });
};

// --- ROUTES ---
app.use(cors());
app.use(bodyParser.json());

app.get('/api/status', (req, res) => res.json({ 
    isProcessing, 
    lastSyncTime, 
    version: SCRIPT_VERSION,
    budgetLoaded: !!loadConfig().actualBudgetId 
}));
app.get('/api/logs', (req, res) => res.json(logs));
app.get('/api/config', (req, res) => res.json(loadConfig()));
app.post('/api/config', (req, res) => { saveConfig(req.body); res.json({ status: 'ok' }); });

// 1. TEST INVESTEC
app.post('/api/test/investec', async (req, res) => {
    const result = await spawnWorker('test-investec', req.body);
    res.json(result);
});

// 2. TEST ACTUAL
app.post('/api/test/actual', async (req, res) => {
    if (isProcessing) return res.json({ success: false, message: "Sync in progress" });
    const result = await spawnWorker('test-actual', req.body);
    res.json(result);
});

// 3. SYNC
const runSync = async () => {
    if (isProcessing) { addLog("Sync skipped (already running)", "info"); return; }
    
    const config = loadConfig();
    if (!config.investecClientId || !config.actualServerUrl) {
        addLog("Config missing", "error");
        return;
    }

    isProcessing = true;
    addLog("Starting Isolated Transaction Merge...", "info");
    
    try {
        await spawnWorker('sync', config);
        lastSyncTime = Date.now();
    } catch (e) {
        addLog("Sync spawn error", "error");
    } finally {
        isProcessing = false;
    }
};

app.post('/api/sync', (req, res) => {
    if (isProcessing) return res.status(409).json({ status: 'busy' });
    runSync(); // Fire and forget
    res.json({ status: 'started' });
});

// --- CRON ---
const setupCron = (schedule) => {
    if (currentTask) { currentTask.stop(); currentTask = null; }
    if (schedule && cron.validate(schedule)) {
        currentTask = cron.schedule(schedule, () => runSync());
        addLog(`Schedule updated: ${schedule}`, 'info');
    }
};

// --- INIT ---
const initialConfig = loadConfig();
setupCron(initialConfig.syncSchedule);

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
    const p = path.join(__dirname, 'dist', 'index.html');
    if (fs.existsSync(p)) res.sendFile(p);
    else res.send('Investec Sync Server Running (Build pending)');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server v${SCRIPT_VERSION} listening on ${PORT}`);
    addLog(`System Online. v${SCRIPT_VERSION}`, 'success');
});

} // End Main Process
