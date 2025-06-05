#!/bin/bash

# Disable All Cleanup Script
# Use this script to quickly disable all browser cleanup and recycling

set -e

echo "🛑 DISABLING ALL BROWSER CLEANUP AND RECYCLING"
echo "=============================================="

# Check if we're in the right directory
if [ ! -f ".env.production" ]; then
    echo "❌ Error: .env.production not found in current directory"
    echo "Please run this script from the web2img root directory"
    exit 1
fi

# Backup current configuration
BACKUP_FILE=".env.production.backup.no_cleanup.$(date +%Y%m%d_%H%M%S)"
echo "📦 Backing up current configuration to $BACKUP_FILE"
cp .env.production "$BACKUP_FILE"

# Apply key no-cleanup settings to current production config
echo "🔧 Disabling aggressive cleanup in production config..."

# Create a temporary file with the no-cleanup overrides
cat > .env.no_cleanup_overrides << 'EOF'
# DISABLE ALL AGGRESSIVE CLEANUP AND RECYCLING
BROWSER_POOL_IDLE_TIMEOUT=86400
BROWSER_POOL_MAX_AGE=172800
BROWSER_POOL_CLEANUP_INTERVAL=3600
EMERGENCY_CLEANUP_INTERVAL=3600
SCREENSHOT_CLEANUP_INTERVAL=3600
TEMP_FILE_RETENTION_HOURS=48
MEMORY_CLEANUP_THRESHOLD=98
TAB_IDLE_TIMEOUT=86400
TAB_MAX_AGE=172800
TAB_CLEANUP_INTERVAL=3600
POOL_WATCHDOG_INTERVAL=3600
POOL_WATCHDOG_USAGE_THRESHOLD=0.98
POOL_WATCHDOG_IDLE_THRESHOLD=86400
POOL_WATCHDOG_REQUEST_THRESHOLD=1000
POOL_WATCHDOG_FORCE_RECYCLE_AGE=172800
BROWSER_CACHE_CLEANUP_INTERVAL=3600
FORCE_EMERGENCY_ON_TIMEOUT=false
CIRCUIT_BREAKER_THRESHOLD=50
CIRCUIT_BREAKER_RESET_TIME=300
EOF

# Append the overrides to the production config
echo "" >> .env.production
echo "# ===== NO CLEANUP OVERRIDES =====" >> .env.production
echo "# Applied $(date) to disable aggressive cleanup" >> .env.production
cat .env.no_cleanup_overrides >> .env.production

# Clean up temporary file
rm .env.no_cleanup_overrides

echo "✅ No-cleanup configuration applied successfully!"
echo ""
echo "📊 Key Changes Applied:"
echo "  - Browser idle timeout: 24 hours (was 1 hour)"
echo "  - Browser max age: 48 hours (was 10 minutes)"
echo "  - All cleanup intervals: 1 hour (was 5-15 minutes)"
echo "  - Memory cleanup threshold: 98% (was 70%)"
echo "  - Pool watchdog: Very conservative (was aggressive)"
echo "  - Tab recycling: Disabled (was frequent)"
echo "  - Emergency forcing: Disabled"
echo ""
echo "⚠️  IMPORTANT: You need to restart the web2img service for changes to take effect"
echo ""
echo "🔄 To restart the service:"
echo "  Docker: docker-compose restart web2img"
echo "  Systemd: sudo systemctl restart web2img"
echo "  Manual: Kill and restart the process"
echo ""
echo "📈 To monitor the service after restart:"
echo "  python3 scripts/monitor_load.py --interval 10"
echo ""
echo "🔙 To revert to previous configuration:"
echo "  cp $BACKUP_FILE .env.production && restart service"
echo ""
echo "🛑 This configuration DISABLES ALL CLEANUP - browsers will live much longer!"
echo "   Monitor memory usage and manually restart if needed."
