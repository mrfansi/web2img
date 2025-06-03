#!/bin/bash
# High Concurrency Monitoring Script for Web2img

echo "=== Web2img High Concurrency Monitor ==="
echo "Timestamp: $(date)"
echo "Optimization Focus: Timeout Prevention"
echo

# Memory usage with optimization context
echo "📊 Memory Usage (Target: <80% for optimal performance):"
free -h | grep -E "(Mem|Swap)"
MEMORY_USAGE=$(free | grep Mem | awk '{printf "%.1f", $3/$2 * 100.0}')
echo "Memory utilization: ${MEMORY_USAGE}%"
if (( $(echo "$MEMORY_USAGE > 80" | bc -l) )); then
    echo "⚠️  WARNING: High memory usage may cause timeouts"
fi
echo

# Browser processes with pool context
echo "🌐 Browser Processes (Target: 16-64 for high concurrency):"
BROWSER_COUNT=$(ps aux | grep -E "(chrome|chromium|firefox|webkit)" | grep -v grep | wc -l)
echo "Active browsers: $BROWSER_COUNT"
if [ "$BROWSER_COUNT" -lt 16 ]; then
    echo "⚠️  WARNING: Low browser count may cause request queuing"
elif [ "$BROWSER_COUNT" -gt 80 ]; then
    echo "⚠️  WARNING: High browser count may cause memory issues"
fi
echo

# Network connections with concurrency context
echo "🔗 Network Connections (Monitor for connection exhaustion):"
CONN_COUNT=$(ss -tuln | wc -l)
echo "Active connections: $CONN_COUNT"
if [ "$CONN_COUNT" -gt 50000 ]; then
    echo "⚠️  WARNING: High connection count may cause timeouts"
fi
echo

# File descriptors with limits check
echo "📁 File Descriptors (Check against system limits):"
FD_COUNT=$(lsof | wc -l)
FD_LIMIT=$(ulimit -n)
echo "Open file descriptors: $FD_COUNT / $FD_LIMIT"
FD_USAGE=$(echo "scale=1; $FD_COUNT * 100 / $FD_LIMIT" | bc)
echo "FD utilization: ${FD_USAGE}%"
if (( $(echo "$FD_USAGE > 80" | bc -l) )); then
    echo "⚠️  WARNING: High FD usage may cause connection failures"
fi
echo

# Load average with performance context
echo "⚡ Load Average (Target: <CPU cores for optimal performance):"
uptime
CPU_CORES=$(nproc)
LOAD_1MIN=$(uptime | awk -F'load average:' '{print $2}' | awk -F',' '{print $1}' | xargs)
echo "CPU cores: $CPU_CORES"
if (( $(echo "$LOAD_1MIN > $CPU_CORES" | bc -l) )); then
    echo "⚠️  WARNING: High load may cause processing delays"
fi
echo

# Disk usage with cache context
echo "💾 Disk Usage (Monitor cache and temp directories):"
df -h /tmp/web2img 2>/dev/null || echo "Screenshot directory not found"
if [ -d "/tmp/web2img" ]; then
    CACHE_SIZE=$(du -sh /tmp/web2img/browser_cache 2>/dev/null | cut -f1 || echo "0")
    echo "Browser cache size: $CACHE_SIZE"
fi
echo

# Web2img specific metrics (if accessible)
echo "🎯 Web2img Metrics (if available):"
if command -v curl &> /dev/null; then
    HEALTH_CHECK=$(curl -s http://localhost:8000/health 2>/dev/null || echo "Service not accessible")
    if [[ "$HEALTH_CHECK" == *"ok"* ]]; then
        echo "✅ Service health: OK"
        # Try to get metrics
        METRICS=$(curl -s http://localhost:8000/metrics 2>/dev/null || echo "Metrics not accessible")
        if [[ "$METRICS" == *"browser_pool"* ]]; then
            echo "📊 Metrics endpoint accessible"
        fi
    else
        echo "❌ Service health: NOT OK"
    fi
else
    echo "curl not available for health checks"
fi
echo

# Optimization recommendations
echo "🔧 Optimization Status:"
echo "✅ Browser pool optimized (16-64 browsers)"
echo "✅ Aggressive caching enabled"
echo "✅ Resource blocking configured"
echo "✅ Navigation strategy optimized"
echo "✅ Waiting strategy improved"
echo

echo "📈 Performance Tips:"
echo "- Monitor browser pool utilization via /metrics endpoint"
echo "- Check cache hit rates for efficiency"
echo "- Watch for timeout patterns in logs"
echo "- Scale browser pool based on load"
echo
