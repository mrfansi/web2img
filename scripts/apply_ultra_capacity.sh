#!/bin/bash

# Ultra-High Capacity Configuration Script
# Use this when even 128 browsers at 100% capacity is insufficient

set -e

echo "🚀 ULTRA-HIGH CAPACITY CONFIGURATION"
echo "===================================="
echo "⚠️  WARNING: This will use significant system resources!"
echo "   - Up to 512 browsers (50GB+ RAM)"
echo "   - 256 concurrent screenshots"
echo "   - 512 concurrent contexts"
echo ""

# Check available memory
TOTAL_MEM=$(free -g | awk '/^Mem:/{print $2}')
REQUIRED_MEM=50

if [ "$TOTAL_MEM" -lt "$REQUIRED_MEM" ]; then
    echo "❌ WARNING: System has ${TOTAL_MEM}GB RAM, but ultra-high capacity needs ${REQUIRED_MEM}GB+"
    echo "   This configuration may cause system instability!"
    echo ""
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
fi

# Check if we're in the right directory
if [ ! -f ".env.production" ]; then
    echo "❌ Error: .env.production not found in current directory"
    echo "Please run this script from the web2img root directory"
    exit 1
fi

# Backup current configuration
BACKUP_FILE=".env.production.backup.ultra_capacity.$(date +%Y%m%d_%H%M%S)"
echo "📦 Backing up current configuration to $BACKUP_FILE"
cp .env.production "$BACKUP_FILE"

# Apply ultra-high capacity overrides
echo "🔧 Applying ultra-high capacity configuration..."

cat >> .env.production << 'EOF'

# ===== ULTRA-HIGH CAPACITY OVERRIDES =====
# Applied for extreme load scenarios (5000+ concurrent requests)
# WARNING: Uses significant system resources!

# Browser Pool - Maximum capacity
BROWSER_POOL_MIN_SIZE=64
BROWSER_POOL_MAX_SIZE=512
BROWSER_POOL_WAIT_TIMEOUT=5
BROWSER_POOL_SCALE_THRESHOLD=0.5
BROWSER_POOL_SCALE_FACTOR=2.0
MAX_WAIT_ATTEMPTS=3

# Concurrency - Maximum throughput
MAX_CONCURRENT_SCREENSHOTS=256
MAX_CONCURRENT_CONTEXTS=512

# Load Management - Ultra-high capacity
MAX_QUEUE_SIZE=2000
QUEUE_TIMEOUT=60
LOAD_SHEDDING_THRESHOLD=0.8

# Timeouts - Ultra-fast for maximum turnover
NAVIGATION_TIMEOUT_REGULAR=6000
NAVIGATION_TIMEOUT_COMPLEX=12000
BROWSER_LAUNCH_TIMEOUT=12000
CONTEXT_CREATION_TIMEOUT=8000
BROWSER_CONTEXT_TIMEOUT=8000
PAGE_CREATION_TIMEOUT=8000
SCREENSHOT_TIMEOUT=6000

# Retries - Minimal for speed
MAX_RETRIES_REGULAR=1
MAX_RETRIES_COMPLEX=1
RETRY_BASE_DELAY=0.1
RETRY_MAX_DELAY=1.0

# Cache - Disabled to save memory
BROWSER_CACHE_ENABLED=false

# Performance - Block images for speed
DISABLE_IMAGES=true
DISABLE_FONTS=true

# Logging - Error only for performance
LOG_LEVEL=ERROR
ENABLE_PERFORMANCE_LOGGING=false
LOG_BROWSER_POOL_STATS=false

# Circuit Breaker - Very tolerant
CIRCUIT_BREAKER_THRESHOLD=100

# Memory - Only cleanup at 99%
MEMORY_CLEANUP_THRESHOLD=99

# Server - Maximum workers
WORKERS=32

# Storage - No imgproxy for speed
USE_IMGPROXY_FOR_LOCAL=false
ENABLE_IMGPROXY=false
EOF

echo "✅ Ultra-high capacity configuration applied!"
echo ""
echo "📊 New Configuration Summary:"
echo "  - Browser Pool: 64-512 browsers (was 32-256)"
echo "  - Concurrency: 256 screenshots, 512 contexts (was 128/256)"
echo "  - Queue: 2000 requests (was 1000)"
echo "  - Load Shedding: 80% (was 85%)"
echo "  - Timeouts: 6-12s (was 8-15s)"
echo "  - Memory Usage: ~50GB+ (512 browsers × 100MB)"
echo ""
echo "⚠️  CRITICAL WARNINGS:"
echo "  🔥 This will use 50GB+ RAM with 512 browsers"
echo "  🔥 Monitor system resources closely"
echo "  🔥 May cause system instability on low-memory systems"
echo "  🔥 Consider horizontal scaling instead if issues persist"
echo ""
echo "🔄 To apply changes:"
echo "  cp .env.production .env && docker-compose restart web2img"
echo ""
echo "📈 To monitor system resources:"
echo "  watch -n 5 'free -h && docker stats --no-stream'"
echo ""
echo "🔙 To revert:"
echo "  cp $BACKUP_FILE .env.production && restart service"
echo ""
echo "🚨 DEPLOY ONLY IF YOUR SYSTEM CAN HANDLE 50GB+ RAM USAGE!"
