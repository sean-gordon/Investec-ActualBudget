import fs from 'fs';
import path from 'path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i++;
      row.push(field);
      if (row.some(value => value.length > 0)) rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some(value => value.length > 0)) rows.push(row);
  return rows;
};

const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));
check(packageLock.version === packageJson.version, 'package-lock root version must match package.json version');
check(packageLock.packages?.['']?.version === packageJson.version, 'package-lock package root version must match package.json version');
check(packageJson.scripts?.['test:runtime-safe'] === 'node scripts/test-runtime-safe.mjs', 'package.json should expose test:runtime-safe');

const featureRows = parseCsv(read('feature_status.csv'));
const header = featureRows[0] || [];
const records = featureRows.slice(1);
const requiredColumns = [
  'Feature ID',
  'Area',
  'Feature',
  'User Story',
  'Expected Behaviour Based on Code',
  'Code Evidence',
  'Current Status',
  'Test Status',
  'Errors / Notes',
  'Last Verified'
];

for (const column of requiredColumns) {
  check(header.includes(column), `feature_status.csv missing required column: ${column}`);
}

const idIndex = header.indexOf('Feature ID');
const ids = records.map(row => row[idIndex]).filter(Boolean);
check(ids.length >= 40, 'feature_status.csv should track the broad app surface');
check(new Set(ids).size === ids.length, 'feature_status.csv Feature ID values must be unique');

const nonEmptyColumns = requiredColumns.filter(column => column !== 'Errors / Notes');
for (const [index, row] of records.entries()) {
  for (const column of nonEmptyColumns) {
    const columnIndex = header.indexOf(column);
    check(Boolean(row[columnIndex]), `feature_status.csv row ${index + 2} missing ${column}`);
  }
}

const server = read('server.js');
const app = read('App.tsx');
const logConsole = read('components/LogConsole.tsx');
const codeEvidenceIndex = header.indexOf('Code Evidence');
const codeEvidenceText = records.map(row => row[codeEvidenceIndex] || '').join('\n');
const concreteRoutes = [...server.matchAll(/app\.(?:get|post|put|delete)\('([^']+)'/g)]
  .map(match => match[1])
  .filter(route => route !== '*');

for (const route of new Set(concreteRoutes)) {
  check(codeEvidenceText.includes(route), `feature_status.csv Code Evidence should cover route ${route}`);
}

check(!/git pull|pull origin/.test(server), 'server.js update paths must not use git pull');
check(server.includes('git merge --ff-only'), 'server.js update path should attempt fast-forward updates');
check(server.includes('git reset --hard'), 'server.js update path should handle divergent remote history');
check(server.includes('git stash push -u -m "${stashName}"'), 'server.js update path should stash local changes before update');
check(server.includes('auto-update-backup-${Date.now()}'), 'server.js update path should create a backup branch before divergent reset');
check(server.includes("app.get('/env-config.js'"), 'server.js should serve /env-config.js fallback');
check(server.includes('process.env.DIST_DIR') && server.includes('express.static(DIST_DIR)'), 'server.js should allow Docker to serve built assets from an image-owned DIST_DIR');
check(server.includes('process.env.PROJECT_ROOT') && server.includes('cwd: PROJECT_ROOT'), 'server.js maintenance commands should run from configurable PROJECT_ROOT');
check(server.includes("process.env.HOST || '0.0.0.0'"), 'server.js should allow HOST override for local-only test runs');
check(server.includes('process.env.DATA_DIR'), 'server.js should allow DATA_DIR override for disposable runtime tests');
check(server.includes('DISABLE_MAINTENANCE_ACTIONS'), 'server.js should allow disabling maintenance actions for safe tests');
check(server.includes('VERSION_CHECK_TIMEOUT_MS'), 'server.js should bound remote version check duration');
check(server.includes('const fetchWithTimeout = async'), 'server.js should use a timeout wrapper for external version checks');
check(server.includes('const VERSION_CHECK_URL = process.env.VERSION_CHECK_URL'), 'server.js should allow overriding remote package metadata URL');
check(server.includes('fetchWithTimeout(VERSION_CHECK_URL)'), 'server.js should fetch remote package metadata through the timeout wrapper');
check(server.includes('const dockerUnavailableResponse = (res, action, err, stderr = \'\') =>') && server.includes('res.status(503).json'), 'server.js should return explicit 503 errors when Docker is unavailable');
check(server.includes('const validateHostProjectRoot = (value) =>'), 'server.js should validate hostProjectRoot with a shared helper');
check(server.includes('Host Project Path cannot contain line breaks or NUL characters.'), 'server.js should reject unsafe hostProjectRoot control characters');
check(!server.includes('^[a-zA-Z0-9_\\-\\.\\/ ]+$'), 'server.js should not reject valid Windows-style host project paths with the old allowlist');
check(server.includes('const hydrateMaskedProfileSecrets = (profile) =>'), 'server.js should rehydrate masked saved secrets before connection tests');
check(server.includes('const missingProfileFields = (profile, groups) =>'), 'server.js should validate profile requirements before worker actions');
check(server.includes('Missing required sync fields'), 'server.js should reject incomplete sync profiles before spawning workers');
check(server.includes('let workerExitCode = 0') && server.includes('process.exit(workerExitCode)'), 'server.js worker should preserve non-zero exit codes after cleanup');
check(server.includes('WORKER_ACTION') && server.includes('WORKER_PAYLOAD'), 'server.js should isolate worker actions with environment payloads');
check(server.includes('Worker timed out after 5 minutes') && server.includes('300000'), 'server.js should enforce worker timeout');
check(server.includes('cleanDataDir();') && server.includes('actual.init(initConfig)') && server.includes('actual.downloadBudget(budgetId)') && !server.includes('actual.loadBudget'), 'server.js worker should initialize and download Actual budgets before API operations, without a redundant loadBudget(syncId) call that breaks on @actual-app/api >= 26 (downloadBudget already loads under its own local id)');
check(server.includes('invalid-password') && server.includes('Decryption Failed'), 'server.js worker should handle Actual password retry failures explicitly');
check(server.includes('const syncCategories = async (categoryTree) =>') && server.includes('actual.getCategoryGroups()') && server.includes('actual.createCategoryGroup') && server.includes('actual.createCategory'), 'server.js should sync missing Actual category groups and categories');
check(server.includes('const fetchInvestec = async (config) =>') && server.includes('/identity/v2/oauth2/token') && server.includes('/za/pb/v1/accounts'), 'server.js should authenticate and fetch Investec accounts');
check(server.includes('transactions?fromDate=') && server.includes('setFullYear(startDate.getFullYear() - 1)'), 'server.js should fetch one year of Investec transactions');
check(server.includes('referenceName') && server.includes('accountNumber.slice(-4)') && server.includes("prodNameLower.includes('credit')") && server.includes('actual.createAccount'), 'server.js should match/create Actual accounts with credit detection');
check(server.includes('const transformTransaction = (t) =>') && server.includes('imported_id: importId') && server.includes('actual.importTransactions') && server.includes('await actual.sync()'), 'server.js should transform/import transactions and sync Actual when data changes');
check(app.includes('return [...filteredSystemLogs, ...parsedAiLogs]'), 'App.tsx merged logs should use filtered system logs');
check(app.includes('[systemLogs, rawAiLogs, logViewMode, updateLogData, activeProfileId, config.profiles]'), 'App.tsx merged logs should recompute when active profile changes');
check(app.includes("setRawAiLogs(''); // Clear immediately to prevent ghost logs"), 'App.tsx should clear AI logs when selecting a profile');
check(app.includes('log.message.match(/^\\[(.*?)\\]/)'), 'App.tsx should filter bracket-prefixed profile logs');
check(app.includes('onClick={() => handleProfileSelect(profile.id)}'), 'App.tsx profile rows should select the active profile');
check(app.includes('onClick={e => e.stopPropagation()}'), 'App.tsx profile action cells should not trigger row selection');
check(app.includes('Failed to start sync: ${(e as Error).message}'), 'App.tsx should surface backend sync trigger errors to the operator');
check(app.includes("setView(view === 'dashboard' ? 'settings' : 'dashboard')"), 'App.tsx should toggle between dashboard and settings views');
check(app.includes("view === 'settings' ?"), 'App.tsx should render SettingsForm only in settings view');
check(app.includes('Sync Profiles'), 'App.tsx should render the dashboard profile table');
check(app.includes('Syncing') && app.includes('Ready') && app.includes('Disabled'), 'App.tsx should render profile status labels');
check(app.includes('No profiles found.'), 'App.tsx should render an empty profile table state');
check(app.includes('encodeURIComponent(profile.actualAiContainer)'), 'App.tsx should URL-encode Docker container names when polling logs');
check(app.includes('[sessionToken, activeProfileId, config.profiles, logViewMode]'), 'App.tsx AI log polling should rerun when the session token changes');
check(logConsole.includes('containerRef.current.scrollTop = scrollHeight - clientHeight') && logConsole.includes('}, [logs]);'), 'LogConsole should auto-scroll its own container when logs change');

const dockerfile = read('Dockerfile');
const dockerignore = read('.dockerignore');
const settingsForm = read('components/SettingsForm.tsx');
check(settingsForm.includes('Test failed: ${e.message}'), 'SettingsForm should label validation/connection failures as test failures');
check(settingsForm.includes('setSelectedProfileId(currentId => {'), 'SettingsForm should repair stale selected profile ids after config changes');
check(settingsForm.includes('nextProfiles.some(profile => profile.id === currentId)'), 'SettingsForm should keep the selected profile only when it still exists');
check(settingsForm.includes('setProfileCategories({});'), 'SettingsForm should clear category preview when no profile is selected');
check(settingsForm.includes('const handleAddProfile = () =>'), 'SettingsForm should include add profile behavior');
check(settingsForm.includes('id: uuidv4()') && settingsForm.includes('categories: defaultCategories'), 'SettingsForm should seed added profiles with an id and default categories');
check(settingsForm.includes('setSelectedProfileId(newProfile.id)'), 'SettingsForm should select newly added or duplicated profiles');
check(settingsForm.includes('const handleDuplicateProfile = (id: string) =>'), 'SettingsForm should include duplicate profile behavior');
check(settingsForm.includes('name: `${p.name} (Copy)`'), 'SettingsForm should name duplicated profiles as copies');
check(settingsForm.includes('const handleDeleteProfile = (id: string) =>'), 'SettingsForm should include delete profile behavior');
check(settingsForm.includes("profiles.filter(p => p.id !== id)") && settingsForm.includes("newProfiles.length > 0 ? newProfiles[0].id : null"), 'SettingsForm should remove deleted profiles and select a remaining profile when needed');
check(settingsForm.includes('value={selectedProfile.actualAiContainer || \'\'}'), 'SettingsForm should store selected Actual AI container per profile');
check(settingsForm.includes('setContainers(data)'), 'SettingsForm should load Docker containers for Actual AI selection');
check(settingsForm.includes('setDockerError(error.message)') && settingsForm.includes('{dockerError &&'), 'SettingsForm should surface Docker container discovery failures');
check(settingsForm.includes("handleProfileChange('actualServerUrl', e.target.value)"), 'SettingsForm should edit Actual server URL');
check(settingsForm.includes("handleProfileChange('actualBudgetId', e.target.value)"), 'SettingsForm should edit Actual budget sync ID');
check(settingsForm.includes("handleProfileChange('actualPassword', e.target.value)"), 'SettingsForm should edit Actual budget password');
check(settingsForm.includes("handleProfileChange('actualAiContainer', e.target.value)"), 'SettingsForm should edit Actual AI container selection');

check(dockerfile.includes('RUN npm ci'), 'Dockerfile build stage should use npm ci');
check(dockerfile.includes('RUN npm ci --omit=dev'), 'Dockerfile production stage should use npm ci --omit=dev');
check(dockerfile.includes('ENV DIST_DIR=/app-dist') && dockerfile.includes('CMD ["node", "server.js"]'), 'Dockerfile should serve image-built assets without writing into a bind-mounted /app directory at startup');
check(dockerfile.includes('git config --system --add safe.directory /host-project'), 'Dockerfile should allow the runtime user to run Git against the mounted host project');
check(dockerignore.includes('node_modules') && dockerignore.includes('data') && dockerignore.includes('.git'), '.dockerignore should exclude generated, local data, and Git metadata from Docker build contexts');

const dockerCompose = read('docker-compose.yml');
check(dockerCompose.includes('name: investec-actualbudget'), 'docker-compose.yml should use a stable project name when run from /host-project or the host checkout');
check(dockerCompose.includes('ports:') && dockerCompose.includes('"46490:46490"'), 'docker-compose.yml should publish the web app port');
check(dockerCompose.includes('host.docker.internal:host-gateway'), 'docker-compose.yml should support reaching host services from Linux containers');
check(dockerCompose.includes('./data:/app/data'), 'docker-compose.yml should persist app data');
check(dockerCompose.includes('${HOST_DIR:-.}:/host-project'), 'docker-compose.yml should mount HOST_DIR separately from image-owned /app for self-update support');
check(dockerCompose.includes('PROJECT_ROOT=/host-project'), 'docker-compose.yml should point maintenance commands at the mounted host project');
check(dockerCompose.includes('APP_PASSWORD=${APP_PASSWORD:-investec-sync-default}'), 'docker-compose.yml should pass the configured dashboard password into the container');
check(!dockerCompose.includes('${HOST_DIR:-.}:/app') && !dockerCompose.includes('/app/node_modules'), 'docker-compose.yml should not hide image app files with a project-root /app bind mount');
check(dockerCompose.includes('/var/run/docker.sock:/var/run/docker.sock'), 'docker-compose.yml should expose Docker socket access');

const nginxConfig = read('nginx.conf');
check(nginxConfig.includes('try_files $uri $uri/ /index.html;'), 'nginx.conf should support SPA fallback');
check(nginxConfig.includes('proxy_pass http://localhost:46490/api/;'), 'nginx.conf should proxy API requests to the backend');
check(nginxConfig.includes('add_header X-Frame-Options "SAMEORIGIN" always;'), 'nginx.conf should include API security headers');

const viteConfig = read('vite.config.ts');
check(viteConfig.includes('port: 5173'), 'vite.config.ts should run dev server on port 5173');
check(viteConfig.includes("target: 'http://127.0.0.1:46490'"), 'vite.config.ts should proxy /api to the backend');

const tsconfigText = read('tsconfig.json');
check(tsconfigText.includes('"App.tsx"'), 'tsconfig.json should include App.tsx');
check(tsconfigText.includes('"components/**/*.tsx"'), 'tsconfig.json should include components/**/*.tsx');

check(fs.existsSync(path.join(root, 'public', 'env-config.js')), 'public/env-config.js must exist');
check(fs.existsSync(path.join(root, 'scripts', 'test-runtime-safe.mjs')), 'scripts/test-runtime-safe.mjs must exist');
check(read('scripts/test-runtime-safe.mjs').includes('Windows-style host project paths'), 'test-runtime-safe should verify Windows-style host project paths');
check(read('scripts/test-runtime-safe.mjs').includes('verifyWorkerFailureExitCode'), 'test-runtime-safe should verify worker failure exit codes');

if (failures.length > 0) {
  console.error('Static verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Static verification passed (${records.length} feature rows).`);
