import { fork, spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const port = Number(process.env.SAFE_RUNTIME_PORT || 46491);
const baseUrl = `http://127.0.0.1:${port}`;
const password = 'safe-runtime-password';
const tempDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'investec-sync-safe-runtime-'));
const startupAttempts = Number(process.env.SAFE_RUNTIME_STARTUP_ATTEMPTS || 120);
const startupDelayMs = Number(process.env.SAFE_RUNTIME_STARTUP_DELAY_MS || 500);

const server = spawn(process.execPath, ['server.js'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    APP_PASSWORD: password,
    DISABLE_MAINTENANCE_ACTIONS: 'true',
    DATA_DIR: tempDataDir
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';
server.stdout.on('data', chunk => {
  stdout += chunk.toString();
});
server.stderr.on('data', chunk => {
  stderr += chunk.toString();
});

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const verifyWorkerFailureExitCode = async () => new Promise((resolve, reject) => {
  const worker = fork(path.join(process.cwd(), 'server.js'), {
    cwd: process.cwd(),
    env: {
      ...process.env,
      WORKER_ACTION: 'test-actual',
      WORKER_PAYLOAD: JSON.stringify({ id: 'worker-failure-check', name: 'Worker Failure Check' }),
      DATA_DIR: tempDataDir
    },
    silent: true
  });

  let result = null;
  let stdout = '';
  let stderr = '';
  const timeout = setTimeout(() => {
    worker.kill();
    reject(new Error('Worker failure check timed out'));
  }, 10000);

  worker.stdout?.on('data', chunk => {
    stdout += chunk.toString();
  });
  worker.stderr?.on('data', chunk => {
    stderr += chunk.toString();
  });
  worker.on('message', message => {
    if (message?.type === 'result') result = message;
  });
  worker.on('error', error => {
    clearTimeout(timeout);
    reject(error);
  });
  worker.on('exit', code => {
    clearTimeout(timeout);
    if (code !== 1) {
      reject(new Error(`Worker failure check expected exit code 1, got ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
      return;
    }
    if (!result || result.success !== false || !String(result.message || '').includes('Missing Server URL or Budget ID')) {
      reject(new Error(`Worker failure check did not return the expected failure result: ${JSON.stringify(result)}`));
      return;
    }
    resolve();
  });
});

const stopServer = async () => {
  if (server.exitCode !== null || server.killed) return;
  server.kill();
  await Promise.race([
    new Promise(resolve => server.once('exit', resolve)),
    sleep(3000)
  ]);
  if (server.exitCode === null && !server.killed) {
    server.kill('SIGKILL');
  }
};

const waitForServer = async () => {
  for (let i = 0; i < startupAttempts; i++) {
    try {
      const res = await fetch(`${baseUrl}/env-config.js`);
      if (res.ok) return;
    } catch {
      // Server is still starting.
    }
    if (server.exitCode !== null) {
      throw new Error(`Server exited early with code ${server.exitCode}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
    }
    await sleep(startupDelayMs);
  }
  throw new Error(`Timed out waiting for server on ${baseUrl}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`);
};

const expectStatus = async (path, options, status) => {
  const res = await fetch(`${baseUrl}${path}`, options);
  if (res.status !== status) {
    const text = await res.text().catch(() => '');
    throw new Error(`${path} expected ${status}, got ${res.status}: ${text}`);
  }
  return res;
};

try {
  await waitForServer();

  const envScript = await expectStatus('/env-config.js', {}, 200);
  const envText = await envScript.text();
  if (!envText.includes('window.__ENV__')) {
    throw new Error('/env-config.js did not return the runtime env script');
  }

  const spaRes = await expectStatus('/profiles/deep-link', {}, 200);
  const spaText = await spaRes.text();
  if (!spaText.includes('<div id="root"')) {
    throw new Error('SPA fallback should return index.html for deep links');
  }

  await expectStatus('/api/status', {}, 401);
  await expectStatus('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong' })
  }, 401);

  const loginRes = await expectStatus('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  }, 200);
  const login = await loginRes.json();
  if (!login.token || login.token === password) {
    throw new Error('/api/login must return a non-password session token');
  }

  const authHeaders = { 'x-session-token': login.token };
  const statusRes = await expectStatus('/api/status', { headers: authHeaders }, 200);
  const status = await statusRes.json();
  if (!Array.isArray(status.processingProfiles) || typeof status.version !== 'string') {
    throw new Error('/api/status returned an unexpected payload');
  }

  const configRes = await expectStatus('/api/config', { headers: authHeaders }, 200);
  const config = await configRes.json();
  if (!Array.isArray(config.profiles)) {
    throw new Error('/api/config should return a profiles array');
  }

  const defaultCategoryRes = await expectStatus('/api/categories', { headers: authHeaders }, 200);
  const defaultCategories = await defaultCategoryRes.json();
  if (!Object.keys(defaultCategories).some(group => group.includes('Home & Living'))) {
    throw new Error('/api/categories should create and return default categories in a fresh data directory');
  }

  const profile = {
    id: 'safe-profile-1',
    name: 'Safe Runtime Profile',
    enabled: true,
    investecClientId: 'client-id',
    investecSecretId: 'secret-id',
    investecApiKey: 'api-key',
    actualServerUrl: 'http://actual.example',
    actualPassword: 'budget-password',
    actualBudgetId: 'budget-id',
    syncSchedule: 'invalid cron',
    categories: {
      Essentials: ['Groceries', 'Fuel']
    }
  };

  const saveConfigRes = await expectStatus('/api/config', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ profiles: [profile], hostProjectRoot: '/tmp/project' })
  }, 200);
  const saveConfig = await saveConfigRes.json();
  if (!Array.isArray(saveConfig.warnings) || !saveConfig.warnings.some(warning => warning.includes('Invalid cron schedule'))) {
    throw new Error('/api/config should return invalid cron warnings');
  }

  const maskedConfigRes = await expectStatus('/api/config', { headers: authHeaders }, 200);
  const maskedConfig = await maskedConfigRes.json();
  const maskedProfile = maskedConfig.profiles?.[0];
  if (
    maskedProfile?.investecSecretId !== '********' ||
    maskedProfile?.investecApiKey !== '********' ||
    maskedProfile?.actualPassword !== '********'
  ) {
    throw new Error('/api/config should mask saved secrets');
  }

  const windowsHostProjectRoot = 'G:\\My Drive\\Tech\\Coding\\AI\\Gemini\\InvestecBudgets';
  await expectStatus('/api/config', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ profiles: [profile], hostProjectRoot: ` ${windowsHostProjectRoot} ` })
  }, 200);
  const windowsPathConfigRes = await expectStatus('/api/config', { headers: authHeaders }, 200);
  const windowsPathConfig = await windowsPathConfigRes.json();
  if (windowsPathConfig.hostProjectRoot !== windowsHostProjectRoot) {
    throw new Error('/api/config should accept and trim Windows-style host project paths');
  }

  await expectStatus('/api/config', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ profiles: [profile], hostProjectRoot: 'bad\npath' })
  }, 400);

  const missingInvestecRes = await expectStatus('/api/test/investec', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  }, 400);
  const missingInvestec = await missingInvestecRes.json();
  if (!String(missingInvestec.error || '').includes('Missing required Investec fields')) {
    throw new Error('/api/test/investec should reject incomplete profiles before spawning a worker');
  }

  const missingActualRes = await expectStatus('/api/test/actual', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  }, 400);
  const missingActual = await missingActualRes.json();
  if (!String(missingActual.error || '').includes('Missing required Actual fields')) {
    throw new Error('/api/test/actual should reject incomplete profiles before spawning a worker');
  }

  const statusAfterConfigRes = await expectStatus('/api/status', { headers: authHeaders }, 200);
  const statusAfterConfig = await statusAfterConfigRes.json();
  if (statusAfterConfig.profileCount !== 1) {
    throw new Error('/api/status should reflect saved profile count');
  }

  await expectStatus('/api/config', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profiles: [{ ...profile, enabled: false, syncSchedule: '' }],
      hostProjectRoot: '/tmp/project'
    })
  }, 200);
  const disabledConfigRes = await expectStatus('/api/config', { headers: authHeaders }, 200);
  const disabledConfig = await disabledConfigRes.json();
  if (disabledConfig.profiles?.[0]?.enabled !== false) {
    throw new Error('/api/config should persist disabled profile state');
  }

  await expectStatus('/api/sync', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId: profile.id })
  }, 400);

  await expectStatus('/api/sync', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId: 'missing-profile' })
  }, 404);

  await expectStatus('/api/config', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profiles: [{ ...profile, investecApiKey: '', enabled: true, syncSchedule: '' }],
      hostProjectRoot: '/tmp/project'
    })
  }, 200);
  const incompleteSyncRes = await expectStatus('/api/sync', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ profileId: profile.id })
  }, 400);
  const incompleteSync = await incompleteSyncRes.json();
  if (!String(incompleteSync.error || '').includes('Investec API Key')) {
    throw new Error('/api/sync should reject incomplete profiles before spawning a worker');
  }

  await expectStatus('/api/config', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ profiles: [], hostProjectRoot: '/tmp/project' })
  }, 200);
  const deletedConfigRes = await expectStatus('/api/config', { headers: authHeaders }, 200);
  const deletedConfig = await deletedConfigRes.json();
  if (!Array.isArray(deletedConfig.profiles) || deletedConfig.profiles.length !== 0) {
    throw new Error('/api/config should persist profile deletion');
  }

  await expectStatus('/api/config', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ profiles: [profile], hostProjectRoot: '/tmp/project' })
  }, 200);

  const categoryTree = { Essentials: ['Groceries'], Income: ['Salary'] };
  await expectStatus('/api/categories', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(categoryTree)
  }, 200);
  const categoryRes = await expectStatus('/api/categories', { headers: authHeaders }, 200);
  const categories = await categoryRes.json();
  if (categories.Essentials?.[0] !== 'Groceries' || categories.Income?.[0] !== 'Salary') {
    throw new Error('/api/categories should persist valid category trees');
  }

  const versionRes = await expectStatus('/api/version-check', { headers: authHeaders }, 200);
  const version = await versionRes.json();
  if (version.updateAvailable !== false || version.disabled !== true) {
    throw new Error('/api/version-check should report disabled maintenance mode');
  }

  await expectStatus('/api/update', { method: 'POST', headers: authHeaders }, 403);
  await expectStatus('/api/git/switch', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch: 'main' })
  }, 403);

  const branchesRes = await expectStatus('/api/git/branches', { headers: authHeaders }, 200);
  const branches = await branchesRes.json();
  if (!Array.isArray(branches) || branches.length !== 0) {
    throw new Error('/api/git/branches should return an empty list in safe mode');
  }

  const gitStatusRes = await expectStatus('/api/git/status', { headers: authHeaders }, 200);
  const gitStatus = await gitStatusRes.json();
  if (gitStatus.branch !== 'disabled' || gitStatus.updateAvailable !== false) {
    throw new Error('/api/git/status should report disabled safe mode');
  }

  const dockerRes = await expectStatus('/api/docker/containers', { headers: authHeaders }, 200);
  const containers = await dockerRes.json();
  if (!Array.isArray(containers) || containers.length !== 0) {
    throw new Error('/api/docker/containers should return an empty list in safe mode');
  }

  const dockerLogsRes = await expectStatus('/api/docker/logs?container=anything', { headers: authHeaders }, 200);
  const dockerLogs = await dockerLogsRes.json();
  if (dockerLogs.logs !== '') {
    throw new Error('/api/docker/logs should return empty logs in safe mode');
  }

  await expectStatus('/api/docker/logs', { headers: authHeaders }, 400);
  await expectStatus('/api/docker/logs?container=bad%3Bname', { headers: authHeaders }, 400);

  const logsRes = await expectStatus('/api/logs', { headers: authHeaders }, 200);
  const logs = await logsRes.json();
  if (!Array.isArray(logs) || !logs.some(log => String(log.message || '').includes('System Online'))) {
    throw new Error('/api/logs should include startup logs');
  }

  const updateLogRes = await expectStatus('/api/debug/update-log', { headers: authHeaders }, 200);
  const updateLogText = await updateLogRes.text();
  if (!updateLogText.includes('No update log found')) {
    throw new Error('/api/debug/update-log should report no update log in a fresh data directory');
  }

  await expectStatus('/api/sync', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  }, 400);

  await expectStatus('/api/config', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bad: true })
  }, 400);

  await expectStatus('/api/categories', {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify([])
  }, 400);

  await verifyWorkerFailureExitCode();

  console.log('Safe runtime verification passed.');
} finally {
  await stopServer();
  await fs.rm(tempDataDir, { recursive: true, force: true });
}
