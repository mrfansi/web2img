# Multi-stage Dockerfile for Website Screenshot API

# Stage 1: Build stage
FROM node:18-alpine AS builder

# Install system dependencies for building
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Production stage
FROM node:18-alpine AS production

# Install system dependencies for Playwright
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && rm -rf /var/cache/apk/*

# Create app user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S web2img -u 1001

# Set working directory
WORKDIR /app

# Copy built application from builder stage
COPY --from=builder --chown=web2img:nodejs /app/build ./build
COPY --from=builder --chown=web2img:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=web2img:nodejs /app/package*.json ./

# Create storage directories
RUN mkdir -p storage/screenshots/cache storage/screenshots/screenshots storage/screenshots/temp && \
    chown -R web2img:nodejs storage

# Set Playwright environment variables
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/bin/chromium-browser
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Switch to non-root user
USER web2img

# Expose port
EXPOSE 3333

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3333/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start the application
CMD ["node", "build/bin/server.js"]