# Use Node 20 Alpine for a small footprint
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install build tools for native dependencies (better-sqlite3) and SSL libraries
# Python3, make, and g++ are required for node-gyp
# openssl and ca-certificates are required for reliable HTTPS connections
RUN apk add --no-cache python3 make g++ openssl ca-certificates

# Force Root user to ensure write permissions on mapped volumes
USER root

# Install dependencies
COPY package*.json ./
# Use npm install to generate lockfile if missing and avoid EUSAGE errors
RUN npm install

# Copy source code
COPY . .

# Build the frontend (Vite)
RUN npm run build

# Expose the port
EXPOSE 46490

# Start the backend server
CMD ["node", "server.js"]
