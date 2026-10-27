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
# Frontend build only - skip native builds (node-pty) and husky
RUN bun install --frozen-lockfile --ignore-scripts

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
# --ignore-scripts: skip husky (prepare) and node-pty's install, which would run node-gyp@latest; node-pty is built below
RUN bun install --frozen-lockfile --production --ignore-scripts

# Rebuild node-pty for the container's architecture
RUN cd node_modules/node-pty && bunx node-gyp@11.2.0 rebuild

# Copy built frontend from builder stage
COPY --from=builder /app/dist ./dist

# Copy server files
COPY server ./server
# Server imports these shared modules from outside server/
COPY config/defaults.js ./config/defaults.js
COPY utils/boardWrites.js ./utils/boardWrites.js

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
