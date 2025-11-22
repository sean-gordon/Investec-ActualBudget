# Stage 1: Build the React application
FROM node:20-alpine as builder

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
FROM node:20-alpine

WORKDIR /app

# Copy package files again to install production dependencies
COPY package.json package-lock.json* ./

# Install only production dependencies
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
