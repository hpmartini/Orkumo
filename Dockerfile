# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules (node-pty)
RUN apk add --no-cache python3 make g++ linux-headers

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source files
COPY . .

# Build the frontend
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install runtime dependencies for node-pty
RUN apk add --no-cache python3 make g++ linux-headers curl

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Rebuild node-pty for the container's architecture
RUN npm rebuild node-pty

# Copy built frontend from builder stage
COPY --from=builder /app/dist ./dist

# Copy server files
COPY server ./server

# Create directories for persistent data
RUN mkdir -p /app/data /app/sessions

# Set environment variables
ENV NODE_ENV=production
ENV SERVER_PORT=3099

# Expose the application port
EXPOSE 3099

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3099/api/health || exit 1

# Start the server
CMD ["node", "server/index.js"]
