#!/usr/bin/env python3
"""
Real-time browser pool monitoring to track and eliminate waiting.
"""

import asyncio
import sys
import time
import json
from pathlib import Path
from datetime import datetime

# Add the app directory to the Python path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.core.config import settings
from app.services.browser_pool import BrowserPool
from app.core.logging import get_logger

logger = get_logger("browser_pool_monitor")

class BrowserPoolMonitor:
    """Real-time browser pool monitoring and alerting."""
    
    def __init__(self):
        self.pool = None
        self.metrics_history = []
        self.alert_thresholds = {
            "high_utilization": 0.85,
            "wait_events": 1,
            "pool_exhaustions": 1,
            "avg_wait_time": 1.0,
            "low_health_score": 70
        }
        
    async def initialize(self):
        """Initialize the browser pool."""
        self.pool = BrowserPool()
        await self.pool.initialize()
        logger.info("Browser pool monitor initialized")
        
    async def collect_metrics(self):
        """Collect comprehensive browser pool metrics."""
        if not self.pool:
            return None
            
        stats = self.pool.get_stats()
        health = self.pool.get_health_status()
        
        metrics = {
            "timestamp": datetime.now().isoformat(),
            "pool": {
                "total_browsers": stats["size"],
                "available_browsers": stats["available"],
                "in_use_browsers": stats["in_use"],
                "utilization": stats["usage_ratio"],
                "min_size": stats["min_size"],
                "max_size": stats["max_size"]
            },
            "performance": {
                "wait_events": stats["wait_events"],
                "wait_time_total": stats["wait_time_total"],
                "avg_wait_time": stats["avg_wait_time"],
                "pool_exhaustions": stats["pool_exhaustions"],
                "stuck_browsers": stats["stuck_browsers_detected"],
                "force_releases": stats["force_releases"]
            },
            "activity": {
                "created": stats["created"],
                "reused": stats["reused"],
                "errors": stats["errors"],
                "recycled": stats["recycled"],
                "peak_usage": stats["peak_usage"]
            },
            "health": {
                "status": health["status"],
                "score": health["health_score"],
                "utilization": health["utilization"],
                "error_rate": health["error_rate"],
                "avg_wait_time": health["avg_wait_time"],
                "issues": health["issues"],
                "recommendations": health["recommendations"]
            }
        }
        
        # Store in history (keep last 100 entries)
        self.metrics_history.append(metrics)
        if len(self.metrics_history) > 100:
            self.metrics_history.pop(0)
            
        return metrics
    
    def check_alerts(self, metrics):
        """Check for alert conditions."""
        alerts = []
        
        # High utilization alert
        if metrics["pool"]["utilization"] > self.alert_thresholds["high_utilization"]:
            alerts.append({
                "level": "WARNING",
                "type": "HIGH_UTILIZATION",
                "message": f"Browser pool utilization is {metrics['pool']['utilization']:.1%}",
                "recommendation": "Consider increasing BROWSER_POOL_MAX_SIZE"
            })
        
        # Wait events alert
        if metrics["performance"]["wait_events"] > self.alert_thresholds["wait_events"]:
            alerts.append({
                "level": "CRITICAL",
                "type": "WAIT_EVENTS",
                "message": f"Detected {metrics['performance']['wait_events']} wait events",
                "recommendation": "Increase browser pool size or optimize release timing"
            })
        
        # Pool exhaustion alert
        if metrics["performance"]["pool_exhaustions"] > self.alert_thresholds["pool_exhaustions"]:
            alerts.append({
                "level": "CRITICAL",
                "type": "POOL_EXHAUSTION",
                "message": f"Pool exhausted {metrics['performance']['pool_exhaustions']} times",
                "recommendation": "Immediately increase BROWSER_POOL_MAX_SIZE"
            })
        
        # High wait time alert
        if metrics["performance"]["avg_wait_time"] > self.alert_thresholds["avg_wait_time"]:
            alerts.append({
                "level": "WARNING",
                "type": "HIGH_WAIT_TIME",
                "message": f"Average wait time is {metrics['performance']['avg_wait_time']:.2f}s",
                "recommendation": "Optimize browser pool configuration"
            })
        
        # Low health score alert
        if metrics["health"]["score"] < self.alert_thresholds["low_health_score"]:
            alerts.append({
                "level": "WARNING",
                "type": "LOW_HEALTH",
                "message": f"Health score is {metrics['health']['score']}/100",
                "recommendation": "Review health recommendations"
            })
        
        return alerts
    
    def print_dashboard(self, metrics, alerts):
        """Print a real-time dashboard."""
        # Clear screen
        print("\033[2J\033[H")
        
        # Header
        print("=" * 80)
        print(f"🚀 BROWSER POOL MONITOR - {metrics['timestamp']}")
        print("=" * 80)
        
        # Pool Status
        pool = metrics["pool"]
        print(f"\n📊 POOL STATUS")
        print(f"   Browsers: {pool['in_use_browsers']}/{pool['total_browsers']} ({pool['utilization']:.1%} utilization)")
        print(f"   Available: {pool['available_browsers']}")
        print(f"   Capacity: {pool['min_size']} - {pool['max_size']}")
        
        # Performance Metrics
        perf = metrics["performance"]
        print(f"\n⚡ PERFORMANCE")
        print(f"   Wait Events: {perf['wait_events']}")
        print(f"   Avg Wait Time: {perf['avg_wait_time']:.3f}s")
        print(f"   Pool Exhaustions: {perf['pool_exhaustions']}")
        print(f"   Stuck Browsers: {perf['stuck_browsers']}")
        
        # Health Status
        health = metrics["health"]
        status_emoji = {"EXCELLENT": "🟢", "GOOD": "🟡", "FAIR": "🟠", "POOR": "🔴", "CRITICAL": "💀"}
        print(f"\n🏥 HEALTH")
        print(f"   Status: {status_emoji.get(health['status'], '❓')} {health['status']} ({health['score']}/100)")
        print(f"   Error Rate: {health['error_rate']:.1%}")
        
        # Alerts
        if alerts:
            print(f"\n🚨 ALERTS ({len(alerts)})")
            for alert in alerts:
                emoji = {"CRITICAL": "🔴", "WARNING": "🟡", "INFO": "🔵"}
                print(f"   {emoji.get(alert['level'], '❓')} {alert['type']}: {alert['message']}")
                print(f"      → {alert['recommendation']}")
        else:
            print(f"\n✅ NO ALERTS - System running optimally")
        
        # Recommendations
        if health["recommendations"]:
            print(f"\n💡 RECOMMENDATIONS")
            for rec in health["recommendations"]:
                print(f"   • {rec}")
        
        # Activity Summary
        activity = metrics["activity"]
        print(f"\n📈 ACTIVITY")
        print(f"   Created: {activity['created']} | Reused: {activity['reused']} | Errors: {activity['errors']}")
        print(f"   Peak Usage: {activity['peak_usage']} | Recycled: {activity['recycled']}")
        
        print("\n" + "=" * 80)
        print("Press Ctrl+C to stop monitoring")
    
    def save_metrics(self, metrics, filename="browser_pool_metrics.json"):
        """Save metrics to file for analysis."""
        try:
            with open(filename, "w") as f:
                json.dump(self.metrics_history, f, indent=2)
        except Exception as e:
            logger.error(f"Error saving metrics: {e}")
    
    async def monitor(self, interval=5, save_interval=60):
        """Run continuous monitoring."""
        logger.info(f"Starting browser pool monitoring (interval: {interval}s)")
        last_save = time.time()
        
        while True:
            try:
                # Collect metrics
                metrics = await self.collect_metrics()
                
                if metrics:
                    # Check for alerts
                    alerts = self.check_alerts(metrics)
                    
                    # Display dashboard
                    self.print_dashboard(metrics, alerts)
                    
                    # Log critical alerts
                    for alert in alerts:
                        if alert["level"] == "CRITICAL":
                            logger.error(f"CRITICAL ALERT: {alert['message']}")
                    
                    # Save metrics periodically
                    if time.time() - last_save > save_interval:
                        self.save_metrics(metrics)
                        last_save = time.time()
                
                await asyncio.sleep(interval)
                
            except Exception as e:
                logger.error(f"Error in monitoring loop: {e}")
                await asyncio.sleep(interval)
    
    async def shutdown(self):
        """Shutdown the monitor."""
        if self.pool:
            await self.pool.shutdown()
        logger.info("Browser pool monitor shutdown")

async def main():
    """Run the browser pool monitor."""
    monitor = BrowserPoolMonitor()
    
    try:
        await monitor.initialize()
        await monitor.monitor()
    except KeyboardInterrupt:
        print("\n\nShutting down monitor...")
    finally:
        await monitor.shutdown()

if __name__ == "__main__":
    asyncio.run(main())
