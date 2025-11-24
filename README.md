# Investec to Actual Budget Sync

A self-hosted dashboard to automatically synchronize transactions from Investec South Africa (OpenAPI) to Actual Budget.

## Features

*   **Secure Architecture**: Uses process isolation for every sync to prevent database locks.
*   **Automatic Account Creation**: Automatically creates accounts in Actual Budget based on your Investec products (e.g., "Private Bank Account 1234").
*   **Category Synchronization**: Define your master category list in the Settings UI. The system ensures these groups and categories exist in your budget.
*   **Smart Deduplication**: Prevents duplicate transactions even if run multiple times a day.
*   **Transactions Only**: This tool merges transactions into your existing budget; it does not overwrite existing transaction data.

---

## Prerequisite: Docker

You must have Docker and Docker Compose installed on your machine or server.

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

## Supercharge with Actual AI

To get the most out of your automated budget, I recommend pairing this Sync tool with **Actual AI**.

While **Investec Sync** handles the reliable delivery of bank transactions into Actual, **Actual AI** uses Artificial Intelligence to automatically categorise those transactions, assign payees, and clean up descriptions.

*   **Get Actual AI here:** [https://github.com/sakowicz/actual-ai](https://github.com/sakowicz/actual-ai)

**The Ultimate Flow:**
1.  **Investec Sync** -> Downloads transactions -> Pushes to Actual.
2.  **Actual AI** -> Detects new transactions -> Categorizes them automatically.

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
*   It prioritizes your Investec **Reference Name** (Nickname).
*   If that is missing or matches the account holder name, it uses **Product Name + Last 4 Digits**.
*   To fix merging issues, give your accounts distinct nicknames in Investec Online Banking.
