#!/bin/bash

# Emergency Load Configuration Deployment Script
# Use this script to quickly apply emergency configuration during high load

set -e

echo "🚨 EMERGENCY LOAD CONFIGURATION DEPLOYMENT"
echo "=========================================="

# Check if we're in the right directory
if [ ! -f "emergency_load_config.env" ]; then
    echo "❌ Error: emergency_load_config.env not found in current directory"
    echo "Please run this script from the web2img root directory"
    exit 1
fi

# Backup current configuration
if [ -f ".env" ]; then
    BACKUP_FILE=".env.backup.$(date +%Y%m%d_%H%M%S)"
    echo "📦 Backing up current configuration to $BACKUP_FILE"
    cp .env "$BACKUP_FILE"
else
    echo "ℹ️  No existing .env file found"
fi

# Apply emergency configuration
echo "🔧 Applying emergency load configuration..."
cp emergency_load_config.env .env

echo "✅ Emergency configuration applied successfully!"
echo ""
echo "📊 New Configuration Summary:"
echo "  - Browser Pool: 32-128 browsers (was 16-64)"
echo "  - Concurrency: 64 screenshots, 128 contexts (was 32/64)"
echo "  - Timeouts: Aggressive (10s navigation, 10s screenshot)"
echo "  - Retries: Minimal (1-2 retries max)"
echo "  - Load Shedding: Enabled at 90% capacity"
echo "  - Queue: Enabled (500 requests, 30s timeout)"
echo ""
echo "⚠️  IMPORTANT: You need to restart the web2img service for changes to take effect"
echo ""
echo "🔄 To restart the service:"
echo "  Docker: docker-compose restart web2img"
echo "  Systemd: sudo systemctl restart web2img"
echo "  Manual: Kill and restart the process"
echo ""
echo "📈 To monitor the service after restart:"
echo "  Use your monitoring tools"
echo ""
echo "🔙 To revert to previous configuration:"
if [ -f "$BACKUP_FILE" ]; then
    echo "  cp $BACKUP_FILE .env && restart service"
else
    echo "  Remove .env file and restart service to use defaults"
fi
echo ""
echo "🚨 This is an EMERGENCY configuration for extreme load!"
echo "   Consider reverting to normal configuration when load decreases."
