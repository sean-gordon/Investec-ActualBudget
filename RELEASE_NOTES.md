# Release v6.4.2 - Integrated Log Viewer

## 🚀 Key Highlights
This release unifies the logging experience. Now, clicking on a profile in the dashboard automatically loads its corresponding Actual AI logs alongside the system logs.

### ✨ New Features
*   **Integrated Log Console**: The "Live Logs" panel now combines:
    *   **System Logs**: Sync events, errors, and status updates (Blue Badge).
    *   **Actual AI Logs**: Real-time output from your AI classification container (Purple Badge).
*   **Contextual Selection**: Clicking a row in the "Sync Profiles" table instantly switches the log view to show relevant information for that profile.
*   **Default Selection**: The first active profile is automatically selected on load.

### 🛠 Fixes
*   **Log Parsing**: Added timestamp support to Docker log fetching to ensure correct sorting in the merged view.

---

# Release v6.4.1 - Update Debugging

## 🚀 Key Highlights
This release improves the robustness of the self-update mechanism and adds persistent logging to help diagnose update failures.

### 🛠 Fixes & Improvements
*   **Persistent Update Logs**: Updates are now logged to a file on the server. You can view this log via the `/api/debug/update-log` endpoint (or check `data/update.log` in your volume) to see exactly why an update might fail.
*   **Robust Update Process**: The update command has been split into distinct steps (Pull -> Build -> Up) with error checking at each stage.
*   **Docker Compose Check**: The system now verifies that `docker compose` is available before attempting an update.

---

# Release v6.4.0 - Actual AI Log Viewer

## 🚀 Key Highlights
This release adds the ability to monitor your **Actual AI** containers directly from the Investec Sync dashboard. This is crucial for debugging classification issues without needing to SSH into your server.

### ✨ New Features
*   **Actual AI Log Viewer**: 
    *   **Live Log Streaming**: View the real-time logs of your Actual AI docker container.
    *   **Profile Association**: Link specific Actual AI containers to specific Sync Profiles.
    *   **Context Switching**: Easily switch between the System Logs (Investec Sync) and Actual AI Logs using a dropdown in the "Live Logs" panel.
    *   **Auto-Polling**: AI Logs update automatically every 5 seconds.
*   **Container Selection**:
    *   The Profile Settings form now auto-detects running Docker containers and provides a dropdown to select which one runs Actual AI for that profile.

### 🛠 Fixes
*   **Performance**: Optimized log polling to reduce server load.

---

# Release v6.3.3 - Update Mechanism Fix

## 🚀 Key Highlights
This release fixes a critical bug in the self-update system where the `docker compose` command was missing from the container, preventing automatic updates from completing successfully.

### 🛠 Fixes
*   **Self-Update Repair**: Added `docker-compose-plugin` to the Docker image. This ensures the update command running inside the container can successfully rebuild and restart the application.

---

# Release v6.3.2 - Scrolling & Update Fixes

## 🚀 Key Highlights
This release addresses critical usability issues, ensuring the dashboard works smoothly on all devices and updates reliably.

### 🛠 Fixes
*   **Reliable Updates**: Hardened the self-update command to force a container rebuild (`--force-recreate`). This ensures you're always running the latest code after clicking "Update".
*   **Scroll Lock**: Fixed an issue where the Live Logs panel would scroll the entire webpage down. Now, only the log panel itself scrolls, keeping the main dashboard layout stable and accessible.
*   **Layout Polish**: Removed the redundant "Server Time" card and optimized the dashboard to fit perfectly within the browser viewport (no double scrollbars).
*   **Profile Toggling**: Fixed a bug where toggling one profile's status (Enable/Disable) could inadvertently affect others.

---

# Release v6.3.1 - Enhanced Profile Management

## 🚀 Key Highlights
This release refines the Multi-Profile system with a cleaner table interface, status indicators, and more granular control over your sync configurations.

### ✨ New Features
*   **Table View**: The main dashboard now displays profiles in a clean, responsive table, showing you the status, target server, and schedule for each profile at a glance.
*   **Enable/Disable Profiles**: You can now toggle profiles on or off directly from the dashboard or the settings page. Disabled profiles will not run scheduled or manual syncs.
*   **Delete Profiles**: Added the ability to delete profiles (with confirmation) directly from the dashboard table.
*   **Connection Testing**: Re-introduced the "Test Connection" buttons in the profile editor. You can now verify your Investec credentials and Actual Budget connection individually before saving.
*   **Status Indicators**: The table provides clear visual feedback on whether a profile is "Ready", "Syncing", or "Disabled".

### 🛡 Security & Maintenance
*   **Vulnerability Fixes**: Updated dependencies to resolve known vulnerabilities in `esbuild` / `vite`.
*   **Port Configuration**: The application port can now be easily changed in `docker-compose.yml` via the `PORT` environment variable.

---

# Release v6.3.0 - Multi-Profile Support

## 🚀 Key Highlights
This release introduces full support for **Sync Profiles**. You can now configure multiple independent Investec accounts and sync them to completely different Actual Budget instances or files.

### ✨ New Features
*   **Multi-Profile Management**: 
    *   Manage multiple configurations (Profiles) from a single dashboard.
    *   Create, Edit, Duplicate, and Delete profiles easily.
    *   Each profile has its own:
        *   Investec API Credentials.
        *   Actual Budget Server URL & Port (e.g., `localhost:5006` vs `localhost:5007`).
        *   Budget ID & Password.
        *   Cron Schedule.
*   **Concurrent Syncing**: The system can now run sync jobs for different profiles in parallel without conflict.
*   **Dashboard Upgrade**: The main dashboard now lists all your active profiles with individual "Sync Now" controls and status indicators.
*   **Automatic Migration**: Existing configurations are automatically migrated to a "Default Profile" upon update.

### 🛠 Improvements
*   **Data Isolation**: Each profile uses a unique, isolated temporary data directory during sync to prevent file locking issues.
*   **Settings UI**: Completely redesigned Settings page with a Master-Detail view for better usability.

---

# Release v6.2.2 - Reliable Self-Updates

## 🚀 Key Highlights
This release perfects the self-update and branch switching mechanism by allowing you to specify the exact location of your project on the host server. This ensures Docker always mounts the correct files during an update.

### ✨ New Features
*   **Host Project Path Setting**: A new configuration field in "Git Repository Control" allows you to define the absolute path to your project (e.g., `/data/Investec-ActualBudget`).
    *   **Why is this needed?** When running inside a container, the app doesn't know where it lives on your actual server. Telling it the path allows it to control the Docker Daemon correctly to rebuild itself.
*   **Startup Confirmation**: The system now logs the active Git branch upon startup, confirming that your branch switch was successful.
*   **GitHub Link**: Added a quick link to the GitHub repository in the dashboard header.

### 🛠 Fixes
*   **"Dubious Ownership" Error**: Fixed Git permission errors when accessing the mounted source code.
*   **Frontend Asset Persistence**: Fixed an issue where the UI would disappear during development builds because of volume mounting.

---

# Release v6.2.1 - Git Integration & Self-Repair

## 🚀 Key Highlights
This release brings full Git integration to the dashboard, allowing you to switch branches (e.g., test new features in `Dev`) and repair the installation directly from the UI. It also fixes the underlying architecture to allow the container to update itself reliably.

### ✨ New Features
*   **Git Branch Switching**: You can now switch between different branches (like `Dev` or `main`) directly from the Settings menu.
    *   **Auto-Rebuild**: Switching branches automatically pulls the new code and rebuilds the Docker container.
*   **Self-Healing Architecture**:
    *   **Docker Socket Mounting**: The container now has access to the host's Docker daemon, allowing it to restart and rebuild itself without user intervention.
    *   **Host Volume Mounting**: The container now directly accesses the host's `.git` folder, ensuring `git pull` commands update the actual source code on your server.

### 🛠 Fixes
*   **Missing Dependencies**: Added `git` and `docker-cli` to the container image.
*   **Update Loop**: Fixed an issue where the "Update" button would fail because the container couldn't see the git repository.

---

# Release v6.2.0 - Auto-Update & Version Control

## 🚀 Key Highlights
This release introduces a self-update mechanism, making it easier than ever to keep your sync tool running with the latest features and fixes.

### ✨ New Features
*   **Auto-Update System**: You can now update the application directly from the dashboard.
    *   **Version Check**: The system automatically checks against the official GitHub repository for new releases.
    *   **One-Click Update**: If a new version is available, a pulsing "Update Available" button appears in the header. Clicking it will pull the latest code and rebuild the container automatically.
*   **Live Version Status**: The dashboard header now displays your current server version and connection status in real-time.

### 🛠 Improvements
*   **Version Visibility**: Added API endpoints to expose the running version to the frontend.
*   **System Stability**: The update process safely restarts the service, ensuring configuration files remain intact.

---

# Release v6.1.1 - Category Management & UK Localisation

## 🚀 Key Highlights
This release introduces powerful new tools for managing your budget structure and aligns the application with British English standards.

### ✨ New Features
*   **Category Management**: You can now define a master list of Category Groups and Categories in the Settings UI.
    *   **Additive Sync**: The system checks your budget during every sync. If a category is missing, it is automatically created. Existing categories are never deleted or modified.
    *   **JSON Editor**: Easily configure your tree structure directly in the dashboard.
*   **Actual AI Integration**: Documentation added for integrating with **Actual AI** to automate transaction categorisation after syncing.

### 🛠 Major Fixes & Improvements
*   **UK English Localisation**: Updated all logs, comments, and documentation to British English (e.g., *Synchronisation*, *Initialise*).
*   **Process Isolation**: The sync engine runs in a separate "Worker Process" for every action to prevent database locks and ensure memory stability.
*   **Authentication Overhaul**: Fixed connection logic to match the official Actual AI implementation. Now correctly handles Server Passwords vs End-to-End Encryption passwords, resolving "Could not get remote files" errors.
*   **Account Separation**: Fixed a bug where multiple Investec accounts were merging into one. Accounts are now uniquely identified by your Investec Reference Name (Nickname) or Product Name + Last 4 Digits.
*   **Automatic Account Creation**: If an Investec account doesn't exist in Actual, it is automatically created with the correct type (Checking/Credit).

### 🐳 Docker & Networking
*   **SSL Support**: Added native SSL libraries (`openssl`, `ca-certificates`) to the container to ensure robust secure connections to Investec and self-hosted servers.
*   **IPv4 Enforcement**: Fixed Node.js connection failures to `localhost` inside Docker.

## 📦 Upgrade Instructions

1.  **Pull the latest changes**:
    ```bash
    git pull
    ```

2.  **Rebuild the container** (Required for new features):
    ```bash
    docker compose up -d --build
    ```
