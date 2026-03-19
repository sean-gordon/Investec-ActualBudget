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

