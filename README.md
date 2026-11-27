# Investec to Actual Budget sync

A self-hosted dashboard that synchronises transactions from Investec South Africa (OpenAPI) accounts into Actual Budget.

## Security and architecture

[![Known Vulnerabilities](https://snyk.io/test/github/sean-gordon/Investec-ActualBudget/badge.svg)](https://snyk.io/test/github/sean-gordon/Investec-ActualBudget)

Snyk monitors the repository's dependencies and container images for known vulnerabilities.

Each sync or credential test runs in its own worker process that starts on demand and exits as soon as the job finishes. That keeps the main server separate from the sync engine, leaves no sync data in memory after a run, and prevents Actual's local database from locking across jobs.

The application runs inside a Docker container. When configured with `network_mode: bridge`, frontend-to-backend traffic stays on a private internal network. Investec API keys and Actual Budget passwords are stored locally in `data/settings.json` inside the mounted volume and are only sent between your server, Investec, and your Actual Budget instance. All source code is open in this repository.

## Features

- Manage multiple sync profiles (for example, "Sean's Account" and "Shelley's Account") from one dashboard table showing each profile's status, target, and actions.
- Enable or disable profiles without deleting them, test Investec and Actual Budget connections before saving, and remove unused profiles with a confirmation prompt.
- Point each profile at a different Actual Budget server URL, port, or budget file, and run sync jobs for different profiles concurrently in isolated worker processes.
- Create missing accounts in Actual Budget automatically from your Investec products (for example, "Private Bank Account 1234").
- Define category groups and categories in Settings so the sync creates any missing ones in your budget.
- Deduplicate transactions safely across repeated runs on the same day. When Investec changes a pending transaction's `postedOrder` from `0` to its posted number, the sync updates the matching Actual transaction's import ID before importing, keeping the existing entry and any user edits. Matching requires the same account, transaction date, description, and signed amount; separate posted payments keep their distinct IDs.
- Merge new transactions into your budget without overwriting existing transaction data.
- Trigger updates from the dashboard. The updater fetches remote code, creates a backup branch if local history has diverged, rebuilds the container, and replaces the running instance.
- View live System logs and Actual AI container logs in a single chronologically sorted console. Clicking a profile row filters the console to generic system events and entries for that profile, even when profile names overlap. Running Docker containers are detected automatically for Actual AI selection in Settings, and a header toggle switches between live logs and persistent update history logs.

## Prerequisites

- Docker and Docker Compose on your machine or server.
- A running self-hosted Actual Budget instance. See the [Official Installation Guide](https://actualbudget.org/docs/install/).

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/sean-gordon/Investec-ActualBudget
```

### 2. Enter the directory

```bash
cd Investec-ActualBudget
```

### 3. Build and run

Create a `.env` file in the project directory and set the dashboard password:

```dotenv
APP_PASSWORD=replace-with-a-strong-password
```

Find the Docker socket group ID with `stat -c '%g' /var/run/docker.sock` and add `DOCKER_GID=<group-id>` to the same `.env` file. Docker Compose requires this value so the non-root app user can access the mounted Docker socket.

Build the container and start the server with Docker Compose:

```bash
docker compose up -d --build
```

The app listens on port `46490`.

If your Actual Budget server runs on the Docker host, use `http://host.docker.internal:<port>` as the server URL from inside the container.

The container runs as the non-root `node` user. Docker-backed features such as Actual AI container discovery, Docker log viewing, self-update rebuilds, and image pruning require the mounted Docker socket to be usable by that user. Set `DOCKER_GID` in `.env` to the group ID of the host Docker socket before starting Compose:

```bash
stat -c '%g' /var/run/docker.sock
```

For example, if the command prints `990`, add `DOCKER_GID=990` to `.env`, then recreate the service:

```bash
docker compose up -d --build --force-recreate
```

Docker socket access gives the container broad control over the Docker host, so only grant it in trusted deployments.

## Updates and maintenance

### Automatic update (recommended)

1. Open the dashboard.
2. When a newer version is available, an Update button appears in the top header.
3. Click it. The app fetches the latest code, recovers from divergent branch history when needed, and rebuilds the container.

### Manual update

Run these commands inside the project folder:

```bash
git fetch --all --tags --prune
git merge --ff-only origin/$(git branch --show-current)
docker compose up -d --build
```

## Configuration

Open `http://localhost:46490` (or your server IP) in a browser and click the Settings gear icon in the top right.

### Sync profiles

Each profile holds an independent sync configuration:

- Click `+` to add a profile and give it a name (for example, "Sean's Investec").
- Use the enabled toggle to pause syncing for a profile without deleting it.
- Enter the Investec Client ID, Secret ID, and API Key, and use Test Connection to verify access.
- Set the Actual Budget Server URL (for example, `http://192.168.1.50:5006` for Sean or `http://192.168.1.50:5007` for Shelley), Budget Sync ID, and optional password, then test the connection.
- Optionally select an Actual AI Docker container and set a cron schedule for automated syncs.

### Category management

During a sync, the worker checks whether the configured category groups and categories exist in your Actual Budget. Missing ones are created and existing ones are left alone; the sync never deletes categories.

To edit a profile's categories, open the Category Mapping section in Settings, click Edit JSON, update the `"Group Name": ["Category 1", "Category 2"]` structure, apply your changes, and save.

Example structure:

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

### Git repository control

Set the Host Project Path if you want to use the in-app Update or Switch Branch buttons. Enter the absolute path to this project folder on the host (for example, `/home/user/Investec-ActualBudget` or `/data/Investec-ActualBudget`; run `pwd` in the folder on Linux to get it). Docker mounts that path at `/host-project` for self-updates while keeping the running application files inside the image.

Use Target Branch to pick a branch (such as `main` or `Dev`) and switch or upgrade.

## Using Actual AI

Investec Sync imports bank transactions into Actual Budget. If you also want automatic categorisation, payee assignment, and cleaned-up descriptions, you can pair it with [Actual AI](https://github.com/sakowicz/actual-ai). Once Investec Sync pushes new transactions into Actual, Actual AI picks them up and categorises them.

## Docker network setup

By default, the compose file publishes port `46490` and maps `host.docker.internal` so the container can reach services on the Docker host. If you prefer to connect Actual Budget and Investec Sync over a shared Docker bridge network instead, follow the steps below.

### 1. Create the network

```bash
docker network create actual_network
```

### 2. Update Actual Budget

Add the network to your Actual Budget `docker-compose.yml`:

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

Edit `docker-compose.yml` in `Investec-ActualBudget`. Keep the `ports` mapping if you still want to open the UI from the host, and attach the shared network:

```yaml
services:
  investec-sync:
    build: .
    ports:
      - "46490:46490"
    networks:
      - actual_network
    volumes:
      - ./data:/app/data
      - ${HOST_DIR:-.}:/host-project
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - NODE_ENV=production
      - PORT=46490
      - PROJECT_ROOT=/host-project

networks:
  actual_network:
    external: true
```

### 4. Update settings

In the Investec Sync settings, set Server URL to `http://actual_server:5006`, where `actual_server` matches the `container_name` or service name from step 2.

## Troubleshooting

### "Could not get remote files" or "Server cannot find budget file"

Your Sync ID is valid, but the budget file has not been uploaded to the Actual server yet.

1. Open Actual Budget in your browser.
2. Go to File Menu > Close File.
3. Check the list of budgets. If yours is marked "Local", select it, open Manage, and choose Upload to Server.
4. If Upload to Server is missing, open the file, go to Settings > Export, close the file, and use Import File (choose "Actual") to create a remote copy.

### "Fetch Failed" or network errors

- If Actual Budget runs on the Docker host, use `http://host.docker.internal:5006` as the Server URL.
- If Actual Budget runs on the same custom Docker network, use its service name (for example, `http://actual_server:5006`).
- From outside Docker, open this app at `http://localhost:46490`.

### Docker unavailable in Settings

Check that `.env` contains `DOCKER_GID` matching the host socket's group ID (`stat -c '%g' /var/run/docker.sock`), then recreate the service with `docker compose up -d --build --force-recreate`. Docker socket access gives the app broad control over the Docker host.

### Accounts merging incorrectly

The sync matches accounts by name. It checks your Investec Reference Name (nickname) first. If that is missing or matches the account holder name, it falls back to the product name plus the last four digits of the account number. To avoid collisions, give each account a distinct nickname in Investec Online Banking.
