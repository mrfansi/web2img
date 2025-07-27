# Multi-stage Dockerfile for Website Screenshot API

FROM node:22.16.0-alpine3.22 AS base

# Install system dependencies for Playwright and Chromium
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    ttf-dejavu \
    ttf-droid \
    ttf-liberation \
    font-noto \
    python3 \
    make \
    g++ \
    git \
    dbus \
    xvfb \
    && rm -rf /var/cache/apk/*

# Set up Chromium environment
ENV CHROMIUM_PATH=/usr/bin/chromium-browser
ENV CHROME_BIN=/usr/bin/chromium-browser
ENV CHROME_PATH=/usr/bin/chromium-browser

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

# Copy test scripts for debugging
COPY --chown=web2img:nodejs test_browser.js /app/test_browser.js
COPY --chown=web2img:nodejs scripts/docker-entrypoint.sh /app/docker-entrypoint.sh

# Make scripts executable
USER root
RUN chmod +x /app/docker-entrypoint.sh
USER web2img

# Create storage directories
RUN mkdir -p storage/screenshots/cache storage/screenshots/screenshots storage/screenshots/temp && \
    chown -R web2img:nodejs storage

# Set Playwright environment variables
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/bin
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Additional environment variables for headless operation
ENV DISPLAY=:99
ENV DBUS_SESSION_BUS_ADDRESS=/dev/null

# Switch to non-root user
USER web2img

# Expose port
EXPOSE 3333

# Health check - use the liveness endpoint which is more forgiving
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3333/health/live', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start the application
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "./bin/server.js"]