# Use Node 20 Alpine
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install build tools for native dependencies (better-sqlite3)
# This is critical for the Actual Budget database engine on Alpine
RUN apk add --no-cache python3 make g++

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Build the frontend (Vite)
RUN npm run build

# Expose the port
EXPOSE 46490

# Start the backend server
CMD ["node", "server.js"]