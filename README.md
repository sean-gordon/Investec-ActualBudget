# Investec to Actual Budget Sync

A self-hosted dashboard to automatically synchronise transactions from multiple Investec South Africa (OpenAPI) accounts to Actual Budget instances.

## Security First

Code security is actively monitored by **Snyk** to ensure dependencies and container images remain free of known vulnerabilities.

[![Known Vulnerabilities](https://snyk.io/test/github/sean-gordon/Investec-ActualBudget/badge.svg)](https://snyk.io/test/github/sean-gordon/Investec-ActualBudget)

### 🛡️ Architecture & Data Privacy

*   **Process Isolation**: The sync engine runs in a dedicated "Worker Process" that is spawned only when needed and terminates immediately after completion. This ensures:
    *   **Memory Safety**: No residual data stays in memory.
    *   **Database Integrity**: Prevents database locks by ensuring a clean connection lifecycle.
*   **Containerized Environment**: The application runs within a Docker container, isolating it from the host system.
    *   **Networking**: Internal communication between the frontend and backend occurs over a private internal network (when configured with `network_mode: bridge`).
*   **Credential Handling**: 
    *   Investec API keys and Actual Budget passwords are stored locally in `data/settings.json` within the container's volume.
    *   Credentials are **never** transmitted to any third-party server. All traffic is strictly between your server, Investec, and your Actual Budget instance.
*   **Source Code Transparency**: The entire project is open-source. You can inspect every line of code to verify how your data is handled.

## Features

*   **Multi-Profile Support**: Manage multiple sync profiles (e.g., "Sean's Account", "Shelley's Account") from a single dashboard.
*   **Clean Table View**: Profiles are displayed in a responsive table, showing status, target, and schedule at a glance.
*   **Profile Controls**:
    *   **Enable/Disable**: Toggle profiles on or off directly from the dashboard or settings.
    *   **Test Credentials**: Verify your Investec and Actual Budget connections before saving.
    *   **Delete**: Remove unused profiles with a safe confirmation step.
*   **Flexible Targets**: Each profile can sync to a different Actual Budget server (different ports/URLs) or different budget files.
*   **Concurrent Syncing**: The system can now run sync jobs for different profiles in parallel without conflict.
*   **Secure Architecture**: Uses process isolation for every sync to prevent database locks.
*   **Automatic Account Creation**: Automatically creates accounts in Actual Budget based on your Investec products (e.g., "Private Bank Account 1234").
*   **Category Synchronisation**: Define your master category list in the Settings UI. The system ensures these groups and categories exist in your budget.
*   **Smart Deduplication**: Prevents duplicate transactions even if run multiple times a day.
*   **Transactions Only**: This tool merges transactions into your existing budget; it does not overwrite existing transaction data.
*   **Auto-Update System**: Easily update to the latest version directly from the dashboard with a single click.

---

## Prerequisites

Before installing this sync tool, ensure you have the following:

### 1. Docker
You must have Docker and Docker Compose installed on your machine or server.

### 2. Actual Budget
You need a running instance of **Actual Budget** (Self-Hosted). This tool syncs data *to* your Actual Budget instance.
*   **Get Actual Budget**: [Official Installation Guide](https://actualbudget.org/docs/install/)

---

## Installation

Follow these steps to get the system running on your server.

### 1. Clone the Repository
Open your terminal and clone the project files from GitHub:

```bash
git clone https://github.com/sean-gordon/Investec-ActualBudget
```

### 2. Enter the Directory
Navigate into the newly created folder:

```bash
cd Investec-ActualBudget
```

### 3. Build and Run
Start the application using Docker Compose. This will build the container and start the server:

```bash
docker compose up -d --build
```

The app will start on port **46490**.

---

## Updates & Maintenance

Keeping the application up-to-date is simple.

### Method 1: Automatic Update (Recommended)
1.  Open the dashboard.
2.  If a new version is available, an **Update Available** button will appear in the top header.
3.  Click the button. The system will pull the latest code and rebuild itself automatically.

### Method 2: Manual Update
Run the following commands in your terminal inside the project folder:

```bash
git pull
docker compose up -d --build
```

---

## Configuration

1.  Open your browser and go to `http://localhost:46490` (or your server IP).
2.  Click the **Settings** (Gear icon) in the top right.

### 1. Sync Profiles
The "Profiles" system allows you to manage multiple sync configurations independently.
*   **Create Profile**: Click the `+` button to add a new profile.
*   **Name**: Give your profile a descriptive name (e.g., "Sean's Investec").
*   **Enable/Disable**: Use the toggle to temporarily pause syncing for a profile without deleting it.
*   **Test Connections**: Use the "Test Connection" buttons to verify your credentials for both Investec and Actual Budget.
*   **Credentials**: Enter the unique Investec Client ID, Secret, and API Key for this profile.
*   **Actual Budget Target**: 
    *   **Server URL**: Specify the exact URL and port for the target Actual Budget instance (e.g., `http://192.168.1.50:5006` for Sean, `http://192.168.1.50:5007` for Shelley).
    *   **Sync ID**: The specific budget ID to sync with.
    *   **Password**: The specific password for that file/server.
*   **Schedule**: Set an independent cron schedule for this profile.

### 2. Category Management
This feature allows you to define a standard set of Category Groups and Categories.
*   **How it works**: When a Sync runs, the system checks if these Groups and Categories exist in your Actual Budget.
*   **Additive Only**: If a category is missing, it is **created**. If a category already exists, it is left alone. The system **never deletes** categories from your budget.
*   **How to Edit**:
    1.  In Settings, find the **Global Category Mapping** section.
    2.  Click **Edit** to reveal the JSON editor.
    3.  The format is `"Group Name": ["Category 1", "Category 2"]`.
    4.  Modify the list as needed and click **Save Configuration**.

**Example Structure:**
```json
{
  "🏠 Housing": [
    "Rent",
    "Utilities"
  ],
  "🚗 Transport": [
    "Fuel",
    "Insurance"
  ]
}
```

### 3. Git Repository Control
*   **Host Project Path**: **(Important)** This is required for the "Update" and "Switch Branch" buttons to work.
    *   Enter the absolute path to the project folder on your server (e.g., `/home/user/Investec-ActualBudget` or `/data/Investec-ActualBudget`).
    *   *Why?* This allows the Docker container to correctly mount your source code during self-updates.
    *   **Tip:** To find this path on Linux, open your terminal in the project folder and run: `pwd`
*   **Target Branch**: Select a branch (like `main` or `Dev`) and click **Switch & Rebuild**.

---

## 🤖 Supercharge with Actual AI

To get the most out of your automated budget, we recommend pairing this Sync tool with **Actual AI**.

While **Investec Sync** handles the reliable delivery of bank transactions into Actual, **Actual AI** uses Artificial Intelligence to automatically categorise those transactions, assign payees, and clean up descriptions.

*   **Get Actual AI here:** [https://github.com/sakowicz/actual-ai](https://github.com/sakowicz/actual-ai)

**The Ultimate Flow:**
1.  **Investec Sync** -> Downloads transactions -> Pushes to Actual.
2.  **Actual AI** -> Detects new transactions -> Categorises them automatically.

---

## Advanced: Docker Network Setup

By default, this project uses `network_mode: "host"` for simplicity. However, if you prefer to run it on a shared internal Docker network with Actual Budget, follow these steps:

### 1. Create the Network
Run this command to create a bridge network:
```bash
docker network create actual_network
```

### 2. Update Actual Budget
Modify the `docker-compose.yml` for your **Actual Budget** container to join this network:

```yaml
services:
  actual_server:
    container_name: actual_server
    # ... other settings ...
    networks:
      - actual_network

networks:
  actual_network:
    external: true
```

### 3. Update Investec Sync
Modify the `docker-compose.yml` in this folder (`Investec-ActualBudget`).
1.  **Remove** the line `network_mode: "host"`.
2.  **Add** the network configuration:

```yaml
services:
  investec-sync:
    build: .
    # REMOVED: network_mode: "host"
    networks:
      - actual_network
    volumes:
      - ./data:/app/data
    environment:
      - NODE_ENV=production

networks:
  actual_network:
    external: true
```

### 4. Update Settings Configuration
In the Investec Sync Web UI settings:
*   Change **Server URL** to: `http://actual_server:5006`
*   *(Note: "actual_server" matches the `container_name` or service name defined in step 2)*.

---

## Troubleshooting

### "Could not get remote files" / "Server cannot find budget file"
This usually means your Sync ID is correct, but the file doesn't exist on the server yet.
1.  Open Actual Budget in your browser.
2.  Go to **File Menu > Close File**.
3.  Look at the list of budgets.
4.  If your budget says **"Local"**, you must upload it.
    *   Select the file -> Manage -> **Upload to Server**.
    *   If that option is missing: Open the file -> Settings -> Export -> Close File -> **Import File** (Choose "Actual"). This creates a fresh Remote copy.

### "Fetch Failed" / Network Errors
*   Ensure `network_mode: "host"` is in your `docker-compose.yml` (this is default in the repo).
*   Use `http://127.0.0.1:5006` for the Server URL.

### Accounts Merging Incorrectly
The system tries to match accounts by name.
*   It prioritises your Investec **Reference Name** (Nickname).
*   If that is missing or matches the account holder name, it uses **Product Name + Last 4 Digits**.
*   To fix merging issues, give your accounts distinct nicknames in Investec Online Banking.
