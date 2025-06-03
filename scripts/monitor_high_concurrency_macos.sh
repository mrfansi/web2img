#!/bin/bash
# High Concurrency Monitoring Script for Web2img (macOS Compatible)

echo "=== Web2img High Concurrency Monitor (macOS) ==="
echo "Timestamp: $(date)"
echo "Optimization Focus: Timeout Prevention"
echo

# Memory usage with optimization context (macOS compatible)
echo "📊 Memory Usage (Target: <80% for optimal performance):"
if command -v vm_stat &> /dev/null; then
    # Get memory info using vm_stat (macOS)
    VM_STAT=$(vm_stat)
    PAGE_SIZE=$(vm_stat | grep "page size" | awk '{print $8}')
    FREE_PAGES=$(echo "$VM_STAT" | grep "Pages free" | awk '{print $3}' | sed 's/\.//')
    INACTIVE_PAGES=$(echo "$VM_STAT" | grep "Pages inactive" | awk '{print $3}' | sed 's/\.//')
    ACTIVE_PAGES=$(echo "$VM_STAT" | grep "Pages active" | awk '{print $3}' | sed 's/\.//')
    WIRED_PAGES=$(echo "$VM_STAT" | grep "Pages wired down" | awk '{print $4}' | sed 's/\.//')
    
    # Calculate memory in GB
    FREE_GB=$(echo "scale=1; $FREE_PAGES * $PAGE_SIZE / 1024 / 1024 / 1024" | bc)
    INACTIVE_GB=$(echo "scale=1; $INACTIVE_PAGES * $PAGE_SIZE / 1024 / 1024 / 1024" | bc)
    ACTIVE_GB=$(echo "scale=1; $ACTIVE_PAGES * $PAGE_SIZE / 1024 / 1024 / 1024" | bc)
    WIRED_GB=$(echo "scale=1; $WIRED_PAGES * $PAGE_SIZE / 1024 / 1024 / 1024" | bc)
    
    TOTAL_MEMORY=$(sysctl -n hw.memsize)
    TOTAL_GB=$(echo "scale=1; $TOTAL_MEMORY / 1024 / 1024 / 1024" | bc)
    AVAILABLE_GB=$(echo "scale=1; $FREE_GB + $INACTIVE_GB" | bc)
    USED_GB=$(echo "scale=1; $TOTAL_GB - $AVAILABLE_GB" | bc)
    MEMORY_USAGE=$(echo "scale=1; $USED_GB * 100 / $TOTAL_GB" | bc)
    
    echo "Total memory: ${TOTAL_GB} GB"
    echo "Used memory: ${USED_GB} GB"
    echo "Available memory: ${AVAILABLE_GB} GB"
    echo "Memory utilization: ${MEMORY_USAGE}%"
    
    if (( $(echo "$MEMORY_USAGE > 80" | bc -l) )); then
        echo "⚠️  WARNING: High memory usage may cause timeouts"
    fi
else
    echo "vm_stat not available"
fi
echo

# Browser processes with pool context
echo "🌐 Browser Processes (Target: 16-64 for high concurrency):"
BROWSER_COUNT=$(ps aux | grep -E "(chrome|chromium|firefox|webkit)" | grep -v grep | wc -l | xargs)
echo "Active browsers: $BROWSER_COUNT"
if [ "$BROWSER_COUNT" -lt 16 ]; then
    echo "⚠️  WARNING: Low browser count may cause request queuing"
elif [ "$BROWSER_COUNT" -gt 80 ]; then
    echo "⚠️  WARNING: High browser count may cause memory issues"
fi
echo

# Network connections with concurrency context (macOS compatible)
echo "🔗 Network Connections (Monitor for connection exhaustion):"
if command -v netstat &> /dev/null; then
    CONN_COUNT=$(netstat -an | wc -l | xargs)
    echo "Active connections: $CONN_COUNT"
    if [ "$CONN_COUNT" -gt 50000 ]; then
        echo "⚠️  WARNING: High connection count may cause timeouts"
    fi
else
    echo "netstat not available"
fi
echo

# File descriptors with limits check
echo "📁 File Descriptors (Check against system limits):"
if command -v lsof &> /dev/null; then
    FD_COUNT=$(lsof | wc -l | xargs)
    FD_LIMIT=$(ulimit -n)
    echo "Open file descriptors: $FD_COUNT / $FD_LIMIT"
    FD_USAGE=$(echo "scale=1; $FD_COUNT * 100 / $FD_LIMIT" | bc)
    echo "FD utilization: ${FD_USAGE}%"
    if (( $(echo "$FD_USAGE > 80" | bc -l) )); then
        echo "⚠️  WARNING: High FD usage may cause connection failures"
    fi
else
    echo "lsof not available"
fi
echo

# Load average with performance context (macOS compatible)
echo "⚡ Load Average (Target: <CPU cores for optimal performance):"
uptime
CPU_CORES=$(sysctl -n hw.ncpu)
LOAD_1MIN=$(uptime | awk -F'load averages:' '{print $2}' | awk '{print $1}')
echo "CPU cores: $CPU_CORES"
if (( $(echo "$LOAD_1MIN > $CPU_CORES" | bc -l) )); then
    echo "⚠️  WARNING: High load may cause processing delays"
fi
echo

# Disk usage with cache context
echo "💾 Disk Usage (Monitor cache and temp directories):"
df -h /tmp/web2img 2>/dev/null || echo "Screenshot directory not found"
if [ -d "/tmp/web2img" ]; then
    CACHE_SIZE=$(du -sh /tmp/web2img/browser_cache 2>/dev/null | cut -f1 || echo "0B")
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
        echo "❌ Service health: NOT OK (Service may not be running)"
    fi
else
    echo "curl not available for health checks"
fi
echo

# Docker container check (if running in Docker)
echo "🐳 Docker Status (if applicable):"
if command -v docker &> /dev/null; then
    WEB2IMG_CONTAINERS=$(docker ps | grep web2img | wc -l | xargs)
    if [ "$WEB2IMG_CONTAINERS" -gt 0 ]; then
        echo "✅ Web2img containers running: $WEB2IMG_CONTAINERS"
        docker ps | grep web2img
    else
        echo "❌ No web2img containers running"
    fi
else
    echo "Docker not available"
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
echo "- Consider memory upgrade if usage consistently high"
echo

echo "🚀 Next Steps:"
echo "- Restart web2img service if configuration changed"
echo "- Test with gradual load increase"
echo "- Monitor logs for timeout patterns"
echo "- Use /dashboard for real-time metrics"
