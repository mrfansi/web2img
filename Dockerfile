# Multi-stage Dockerfile for Website Screenshot API

FROM node:22.16.0-alpine3.22 AS base

# Install system dependencies for Playwright
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    python3 \
    make \
    g++ \
    git \
    && rm -rf /var/cache/apk/*

# All deps stage
FROM base AS deps
WORKDIR /app
ADD package.json package-lock.json ./
RUN npm ci

# Production only deps stage
FROM base AS production-deps
WORKDIR /app
ADD package.json package-lock.json ./
RUN npm ci --omit=dev

# Build stage
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
ADD . .
RUN node ace build

# Production stage
FROM base AS production
ENV NODE_ENV=production

# Create app user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S web2img -u 1001

WORKDIR /app

# Copy production dependencies and built application
COPY --from=production-deps --chown=web2img:nodejs /app/node_modules /app/node_modules
COPY --from=build --chown=web2img:nodejs /app/build /app

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
CMD ["node", "./bin/server.js"]