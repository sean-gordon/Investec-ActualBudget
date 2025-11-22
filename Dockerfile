# Stage 1: Build the React application
FROM node:20 as builder

# Install build tools (Debian)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install all dependencies
RUN npm install

# Copy source code
COPY . .

# Build the frontend
RUN npm run build

# Stage 2: Production Server
FROM node:20

WORKDIR /app

# Install build tools for native modules in production
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json* ./

# Install production dependencies
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
