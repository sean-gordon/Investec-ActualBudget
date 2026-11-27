# Stage 1: Build the React application
FROM node:22-trixie-slim AS builder

# Install build tools required for better-sqlite3 (native module used by Actual API)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies exactly as locked (including devDependencies for building)
RUN npm ci

# Copy source code
COPY . .

# Build the frontend
RUN npm run build

# Stage 2: Production Server
FROM node:22-trixie-slim

WORKDIR /app

# Install build tools for production dependency compilation
# This is required because we are reinstalling modules in the clean stage
# Added git for auto-update functionality and openssl for secure connections
# Added curl and gnupg to install docker cli
RUN apt-get update && apt-get install -y python3 make g++ git openssl ca-certificates curl gnupg && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/debian $(grep -oP '(?<=^VERSION_CODENAME=)[a-z]+' /etc/os-release) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null && \
    apt-get update && apt-get install -y docker-ce-cli docker-compose-plugin && \
    rm -rf /var/lib/apt/lists/*

# Fix for "dubious ownership" errors when host project paths are mounted
RUN git config --system --add safe.directory /app && \
    git config --system --add safe.directory /host-project

# Prepare directories owned by the non-root node user before installing dependencies
# This avoids an expensive recursive chown over node_modules on every rebuild
RUN mkdir -p /app/data /app-dist && chown node:node /app /app/data /app-dist

# Switch to non-root user
USER node

# Copy package files
COPY --chown=node:node package.json package-lock.json* ./

# Install only production dependencies exactly as locked
# This recompiles better-sqlite3 for the production environment
RUN npm ci --omit=dev

# Copy built assets from builder stage to a safe location
COPY --chown=node:node --from=builder /app/dist /app-dist

# Copy server scripts
COPY --chown=node:node server.js transaction-sync.js ./

# Expose the application port
EXPOSE 46490

# Serve the frontend built into the image even when /app is bind-mounted at runtime
ENV DIST_DIR=/app-dist

# Start the backend server
CMD ["node", "server.js"]
