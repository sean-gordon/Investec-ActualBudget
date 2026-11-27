# Release 8.0.3: Reliable in-app self-updates and cleaner logs

Fixed in-app updates causing 502 Bad Gateway errors when replacing the running container, preserved `data/` bind mounts during container-triggered rebuilds, and cleaned up proxy errors and container logs in the UI.

- Changed `/api/update` and `/api/git/switch` to build the image first (`docker compose build`) and hand off `docker compose up -d --no-build --force-recreate` to a detached sibling container so stopping `investec-sync` no longer kills the updater mid-recreate.
- Added auto-detection of the host project path from the `/host-project` Docker mount if Host Project Path is left blank, prevented overlapping update runs with a `409` lock, and increased `exec` `maxBuffer` to 10 MB for Docker builds.
- Updated `docker-compose.yml` to mount `${HOST_DIR:-.}/data:/app/data` so container-triggered rebuilds always keep the real host `data/` folder.
- Stripped ANSI colour escape sequences and duplicate timestamps from Actual AI container logs in the live console.
- Replaced raw HTML 502/503/504 gateway error alerts with clear messages and synced the Update button's `Updating...` state with `/api/status`.

# Release 8.0.2: UI fixes and Actual Budget backwards compatibility

Resolved UI glitches, broken/unlinked settings controls, and Actual Budget budget-loading edge cases while preserving backwards compatibility with existing profiles and older Actual Budget configurations.

- Fixed encrypted Actual Budget detection (`missing-key` / `"encrypted"` errors), added an optional separate Budget Encryption Password field that falls back to the Server Password when blank, and added a local-ID `loadBudget()` fallback if `downloadBudget()` leaves the budget unloaded.
- Fixed undefined Tailwind tokens (`investec-400` and `animate-fade-in`) so Settings headings and transitions render properly.
- Fixed duplicate-profile secret handling so masked `********` placeholders are never saved as literal credentials on new profiles.
- Fixed unapplied JSON category edits being dropped on save, preserved stopped/unavailable Actual AI containers in the selector, kept the active Git branch visible when GitHub branch listing fails, and handled `401` session expiry cleanly in Settings.
- Fixed the double login error alert (now shown inline), fixed invalid `<div>` inside `<span>` markup, added Schedule column, Logout button, empty-state Settings shortcut, and tooltips/disabled states across dashboard actions.

# Release 8.0.1: Actual API 26.11.0 and Node 22

Updated `@actual-app/api` from `26.9.0` to `26.11.0` and upgraded the Docker base image to `node:22-trixie-slim` to resolve budget open/migration errors against newer Actual Budget servers (`No budget file is open`).

- Bumped `@actual-app/api` to `26.11.0` (matches current Actual Budget server schema migrations).
- Upgraded `Dockerfile` builder and runtime stages to `node:22-trixie-slim` (required by `@actual-app/api` 26.11.0).
- Included both the remote Actual server version and the local `@actual-app/api` version in budget-open error messages to make future version mismatches obvious.

# Release 8.0.0: Improve speed and cleanup

Trimmed unused packages, dead code, and non-solution files across the repository for faster installs, cleaner Docker builds, and a smaller codebase.

- Removed unused dependencies (`@types/uuid`, direct `body-parser`, `autoprefixer`, `postcss`, and `tailwindcss`) and switched the Express server to built-in `express.json()`.
- Removed dead files and AI/audit artefacts (`env.sh`, `metadata.json`, `nginx.conf`, `public/env-config.js`, `AGENTS.md`, `feature_status.csv`, `scripts/verify-static.mjs`, and `.github/` Gemini workflow/command files).
- Cleaned up unused code across `index.html`, `types.ts`, `server.js`, `App.tsx`, and `components/SettingsForm.tsx`.
- Updated `.gitignore` and `.dockerignore` to exclude local AI/agent files and runtime data cleanly.
- Rewrote `README.md` for clarity and up-to-date setup instructions.

# Release 7.0.2: Actual API 26.9.0

Updated `@actual-app/api` to the latest stable version, `26.9.0`, and pinned it for consistent installs. The app now checks that your budget opens before reporting a successful connection, with a clearer error if it cannot load.

This release also fixes Docker password forwarding and keeps the Compose project name consistent during updates.

Before rebuilding, set `DOCKER_GID` in `.env` to the value from `stat -c '%g' /var/run/docker.sock`. Then run `docker compose up -d --build --force-recreate`.

# Release v7.0.0 - Security Hardening

## 🚀 Key Highlights

This major release focuses on **Security Hardening** and **Infrastructure Protection**. It introduces essential authentication layers and resolves several critical vulnerabilities to ensure your financial data and secrets remain private and secure.

### ✨ New Features & Security Improvements

*   🔐 **Integrated Authentication System**:
    *   **Master Password Protection**: Access to the Sync Manager dashboard and API now requires a Master Password.
    *   **Secure Session Management**: All API communication is now authenticated via unique session tokens.
*   🛡️ **Enhanced Data Protection**:
    *   **Sensitive Data Masking**: All secrets (Investec Client IDs, Secrets, API Keys, and Actual passwords) are now masked in the UI and via the API, preventing accidental disclosure.
    *   **Mask-Aware Configuration**: The server intelligently handles masked data during configuration updates to preserve your real secrets while keeping them hidden from the UI.
*   🌐 **Network & Infrastructure Security**:
    *   **Strict TLS Verification**: Re-enabled standard SSL/TLS certificate verification for all outbound connections, protecting against Man-in-the-Middle (MitM) attacks.
    *   **Production Security Headers**: Integrated robust security headers in the Nginx configuration, including `Content-Security-Policy (CSP)`, `HSTS`, and `X-Frame-Options`.
    *   **Non-Root Execution**: The application processes inside the Docker container now run as a low-privilege `node` user instead of `root`, providing better isolation from the host system.
*   🛠️ **Dependency Audit & Patching**:
    *   **Clean Security Audit**: Updated core dependencies including `express` and `body-parser` to resolve known vulnerabilities (CVE-2024-45590).
    *   **Resolved Nested Issues**: Handled vulnerabilities in transitive dependencies (`qs`, `rollup`) to ensure a 0-vulnerability dependency tree.

---

# Release v6.5.0 - Stable

## 🚀 Key Highlights

This release represents a significant step towards a more robust, user-friendly, and transparent Investec Sync experience. It consolidates numerous fixes and features across multiple development cycles into a single, stable version.

### ✨ New Features & Major Improvements

*   **Reliable Auto-Update System**:
    *   **Self-Update Repair**: Critical fixes ensure the `docker compose` command executes correctly within the container by integrating `docker-compose-plugin`, enabling seamless, one-click updates directly from the UI.
    *   **Robust Update Process**: The update now uses a single, powerful command (`docker compose up -d --build --force-recreate --remove-orphans`) to build, replace, and clean up containers atomically, ensuring new code is always activated.
    *   **Update Debugging**: Persistent logs of the update process are now stored in `data/update.log`, accessible via a new UI button or API endpoint (`/api/debug/update-log`), greatly simplifying troubleshooting.
    *   **Automated Cleanup**: Old Docker images are automatically pruned after updates to reclaim disk space.
*   **Integrated & Contextual Log Viewer**:
    *   **Unified Log Console**: Merges System logs (Investec Sync events) and Actual AI logs (from your AI container) into a single, chronologically sorted stream.
    *   **Profile-Driven Display**: Clicking any profile row in the dashboard dynamically loads logs relevant to that specific profile.
    *   **Smart Log Filtering**: System logs are intelligently filtered to show only generic system events and events strictly pertaining to the selected profile. This includes advanced logic to prevent logs from profiles with overlapping names (e.g., "Sean" and "Sean Investec") from appearing incorrectly in other profiles' views.
    *   **Instant Log Clearing**: The log display now clears immediately upon profile switch, preventing "ghost logs" and providing a cleaner transition.
    *   **Actual AI Log Viewer**: Directly monitor live logs from your associated Actual AI Docker container. The profile settings now detect and list running Docker containers for easy selection.
*   **Enhanced UI/UX**:
    *   **Update History Button**: A dedicated button in the log panel header (`📄` icon) to toggle between live logs and the persistent update history.
    *   **Clearer Status Indicators**: Improved visual feedback for sync profiles.
    *   **Refined Settings**: Streamlined profile management and Git control.

### 🛠 Other Fixes

*   **Log Parsing**: Enhanced Docker log fetching to ensure correct timestamp parsing and sorting in the merged view.
*   **System Stability**: General stability improvements and minor bug fixes across the application.

