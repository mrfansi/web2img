#!/bin/sh

# Docker entrypoint script for Web2Img
set -e

echo "Starting Web2Img application..."
echo "Environment: $NODE_ENV"
echo "Port: $PORT"
echo "Redis Host: $REDIS_HOST"
echo "Redis Port: $REDIS_PORT"
echo "Screenshot Queue Concurrency: $SCREENSHOT_QUEUE_CONCURRENCY"
echo "Screenshot Queue Remove on Complete: $SCREENSHOT_QUEUE_REMOVE_ON_COMPLETE"
echo "Screenshot Queue Remove on Fail: $SCREENSHOT_QUEUE_REMOVE_ON_FAIL"

# Test browser availability before starting the main application
echo "Testing browser availability..."
if node test_browser.js; then
    echo "✅ Browser test passed, starting main application"
else
    echo "❌ Browser test failed, but continuing anyway..."
fi

# Start the main application
exec "$@"