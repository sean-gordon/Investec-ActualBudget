# Release v6.0.0 - Major Stability & Architecture Update

## 🚀 Key Highlights
This release introduces a complete architectural rewrite of the synchronization engine ("Split-Brain" model), resolving persistent connection issues, database locks, and account merging errors.

### 🛠 Major Fixes
*   **Process Isolation**: The sync engine now runs in a separate "Worker Process" for every action. This eliminates "Database Locked" errors and ensures a clean memory state for every sync.
*   **Authentication Overhaul**: Fixed connection logic to match the official Actual AI implementation. Now correctly handles Server Passwords vs. End-to-End Encryption passwords, solving the "Could not get remote files" error on password-protected servers.
*   **Account Separation**: Fixed a bug where multiple Investec accounts were merging into one under the account holder's name. Accounts are now uniquely identified by your Investec Reference Name (Nickname) or Product Name + Last 4 Digits.

### ✨ New Features
*   **Automatic Account Creation**: If an Investec account doesn't exist in Actual, it is automatically created with the correct type (Checking/Credit).
*   **Smart Date Logic**: Transaction dates now prioritize the "Swipe Date" (Transaction Date) over the "Posting Date" for better budgeting accuracy.
*   **Test Buttons**: New independent "Test Investec" and "Test Actual" buttons in Settings to verify credentials separately.
*   **Troubleshooting UI**: Added built-in guides for resolving "Local vs Remote" file issues directly in the dashboard.

### 🐳 Docker & Networking
*   **IPv4 Enforcement**: Fixed Node.js connection failures to `localhost` inside Docker.
*   **SSL Support**: Added native SSL libraries (`openssl`, `ca-certificates`) to the container to ensure robust secure connections to banking APIs.
*   **Host Networking**: Optimized for `network_mode: host` for easier local configuration.

## 📦 Upgrade Instructions

1.  **Pull the latest changes**:
    ```bash
    git pull
    ```

2.  **Rebuild the container** (Required for SSL and Permission fixes):
    ```bash
    docker compose up -d --build
    ```
