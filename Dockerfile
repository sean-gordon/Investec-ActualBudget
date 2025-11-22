# Use Node 20 Alpine for a small footprint
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies
COPY package*.json ./
# Use npm install instead of npm ci to generate lockfile if missing
RUN npm install

# Copy source code
COPY . .

# Build the frontend (Vite)
RUN npm run build

# Expose the port the app runs on
EXPOSE 46490

# Start the backend server
CMD ["node", "server.js"]
