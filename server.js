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
import { v4 as uuidv4 } from 'uuid';

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
 *    - Schedules Cron Jobs per Profile.
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
const SCRIPT_VERSION = "6.3.1 - Enhanced Profile Management";

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
    const profileName = payload.name || 'Unknown Profile';

    // Helper to prefix logs with profile name
    const logP = (msg, type = 'info') => log(`[${profileName}] ${msg}`, type);

    (async () => {
        try {
            logP(`Worker started: ${action}`, 'info');

            // Unique Data Dir per Profile to avoid locking issues if running parallel
            // or just use one. Actual API creates a lock file. 
            // If we run parallel, we MUST use different data directories.
            // We'll suffix the data dir with the profile ID if available.
            const profileId = payload.id || 'default';
            const PROFILE_DATA_DIR = path.join(ACTUAL_DATA_DIR, profileId);

            const cleanDataDir = () => {
                try {
                    if (fs.existsSync(PROFILE_DATA_DIR)) {
                        fs.rmSync(PROFILE_DATA_DIR, { recursive: true, force: true });
                    }
                    fs.mkdirSync(PROFILE_DATA_DIR, { recursive: true });
                } catch (e) {
                    logP(`Cleanup warning: ${e.message}`, 'error');
                }
            };

            // --- HELPER: Category Sync Logic ---
            const syncCategories = async (categoryTree) => {
                logP('Syncing Categories...', 'info');
                
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
                            logP(`Failed to create Group "${groupName}": ${e.message}`, 'error');
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
                                logP(`Failed to create Category "${catName}": ${e.message}`, 'error');
                            }
                        }
                    }
                }
                
                // Refetch categories to ensure cache is up to date for any other ops
                if (groupsCreated > 0 || catsCreated > 0) {
                    logP(`Categories Synchronised: Created ${groupsCreated} Groups and ${catsCreated} Categories.`, 'success');
                } else {
                    logP('Categories up to date.', 'info');
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
                const serverUrl = rawUrl.replace(/\/$/, '').trim(); 
                const rawPass = payload.actualPassword || '';
                const password = rawPass.trim();
                const rawId = payload.actualBudgetId || '';
                const budgetId = rawId.trim();

                if (!serverUrl || !budgetId) throw new Error("Missing Server URL or Budget ID");

                const maskedPass = password ? `${password.substring(0,2)}***${password.slice(-2)}` : '(none)';
                logP(`Config: URL=${serverUrl} | ID=${budgetId.substring(0,8)}... | Pass=${maskedPass}`, 'info');

                logP(`Network Check: ${serverUrl}/info...`, 'info');
                try {
                    const infoRes = await fetch(`${serverUrl}/info`);
                    if (!infoRes.ok) throw new Error(`Status ${infoRes.status}`);
                } catch (err) {
                    throw new Error(`Network Error: Cannot reach ${serverUrl}. Details: ${err.message}`);
                }

                cleanDataDir();
                logP(`Initialising API Engine (Dir: ${profileId})...`, 'info');
                
                const initConfig = {
                    dataDir: PROFILE_DATA_DIR,
                    serverURL: serverUrl,
                    password: password && password.length > 0 ? password : undefined
                };
                
                await actual.init(initConfig);
                
                logP(`Fetching budget context...`, 'info');
                try {
                    await actual.downloadBudget(budgetId); 
                } catch (dlErr) {
                    const errString = dlErr.toString().toLowerCase();
                    if (errString.includes('invalid-password') || errString.includes('encryption')) {
                        if (initConfig.password) {
                             logP(`File encrypted. Retrying with password...`, 'info');
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

                logP('Budget loaded. Starting Sync...', 'success');

                // --- CATEGORY SYNC ---
                if (payload.categories) {
                    await syncCategories(payload.categories);
                } else {
                    logP('No category configuration found. Skipping category sync.', 'info');
                }
                
                logP('Fetching Investec data...', 'info');
                const investecData = await fetchInvestec(payload);
                logP(`Found ${investecData.accounts.length} bank accounts.`, 'info');

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
                        logP(`Account "${uniqueName}" not found in Actual. Creating...`, 'info');
                        try {
                            const newId = await actual.createAccount({
                                name: uniqueName,
                                type: accType,
                                offbudget: false
                            });
                            logP(`✅ Created account: "${uniqueName}"`, 'success');
                            actualAccounts = await actual.getAccounts();
                            matchedAccount = actualAccounts.find(a => a.id === newId);
                        } catch (createErr) {
                            logP(`❌ Failed to create account "${uniqueName}": ${createErr.message}`, 'error');
                            continue; 
                        }
                    }

                    logP(`Syncing: "${uniqueName}"`, 'info');

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

                        logP(`  Importing ${actualTxs.length} transactions...`, 'info');
                        const result = await actual.importTransactions(matchedAccount.id, actualTxs);
                        
                        const count = (result?.added?.length || 0) + (result?.updated?.length || 0);
                        if (count > 0) {
                            logP(`  ✅ Added/Updated ${count} transactions.`, 'success');
                            totalImported += count;
                        } else {
                            logP(`  No new transactions.`, 'info');
                        }
                    } else {
                        logP(`  No transactions in date range.`, 'info');
                    }
                }

                if (totalImported > 0) {
                    logP('Pushing changes to server...', 'info');
                    await actual.sync(); 
                    logP(`Sync Complete. Total ${totalImported} new transactions.`, 'success');
                } else {
                    logP('Sync Complete. No data changes.', 'info');
                }
            }

        } catch (e) {
            let msg = e.message;
            logP(`ERROR: ${msg}`, 'error');
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

const processingProfiles = new Set(); // Track active profile IDs
let logs = [];
const MAX_LOGS = 200;
let cronTasks = {}; // { profileId: task }

const addLog = (message, type = 'info') => {
    const entry = { timestamp: Date.now(), message, type };
    logs.push(entry);
    if (logs.length > MAX_LOGS) logs.shift();
    console.log(`${type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'} ${message}`);
};

const ensureDataDir = () => {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
};

// --- CONFIG MANAGEMENT & MIGRATION ---
const loadConfig = () => {
    ensureDataDir();
    let config = {};
    
    if (fs.existsSync(CONFIG_FILE)) {
        try { 
            config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); 
        } catch (e) {
            console.error(`Failed to load config from ${CONFIG_FILE}:`, e.message);
            addLog(`Config Load Error: ${e.message}`, 'error');
            return { profiles: [] };
        }
    }

    // --- MIGRATION: Old Flat Config -> New Profile Config ---
    if (!config.profiles && (config.investecClientId || config.actualServerUrl)) {
        addLog("Migrating legacy config to Profile format...", "info");
        const defaultProfile = {
            id: uuidv4(),
            name: "Default Profile",
            enabled: true,
            investecClientId: config.investecClientId || '',
            investecSecretId: config.investecSecretId || '',
            investecApiKey: config.investecApiKey || '',
            actualServerUrl: config.actualServerUrl || '',
            actualPassword: config.actualPassword || '',
            actualBudgetId: config.actualBudgetId || '',
            syncSchedule: config.syncSchedule || ''
        };
        
        const newConfig = {
            profiles: [defaultProfile],
            hostProjectRoot: config.hostProjectRoot
        };
        
        saveConfig(newConfig); // Persist migration
        return newConfig;
    }

    // Ensure profiles array exists
    if (!config.profiles) config.profiles = [];
    return config;
};

const setupCron = (config) => {
    // Stop all existing tasks
    Object.values(cronTasks).forEach(task => task.stop());
    cronTasks = {};

    // Setup new tasks
    config.profiles.forEach(p => {
        if (p.enabled && p.syncSchedule && cron.validate(p.syncSchedule)) {
            const task = cron.schedule(p.syncSchedule, () => runSync(p.id));
            cronTasks[p.id] = task;
            addLog(`Schedule set for "${p.name}": ${p.syncSchedule}`, 'info');
        }
    });
};

const saveConfig = (cfg) => {
    ensureDataDir();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
    setupCron(cfg);
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

app.get('/api/status', (req, res) => {
    const config = loadConfig();
    res.json({
        processingProfiles: Array.from(processingProfiles),
        version: SCRIPT_VERSION,
        // Check if any profile has a budget loaded (just a loose check if any ID exists)
        profileCount: config.profiles.length
    });
});

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
    // Requires full profile data in body, or profileId to lookup
    const profile = req.body;
    const result = await spawnWorker('test-investec', profile);
    res.json(result);
});

app.post('/api/test/actual', async (req, res) => {
    const profile = req.body;
    if (processingProfiles.has(profile.id)) return res.json({ success: false, message: "Sync in progress for this profile" });
    
    // Use temporary ID if not provided (e.g., testing before saving)
    const testPayload = { ...profile, id: profile.id || 'test-temp' };
    
    const result = await spawnWorker('test-actual', testPayload);
    res.json(result);
});

const runSync = async (profileId) => {
    if (processingProfiles.has(profileId)) { 
        addLog(`Sync skipped for ${profileId} (already running)`, "info"); 
        return; 
    }
    
    const config = loadConfig();
    const profile = config.profiles.find(p => p.id === profileId);

    if (!profile) {
        addLog(`Cannot sync: Profile ${profileId} not found`, "error");
        return;
    }

    if (!profile.enabled) {
        addLog(`Cannot sync: Profile "${profile.name}" is disabled`, "error");
        return;
    }

    const categories = loadCategories(); 

    if (!profile.investecClientId || !profile.actualServerUrl) {
        addLog(`Config missing for ${profile.name}`, "error");
        return;
    }

    processingProfiles.add(profileId);
    addLog(`Starting Sync: ${profile.name}...`, "info");
    
    const payload = { ...profile, categories };

    try {
        await spawnWorker('sync', payload);
    } catch (e) {
        addLog(`Sync spawn error for ${profile.name}`, "error");
    } finally {
        processingProfiles.delete(profileId);
    }
};

app.post('/api/sync', (req, res) => {
    const { profileId } = req.body;
    
    if (!profileId) return res.status(400).json({ error: "Missing profileId" });
    
    if (processingProfiles.has(profileId)) return res.status(409).json({ status: 'busy' });
    
    runSync(profileId);
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
setupCron(initialConfig);

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