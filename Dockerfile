# Build stage
FROM node:20-alpine AS builder
COPY --from=oven/bun:1.2.18-alpine /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

WORKDIR /app

# Install build dependencies for native modules (node-pty)
RUN apk add --no-cache python3 make g++ linux-headers

# Copy package files
COPY package.json bun.lock ./

# Install all dependencies (including devDependencies for build)
RUN bun install --frozen-lockfile

# Copy source files
COPY . .

# Build the frontend
RUN bun run build

# Production stage
FROM node:20-alpine AS production
COPY --from=oven/bun:1.2.18-alpine /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

WORKDIR /app

# Install runtime dependencies for node-pty
RUN apk add --no-cache python3 make g++ linux-headers curl

# Copy package files
COPY package.json bun.lock ./

# Install production dependencies only
RUN bun install --frozen-lockfile --production

# Rebuild node-pty for the container's architecture
RUN cd node_modules/node-pty && bunx node-gyp rebuild

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
