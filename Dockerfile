# Stage 1: Build the React application
FROM node:20-slim as builder

# Install build tools required for better-sqlite3 (native module used by Actual API)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies (including devDependencies for building)
RUN npm install

# Copy source code
COPY . .

# Build the frontend
RUN npm run build

# Stage 2: Production Server
FROM node:20-slim

WORKDIR /app

# Install build tools for production dependency compilation
# This is required because we are reinstalling modules in the clean stage
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json* ./

# Install only production dependencies
# This recompiles better-sqlite3 for the production environment
RUN npm install --omit=dev

# Copy built assets from builder stage
COPY --from=builder /app/dist ./dist

# Copy server script
COPY server.js .

# Create data directory for volume
RUN mkdir -p data

# Expose the application port
EXPOSE 46490

# Start the backend server
CMD ["node", "server.js"]
