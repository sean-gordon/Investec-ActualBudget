# Use Node 20 Alpine for a small footprint
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build the frontend (Vite)
RUN npm run build

# Expose the port
EXPOSE 46490

# Start the backend server
CMD ["node", "server.js"]
