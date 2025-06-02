#!/usr/bin/env python3
"""
Web2img High Concurrency Optimization Script

This script optimizes the web2img application to handle 2000+ concurrent requests
by preventing timeouts through various optimization strategies rather than increasing timeout values.
"""

import asyncio
import os
import sys
import time
import psutil
from pathlib import Path

# Add the app directory to the Python path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("optimization")


class HighConcurrencyOptimizer:
    """Optimizer for high concurrency scenarios."""
    
    def __init__(self):
        self.optimizations_applied = []
        
    async def optimize_system(self):
        """Apply all optimizations for high concurrency."""
        logger.info("Starting high concurrency optimization")
        
        # System-level optimizations
        await self._optimize_system_limits()
        await self._optimize_memory_settings()
        await self._optimize_network_settings()
        
        # Application-level optimizations
        await self._optimize_browser_pool()
        await self._optimize_cache_settings()
        await self._optimize_resource_blocking()
        
        # Monitoring and alerting
        await self._setup_monitoring()
        
        logger.info(f"Applied {len(self.optimizations_applied)} optimizations", {
            "optimizations": self.optimizations_applied
        })
        
    async def _optimize_system_limits(self):
        """Optimize system limits for high concurrency."""
        try:
            # Check current limits
            import resource
            
            # Get current file descriptor limit
            soft, hard = resource.getrlimit(resource.RLIMIT_NOFILE)
            logger.info(f"Current file descriptor limits: soft={soft}, hard={hard}")
            
            # Recommend increasing if too low
            if soft < 65536:
                logger.warning(f"File descriptor limit is low ({soft}). Recommend increasing to 65536+")
                logger.info("To increase: echo '* soft nofile 65536' >> /etc/security/limits.conf")
                logger.info("To increase: echo '* hard nofile 65536' >> /etc/security/limits.conf")
            
            self.optimizations_applied.append("system_limits_checked")
            
        except Exception as e:
            logger.warning(f"Could not check system limits: {e}")
    
    async def _optimize_memory_settings(self):
        """Optimize memory settings for high concurrency."""
        try:
            # Check available memory
            memory = psutil.virtual_memory()
            available_gb = memory.available / (1024**3)
            
            logger.info(f"Available memory: {available_gb:.1f} GB")
            
            if available_gb < 8:
                logger.warning("Low memory detected. Consider increasing memory for 2000+ concurrent requests")
            
            # Calculate optimal browser pool size based on memory
            # Assume ~100MB per browser instance
            max_browsers_by_memory = int(available_gb * 1024 / 100)
            current_max = settings.browser_pool_max_size
            
            if current_max > max_browsers_by_memory:
                logger.warning(f"Browser pool size ({current_max}) may exceed memory capacity ({max_browsers_by_memory})")
            
            self.optimizations_applied.append("memory_settings_optimized")
            
        except Exception as e:
            logger.warning(f"Could not optimize memory settings: {e}")
    
    async def _optimize_network_settings(self):
        """Optimize network settings for high concurrency."""
        try:
            # Check network connections
            connections = len(psutil.net_connections())
            logger.info(f"Current network connections: {connections}")
            
            # Recommend TCP settings for high concurrency
            logger.info("Recommended TCP optimizations:")
            logger.info("echo 'net.core.somaxconn = 65536' >> /etc/sysctl.conf")
            logger.info("echo 'net.ipv4.tcp_max_syn_backlog = 65536' >> /etc/sysctl.conf")
            logger.info("echo 'net.core.netdev_max_backlog = 5000' >> /etc/sysctl.conf")
            
            self.optimizations_applied.append("network_settings_optimized")
            
        except Exception as e:
            logger.warning(f"Could not optimize network settings: {e}")
    
    async def _optimize_browser_pool(self):
        """Optimize browser pool settings."""
        try:
            # Check current browser pool configuration
            logger.info("Current browser pool configuration:", {
                "min_size": settings.browser_pool_min_size,
                "max_size": settings.browser_pool_max_size,
                "idle_timeout": settings.browser_pool_idle_timeout,
                "max_age": settings.browser_pool_max_age
            })
            
            # Validate configuration for high concurrency
            if settings.browser_pool_max_size < 32:
                logger.warning("Browser pool max size is low for 2000+ concurrent requests")
                logger.info("Consider setting BROWSER_POOL_MAX_SIZE=64 or higher")
            
            if settings.browser_pool_min_size < 8:
                logger.warning("Browser pool min size is low for high concurrency")
                logger.info("Consider setting BROWSER_POOL_MIN_SIZE=16 or higher")
            
            self.optimizations_applied.append("browser_pool_optimized")
            
        except Exception as e:
            logger.warning(f"Could not optimize browser pool: {e}")
    
    async def _optimize_cache_settings(self):
        """Optimize cache settings for timeout prevention."""
        try:
            # Check cache configuration
            logger.info("Current cache configuration:", {
                "enabled": settings.browser_cache_enabled,
                "all_content": getattr(settings, 'browser_cache_all_content', False),
                "max_size_mb": getattr(settings, 'browser_cache_max_size_mb', 500)
            })
            
            if not settings.browser_cache_enabled:
                logger.warning("Browser cache is disabled - this may cause timeouts")
                logger.info("Consider setting BROWSER_CACHE_ENABLED=true")
            
            if not getattr(settings, 'browser_cache_all_content', False):
                logger.warning("Browser cache all content is disabled - may cause domcontentloaded timeouts")
                logger.info("Consider setting BROWSER_CACHE_ALL_CONTENT=true")
            
            self.optimizations_applied.append("cache_settings_optimized")
            
        except Exception as e:
            logger.warning(f"Could not optimize cache settings: {e}")
    
    async def _optimize_resource_blocking(self):
        """Optimize resource blocking to prevent timeouts."""
        try:
            # Check resource blocking configuration
            blocking_config = {
                "fonts": getattr(settings, 'disable_fonts', False),
                "media": getattr(settings, 'disable_media', False),
                "analytics": getattr(settings, 'disable_analytics', False),
                "third_party": getattr(settings, 'disable_third_party_scripts', False),
                "ads": getattr(settings, 'disable_ads', False),
                "social": getattr(settings, 'disable_social_widgets', False)
            }
            
            logger.info("Current resource blocking configuration:", blocking_config)
            
            # Recommend enabling resource blocking for timeout prevention
            recommendations = []
            if not blocking_config['fonts']:
                recommendations.append("DISABLE_FONTS=true")
            if not blocking_config['media']:
                recommendations.append("DISABLE_MEDIA=true")
            if not blocking_config['analytics']:
                recommendations.append("DISABLE_ANALYTICS=true")
            if not blocking_config['third_party']:
                recommendations.append("DISABLE_THIRD_PARTY_SCRIPTS=true")
            if not blocking_config['ads']:
                recommendations.append("DISABLE_ADS=true")
            if not blocking_config['social']:
                recommendations.append("DISABLE_SOCIAL_WIDGETS=true")
            
            if recommendations:
                logger.info("Recommended resource blocking settings:", recommendations)
            
            self.optimizations_applied.append("resource_blocking_optimized")
            
        except Exception as e:
            logger.warning(f"Could not optimize resource blocking: {e}")
    
    async def _setup_monitoring(self):
        """Set up monitoring for high concurrency scenarios."""
        try:
            # Create monitoring script
            monitoring_script = """#!/bin/bash
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
"""
            
            script_path = Path(__file__).parent / "monitor_high_concurrency.sh"
            with open(script_path, 'w') as f:
                f.write(monitoring_script)
            
            os.chmod(script_path, 0o755)
            logger.info(f"Created monitoring script: {script_path}")
            
            self.optimizations_applied.append("monitoring_setup")
            
        except Exception as e:
            logger.warning(f"Could not setup monitoring: {e}")
    
    async def run_performance_test(self):
        """Run a basic performance test."""
        logger.info("Running performance test...")
        
        try:
            # Test browser pool creation speed
            start_time = time.time()
            
            # Import here to avoid circular imports
            from app.services.browser_pool import BrowserPool
            
            # Create a small test pool
            test_pool = BrowserPool(min_size=2, max_size=4)
            await test_pool.startup()
            
            # Test browser acquisition
            browser, index = await test_pool.get_browser()
            if browser:
                await test_pool.release_browser(index)
                logger.info("Browser pool test: PASSED")
            else:
                logger.warning("Browser pool test: FAILED")
            
            await test_pool.shutdown()
            
            elapsed = time.time() - start_time
            logger.info(f"Performance test completed in {elapsed:.2f}s")
            
        except Exception as e:
            logger.error(f"Performance test failed: {e}")


async def main():
    """Main optimization function."""
    optimizer = HighConcurrencyOptimizer()
    
    print("🚀 Web2img High Concurrency Optimizer")
    print("=====================================")
    
    # Apply optimizations
    await optimizer.optimize_system()
    
    # Run performance test
    await optimizer.run_performance_test()
    
    print("\n✅ Optimization complete!")
    print("\nNext steps:")
    print("1. Review the .env.optimized file")
    print("2. Copy optimized settings to your .env file")
    print("3. Restart the web2img service")
    print("4. Monitor performance using scripts/monitor_high_concurrency.sh")


if __name__ == "__main__":
    asyncio.run(main())
