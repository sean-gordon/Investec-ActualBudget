# Investec to Actual Budget Sync

A self-hosted dashboard to automatically synchronise transactions from Investec South Africa (OpenAPI) to Actual Budget.

## Features

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

### 1. Investec Credentials
You need to apply for "Programmable Banking" access in your Investec Online Banking.
*   **Client ID**: Provided by Investec.
*   **Secret ID**: Provided by Investec.
*   **API Key**: The API key you generated in the Programmable Banking portal.

### 2. Actual Budget Settings
*   **Server URL**: Usually `http://127.0.0.1:5006` (if using Host Mode).
*   **Sync ID**: Found in Actual Budget under **Settings > Advanced Settings**.
    *   *Important*: Ensure your budget is "Remote" (uploaded), not "Local". Check this via **File > Close File** in Actual Budget.
*   **Password**:
    *   If your file has **End-to-End Encryption**, enter the File Password.
    *   If no encryption, but the server has a password, enter the Server Password.

### 3. Category Management
This feature allows you to define a standard set of Category Groups and Categories.
*   **How it works**: When a Sync runs, the system checks if these Groups and Categories exist in your Actual Budget.
*   **Additive Only**: If a category is missing, it is **created**. If a category already exists, it is left alone. The system **never deletes** categories from your budget.
*   **How to Edit**:
    1.  In Settings, find the **Category Management** section.
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

### 4. Automation
*   **Cron Schedule**: Enter a cron expression to automate syncing.
    *   Run once a day at midnight: `0 0 * * *`
    *   Run every 6 hours: `0 */6 * * *`

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
