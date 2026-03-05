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
