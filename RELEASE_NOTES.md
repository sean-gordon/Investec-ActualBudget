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
