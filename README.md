# Investec to Actual Budget Sync

A self-hosted dashboard to automatically synchronize transactions from Investec South Africa (OpenAPI) to Actual Budget.

## Features

*   **Secure Architecture**: Uses process isolation for every sync to prevent database locks.
*   **Automatic Account Creation**: Automatically creates accounts in Actual Budget based on your Investec products (e.g., "Private Bank Account 1234").
*   **Smart Deduplication**: Prevents duplicate transactions even if run multiple times a day.
*   **Transactions Only**: This tool merges transactions into your existing budget; it does not overwrite categories or rules.

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

### Investec Settings
You need to apply for "Programmable Banking" access in your Investec Online Banking.
*   **Client ID**: Provided by Investec.
*   **Secret ID**: Provided by Investec.
*   **API Key**: The API key you generated in the Programmable Banking portal.

### Actual Budget Settings
*   **Server URL**: Usually `http://127.0.0.1:5006` (if using Host Mode).
*   **Sync ID**: Found in Actual Budget under **Settings > Advanced Settings**.
    *   *Important*: Ensure your budget is "Remote" (uploaded), not "Local". Check this via **File > Close File** in Actual Budget.
*   **Password**:
    *   If your file has **End-to-End Encryption**, enter the File Password.
    *   If no encryption, but the server has a password, enter the Server Password.

### Automation
*   **Cron Schedule**: Enter a cron expression to automate syncing.
    *   Run once a day at midnight: `0 0 * * *`
    *   Run every 6 hours: `0 */6 * * *`

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