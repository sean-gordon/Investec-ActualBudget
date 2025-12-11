import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fork, exec } from 'child_process';
import * as actual from '@actual-app/api';
import dns from 'dns';

/**
 * ============================================================================
 * INVESTEC TO ACTUAL SYNC SERVER
 * ============================================================================ 
 * Architecture: "Split-Brain" / Worker Model
 * 
 * 1. Main Process: 
 *    - Runs the Express Web Server (Port 46490).
 *    - Serves the React Frontend.
 *    - Manages Configuration (settings.json) & Categories (categories.json).
 *    - Schedules Cron Jobs.
 *    - Spawns Worker Processes.
 * 
 * 2. Worker Process:
 *    - Spawns on demand (Sync or Test).
 *    - Initialises the @actual-app/api.
 *    - Connects to Investec.
 *    - Syncs Categories (Creates Groups/Categories if missing).
 *    - Syncs Transactions.
 *    - EXITS immediately after finishing.
 */

// --- NETWORK FIX ---
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}

// --- CONSTANTS & PATHS ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = process.env.PORT || 46490;
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'settings.json');
const CATEGORIES_FILE = path.join(DATA_DIR, 'categories.json');
const ACTUAL_DATA_DIR = path.join(DATA_DIR, 'actual-data');
const SCRIPT_VERSION = "6.2.2 - Git Host Path Support";

// Disable Self-Signed Cert Rejection
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// --- DEFAULT CATEGORIES ---
const DEFAULT_CATEGORIES = {
  "🏠 Home & Living": [
    "Rent / Mortgage",
    "Rates, Taxes & Levies",
    "Home Insurance",
    "Water & Electricity",
    "Internet & Mobile",
    "Home Maintenance & Repairs",
    "Security (Alarm, Armed Response, etc.)"
  ],
  "🍽️ Food & Groceries": [
    "Groceries",
    "Household Supplies (cleaning, toiletries, etc.)",
    "Eating Out",
    "Coffee / Snacks"
  ],
  "🚗 Transportation": [
    "Fuel",
    "Car Insurance",
    "Car Maintenance & Repairs",
    "Licensing & Registration",
    "E-Tolls / Tolls",
    "Uber / Bolt / Transport"
  ],
  "🧒 Children": [
    "Childcare / School Fees",
    "Clothing",
    "Toys & Activities",
    "Medical (Pediatrician, Meds)",
    "Savings for Kids (e.g., Education Fund)"
  ],
  "💊 Health & Medical": [
    "Medical Aid / Insurance",
    "Medications",
    "Doctor / Specialist Visits",
    "Dental / Optometry"
  ],
  "💼 Work & Business": [
    "Work Lunch / Travel",
    "Software / Tools",
    "Courses & Training",
    "Investment in Side Business"
  ],
  "🎉 Lifestyle & Personal": [
    "Clothing & Shoes",
    "Entertainment (movies, events, etc.)",
    "Subscriptions (Netflix, Spotify, iCloud, etc.)",
    "Hobbies",
    "Gym / Fitness"
  ],
  "💳 Debt & Obligations": [
    "Credit Card Payments",
    "Personal Loan",
    "Store Accounts (e.g., Truworths, Edgars, etc.)",
    "Other Loan Repayments"
  ],
  "💰 Savings & Investments": [
    "Emergency Fund",
    "Retirement Savings",
    "General Savings",
    "Travel Savings",
    "Long-Term Investments"
  ],
  "🐶 Pets": [
    "Food",
    "Vet Visits",
    "Meds / Grooming",
    "Pet Insurance"
  ],
  "💡 Utilities & Admin": [
    "Bank Fees",
    "Cloud / Online Services",
    "PO Box / Admin Costs"
  ],
  "🛠️ One-off & Sinking Funds": [
    "Car Tyres",
    "Home Appliance Replacement",
    "Birthday Gifts",
    "Holidays",
    "Annual Subscriptions",
    "School Uniform"
  ]
};

// ============================================================================ 
// PART 1: WORKER PROCESS (The Engine)
// ============================================================================ 

if (process.env.WORKER_ACTION) {
    const log = (msg, type = 'info') => {
        if (process.send) process.send({ type: 'log', message: msg, level: type });
    };

    const action = process.env.WORKER_ACTION;
    const payload = JSON.parse(process.env.WORKER_PAYLOAD || '{}');

    (async () => {
        try {
            log(`Worker started: ${action}`, 'info');

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

            // --- HELPER: Category Sync Logic ---
            const syncCategories = async (categoryTree) => {
                log('Syncing Categories...', 'info');
                
                // Get existing data to prevent duplicates
                let existingGroups = await actual.getCategoryGroups();
                let existingCategories = await actual.getCategories();
                let groupsCreated = 0;
                let catsCreated = 0;

                for (const [groupName, categoryNames] of Object.entries(categoryTree)) {
                    // 1. Check Group
                    let group = existingGroups.find(g => g.name === groupName);
                    
                    if (!group) {
                        try {
                            // Create Group
                            const newGroupId = await actual.createCategoryGroup({ name: groupName });
                            // Re-fetch to get full object and ensure sync
                            existingGroups = await actual.getCategoryGroups();
                            group = existingGroups.find(g => g.id === newGroupId);
                            groupsCreated++;
                        } catch (e) {
                            log(`Failed to create Group "${groupName}": ${e.message}`, 'error');
                            continue;
                        }
                    }

                    if (!group) continue; // Should not happen

                    // 2. Check Categories within Group
                    for (const catName of categoryNames) {
                        const exists = existingCategories.find(c => c.group_id === group.id && c.name === catName);
                        
                        if (!exists) {
                            try {
                                await actual.createCategory({ name: catName, group_id: group.id });
                                catsCreated++;
                            } catch (e) {
                                log(`Failed to create Category "${catName}": ${e.message}`, 'error');
                            }
                        }
                    }
                }
                
                // Refetch categories to ensure cache is up to date for any other ops
                if (groupsCreated > 0 || catsCreated > 0) {
                    log(`Categories Synchronised: Created ${groupsCreated} Groups and ${catsCreated} Categories.`, 'success');
                } else {
                    log('Categories up to date.', 'info');
                }
            };

            const transformTransaction = (t) => {
                let amount = Math.round(t.amount * 100);
                if (t.type === 'DEBIT') amount = -Math.abs(amount);
                else amount = Math.abs(amount);

                let date = t.transactionDate || t.postingDate || t.actionDate;
                if (!date) date = t.valueDate;
                if (date && date.includes('T')) {
                    date = date.split('T')[0];
                }

                const notesParts = [];
                if (t.transactionType) notesParts.push(`Type: ${t.transactionType}`);
                if (t.cardNumber) notesParts.push(`Ref: ${t.cardNumber}`);
                const notes = notesParts.join(' | ');

                const payee = t.description || 'Unknown Payee';
                const safeDesc = payee.replace(/[^a-z0-9]/gi, '').substring(0, 30);
                
                const orderSuffix = (t.postedOrder !== undefined && t.postedOrder !== null) 
                    ? `:${t.postedOrder}` 
                    : `:${Math.abs(amount)}`; 

                const idDate = date || 'nodate'; 
                const importId = `${t.accountId}:${idDate}:${safeDesc}${orderSuffix}`;

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

            const fetchInvestec = async (config) => {
                const baseUrl = process.env.INVESTEC_BASE_URL || "https://openapi.investec.com";
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

                const accRes = await fetch(`${baseUrl}/za/pb/v1/accounts`, {
                    headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
                });
                const accData = await accRes.json();
                const accounts = accData?.data?.accounts || [];

                return { token, accounts, baseUrl };
            };

            // --- WORKER ROUTE: TEST INVESTEC ---
            if (action === 'test-investec') {
                const data = await fetchInvestec(payload);
                process.send({ type: 'result', success: true, message: `Success! Found ${data.accounts.length} accounts.` });
                return;
            }

            // --- WORKER ROUTE: SYNC / TEST ACTUAL ---
            if (action === 'test-actual' || action === 'sync') {
                
                const rawUrl = payload.actualServerUrl || '';
                const serverUrl = rawUrl.replace(///$/, '').trim(); 
                const rawPass = payload.actualPassword || '';
                const password = rawPass.trim();
                const rawId = payload.actualBudgetId || '';
                const budgetId = rawId.trim();

                if (!serverUrl || !budgetId) throw new Error("Missing Server URL or Budget ID");

                const maskedPass = password ? `${password.substring(0,2)}***${password.slice(-2)}` : '(none)';
                log(`Config: URL=${serverUrl} | ID=${budgetId.substring(0,8)}... | Pass=${maskedPass}`, 'info');

                log(`Network Check: ${serverUrl}/info...`, 'info');
                try {
                    const infoRes = await fetch(`${serverUrl}/info`);
                    if (!infoRes.ok) throw new Error(`Status ${infoRes.status}`);
                } catch (err) {
                    throw new Error(`Network Error: Cannot reach ${serverUrl}. Details: ${err.message}`);
                }

                cleanDataDir();
                log(`Initialising API Engine...`, 'info');
                
                const initConfig = {
                    dataDir: ACTUAL_DATA_DIR,
                    serverURL: serverUrl,
                    password: password && password.length > 0 ? password : undefined
                };
                
                await actual.init(initConfig);
                
                log(`Fetching budget context...`, 'info');
                try {
                    await actual.downloadBudget(budgetId); 
                } catch (dlErr) {
                    const errString = dlErr.toString().toLowerCase();
                    if (errString.includes('invalid-password') || errString.includes('encryption')) {
                        if (initConfig.password) {
                             log(`File encrypted. Retrying with password...`, 'info');
                             try {
                                 await actual.downloadBudget(budgetId, { password: initConfig.password });
                             } catch (retryErr) {
                                 throw new Error(`Decryption Failed: ${retryErr.message}`);
                             }
                        } else {
                            throw dlErr;
                        }
                    } else if (errString.includes('could not get remote files') || errString.includes('not found')) {
                         throw new Error(`SERVER ERROR: Budget file "${budgetId}" not found.\n\n⚠️ ACTION REQUIRED: Open Actual in browser -> File > Close File.\nVerify it says "Remote". If "Local", Export/Import to upload it.`);
                    } else {
                        throw dlErr;
                    }
                }

                if (action === 'test-actual') {
                    process.send({ type: 'result', success: true, message: "Connection verified! Ready to sync." });
                    return;
                }

                log('Budget loaded. Starting Sync...', 'success');

                // --- CATEGORY SYNC ---
                if (payload.categories) {
                    await syncCategories(payload.categories);
                } else {
                    log('No category configuration found. Skipping category sync.', 'info');
                }
                
                log('Fetching Investec data...', 'info');
                const investecData = await fetchInvestec(payload);
                log(`Found ${investecData.accounts.length} bank accounts.`, 'info');

                const endDate = new Date();
                const startDate = new Date();
                startDate.setFullYear(startDate.getFullYear() - 1); 
                const fromStr = startDate.toISOString().split('T')[0];
                const toStr = endDate.toISOString().split('T')[0];

                let actualAccounts = await actual.getAccounts();
                let totalImported = 0;

                for (const invAcc of investecData.accounts) {
                    let uniqueName = `${invAcc.productName} ${invAcc.accountNumber.slice(-4)}`; 

                    if (invAcc.referenceName && 
                        invAcc.referenceName.trim() !== '' && 
                        invAcc.referenceName.trim() !== invAcc.accountName.trim()) {
                        uniqueName = invAcc.referenceName;
                    }
                    uniqueName = uniqueName.trim();

                    let accType = 'checking'; 
                    const prodNameLower = (invAcc.productName || "").toLowerCase();
                    if (prodNameLower.includes('credit')) accType = 'credit';
                    
                    let matchedAccount = actualAccounts.find(a => 
                        a.name.toLowerCase().trim() === uniqueName.toLowerCase()
                    );

                    if (!matchedAccount) {
                        log(`Account "${uniqueName}" not found in Actual. Creating...`, 'info');
                        try {
                            const newId = await actual.createAccount({
                                name: uniqueName,
                                type: accType,
                                offbudget: false
                            });
                            log(`✅ Created account: "${uniqueName}"`, 'success');
                            actualAccounts = await actual.getAccounts();
                            matchedAccount = actualAccounts.find(a => a.id === newId);
                        } catch (createErr) {
                            log(`❌ Failed to create account "${uniqueName}": ${createErr.message}`, 'error');
                            continue; 
                        }
                    }

                    log(`Syncing: "${uniqueName}"`, 'info');

                    const txUrl = `${investecData.baseUrl}/za/pb/v1/accounts/${invAcc.accountId}/transactions?fromDate=${fromStr}&toDate=${toStr}`;
                    const txRes = await fetch(txUrl, {
                        headers: { 'Authorization': `Bearer ${investecData.token}`, 'Accept': 'application/json' },
                    });
                    const txData = await txRes.json();
                    const rawTxs = (txData?.data?.transactions || []).map(t => ({ ...t, accountId: invAcc.accountId }));

                    if (rawTxs.length > 0) {
                        const actualTxs = rawTxs
                            .map(transformTransaction)
                            .filter(t => t.date); 

                        log(`  Importing ${actualTxs.length} transactions...`, 'info');
                        const result = await actual.importTransactions(matchedAccount.id, actualTxs);
                        
                        const count = (result?.added?.length || 0) + (result?.updated?.length || 0);
                        if (count > 0) {
                            log(`  ✅ Added/Updated ${count} transactions.`, 'success');
                            totalImported += count;
                        } else {
                            log(`  No new transactions.`, 'info');
                        }
                    } else {
                        log(`  No transactions in date range.`, 'info');
                    }
                }

                if (totalImported > 0) {
                    log('Pushing changes to server...', 'info');
                    await actual.sync(); 
                    log(`Sync Complete. Total ${totalImported} new transactions.`, 'success');
                } else {
                    log('Sync Complete. No data changes.', 'info');
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

// ============================================================================ 
// PART 2: MAIN SERVER PROCESS (The Coordinator)
// ============================================================================ 

const app = express();

let isProcessing = false;
let logs = [];
let lastSyncTime = null;
const MAX_LOGS = 100;
let currentTask = null;

const addLog = (message, type = 'info') => {
    const entry = { timestamp: Date.now(), message, type };
    logs.push(entry);
    if (logs.length > MAX_LOGS) logs.shift();
    console.log(`${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'} ${message}`);
};

const ensureDataDir = () => {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
};
const loadConfig = () => {
    ensureDataDir();
    if (fs.existsSync(CONFIG_FILE)) {
        try { 
            return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); 
        } catch (e) {
            console.error(`Failed to load config from ${CONFIG_FILE}:`, e.message);
            addLog(`Config Load Error: ${e.message}`, 'error');
        }
    } else {
        console.log(`Config file not found at: ${CONFIG_FILE}`);
    }
    return {};
};
const setupCron = (schedule) => {
    if (currentTask) { currentTask.stop(); currentTask = null; }
    if (schedule && cron.validate(schedule)) {
        currentTask = cron.schedule(schedule, () => runSync());
        addLog(`Schedule updated: ${schedule}`, 'info');
    }
};
const saveConfig = (cfg) => {
    ensureDataDir();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    setupCron(cfg.syncSchedule);
};

// --- CATEGORY MANAGEMENT ---
const loadCategories = () => {
    ensureDataDir();
    if (fs.existsSync(CATEGORIES_FILE)) {
        try { return JSON.parse(fs.readFileSync(CATEGORIES_FILE, 'utf-8')); } catch (e) {}
    }
    // Create Default
    fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(DEFAULT_CATEGORIES, null, 2));
    return DEFAULT_CATEGORIES;
};
const saveCategories = (cats) => {
    ensureDataDir();
    fs.writeFileSync(CATEGORIES_FILE, JSON.stringify(cats, null, 2));
};

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

// Category Endpoints
app.get('/api/categories', (req, res) => res.json(loadCategories()));
app.post('/api/categories', (req, res) => {
    saveCategories(req.body);
    res.json({ status: 'ok' });
});

app.post('/api/test/investec', async (req, res) => {
    const result = await spawnWorker('test-investec', req.body);
    res.json(result);
});

app.post('/api/test/actual', async (req, res) => {
    if (isProcessing) return res.json({ success: false, message: "Sync in progress" });
    const result = await spawnWorker('test-actual', req.body);
    res.json(result);
});

const runSync = async () => {
    if (isProcessing) { addLog("Sync skipped (already running)", "info"); return; }
    
    const config = loadConfig();
    const categories = loadCategories(); // Load latest categories

    if (!config.investecClientId || !config.actualServerUrl) {
        addLog("Config missing", "error");
        return;
    }

    isProcessing = true;
    addLog("Starting Sync...", "info");
    
    // Inject Categories into Payload
    const payload = { ...config, categories };

    try {
        await spawnWorker('sync', payload);
        lastSyncTime = Date.now();
    } catch (e) {
        addLog("Sync spawn error", "error");
    } finally {
        isProcessing = false;
    }
};

app.post('/api/sync', (req, res) => {
    if (isProcessing) return res.status(409).json({ status: 'busy' });
    runSync();
    res.json({ status: 'started' });
});

app.get('/api/version-check', async (req, res) => {
    try {
        const localPackage = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
        const remoteRes = await fetch('https://raw.githubusercontent.com/sean-gordon/Investec-ActualBudget/main/package.json');
        
        if (!remoteRes.ok) throw new Error('Failed to fetch remote version');
        const remotePackage = await remoteRes.json();
        
        const isNewer = (current, latest) => {
            const p1 = current.split('.').map(Number);
            const p2 = latest.split('.').map(Number);
            for (let i = 0; i < 3; i++) {
                if (p2[i] > p1[i]) return true;
                if (p2[i] < p1[i]) return false;
            }
            return false;
        };

        res.json({
            current: localPackage.version,
            latest: remotePackage.version,
            updateAvailable: isNewer(localPackage.version, remotePackage.version)
        });
    } catch (e) {
        addLog(`Version check failed: ${e.message}`, 'error');
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/git/branches', async (req, res) => {
    try {
        const response = await fetch('https://api.github.com/repos/sean-gordon/Investec-ActualBudget/branches');
        if (!response.ok) throw new Error('Failed to fetch branches');
        const data = await response.json();
        const branches = data.map(b => b.name);
        res.json(branches);
    } catch (e) {
        addLog(`Branch fetch error: ${e.message}`, 'error');
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/git/current', (req, res) => {
    const getBranch = (cmd) => new Promise(resolve => {
        exec(cmd, { cwd: __dirname }, (err, stdout) => {
            if (err || !stdout) resolve(null);
            else resolve(stdout.trim());
        });
    });

    (async () => {
        // Method 1: Standard git command
        let branch = await getBranch('git rev-parse --abbrev-ref HEAD');
        
        // Method 2: If we are in detached HEAD (e.g., CI or specific checkout), try getting ref name
        if (!branch || branch === 'HEAD') {
             const headRef = await getBranch('git symbolic-ref -q HEAD');
             if (headRef) branch = headRef.replace('refs/heads/', '');
        }

        // Method 3: Check remotes to see what commit we are on
        if (!branch || branch === 'HEAD') {
             const hash = await getBranch('git rev-parse HEAD');
             const allBranches = await getBranch('git branch -r --contains ' + hash);
             if (allBranches) {
                 // Clean up output like "origin/Dev", "origin/HEAD -> origin/main"
                 const match = allBranches.split('\n')
                    .map(b => b.trim().replace('origin/', ''))
                    .find(b => !b.includes('HEAD'));
                 if (match) branch = match;
             }
        }

        res.json({ branch: branch || 'unknown' });
    })();
});

app.get('/api/git/status', (req, res) => {
    (async () => {
        const getHash = (cmd) => new Promise(resolve => {
            exec(cmd, { cwd: __dirname }, (err, stdout) => resolve(stdout ? stdout.trim() : null));
        });

        // 1. Get current branch
        let branch = await getHash('git rev-parse --abbrev-ref HEAD');
        if (!branch || branch === 'HEAD') {
             // Fallback for detached head
             const allBranches = await getHash('git branch -r --contains HEAD');
             if (allBranches) {
                 const match = allBranches.split('\n')
                    .map(b => b.trim().replace('origin/', ''))
                    .find(b => !b.includes('HEAD'));
                 if (match) branch = match;
             }
        }
        
        if (!branch) return res.json({ updateAvailable: false, branch: 'unknown' });

        // 2. Fetch latest info from remote (without merging)
        await getHash('git fetch origin ' + branch);

        // 3. Compare hashes
        const localHash = await getHash('git rev-parse HEAD');
        const remoteHash = await getHash(`git rev-parse origin/${branch}`);

        const updateAvailable = localHash && remoteHash && localHash !== remoteHash;

        res.json({
            branch, 
            localHash, 
            remoteHash, 
            updateAvailable 
        });
    })();
});

app.post('/api/git/switch', (req, res) => {
    const { branch } = req.body;
    // Validate branch name to prevent command injection
    if (!branch || !/^[a-zA-Z0-9_\-\.]+$/.test(branch)) {
        return res.status(400).json({ error: 'Invalid branch name' });
    }

    const config = loadConfig();
    let hostDir = '';
    
    if (config.hostProjectRoot) {
        // Simple sanitization: allow alphanumeric, slashes, dashes, underscores, dots, and spaces
        // If it contains anything else (like semicolons or ampersands), ignore it to prevent injection
        if (/^[a-zA-Z0-9_\-\.\/ ]+$/.test(config.hostProjectRoot)) {
            hostDir = `HOST_DIR="${config.hostProjectRoot}"`;
        } else {
            addLog(`Security Warning: Invalid characters in Host Project Path. Ignoring.`, 'error');
        }
    }

    addLog(`System switching to branch: ${branch}...`, 'info');
    res.json({ status: 'updating', message: `Switching to ${branch}. Service will restart.` });
    
    setTimeout(() => {
        // Use -B to force reset/create branch from origin, avoiding ambiguity with files
        const cmd = `${hostDir} git fetch origin && git checkout -B ${branch} origin/${branch} && git pull origin ${branch} && ${hostDir} docker compose up -d --build`;
        exec(cmd, { cwd: __dirname }, (error, stdout, stderr) => {
            if (error) {
                console.error(`Switch error: ${error}`);
                addLog(`Branch switch failed: ${error.message}`, 'error');
                return;
            }
            console.log(`Switch output: ${stdout}`);
        });
    }, 1000);
});

app.post('/api/update', (req, res) => {
    addLog('System update initiated...', 'info');
    res.json({ status: 'updating', message: 'Update started. Service will restart shortly.' });
    
    const config = loadConfig();
    let hostDir = '';
    
    if (config.hostProjectRoot) {
        // Simple sanitization: allow alphanumeric, slashes, dashes, underscores, dots, and spaces
        // If it contains anything else (like semicolons or ampersands), ignore it to prevent injection
        if (/^[a-zA-Z0-9_\-\.\/ ]+$/.test(config.hostProjectRoot)) {
            hostDir = `HOST_DIR="${config.hostProjectRoot}"`;
        } else {
            addLog(`Security Warning: Invalid characters in Host Project Path. Ignoring.`, 'error');
        }
    }

    // Run update in background
    setTimeout(() => {
        exec(`${hostDir} git pull && ${hostDir} docker compose up -d --build`, { cwd: __dirname }, (error, stdout, stderr) => {
            if (error) {
                console.error(`Update error: ${error}`);
                addLog(`Update failed: ${error.message}`, 'error');
                return;
            }
            console.log(`Update output: ${stdout}`);
            if (stderr) console.error(`Update stderr: ${stderr}`);
        });
    }, 1000);
});

const initialConfig = loadConfig();
setupCron(initialConfig.syncSchedule);

app.use(express.static(path.join(__dirname, 'dist')));
app.get('*', (req, res) => {
    const p = path.join(__dirname, 'dist', 'index.html');
    if (fs.existsSync(p)) res.sendFile(p);
    else res.send('Investec Sync Server Running (Build pending)');
});

// --- STARTUP CHECKS ---
setTimeout(() => {
    // Check if we just switched branches
    const config = loadConfig();
    exec('git rev-parse --abbrev-ref HEAD', { cwd: __dirname }, (err, stdout) => {
        if (!err && stdout) {
            const currentBranch = stdout.trim();
            addLog(`System startup complete. Active Branch: ${currentBranch}`, 'success');
        }
    });
}, 5000); // Wait for server to fully initialize

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server v${SCRIPT_VERSION} listening on ${PORT}`);
    addLog(`System Online. v${SCRIPT_VERSION}`, 'success');
});

} // End Main Process
