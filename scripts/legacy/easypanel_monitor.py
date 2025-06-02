#!/usr/bin/env python3
"""
EasyPanel Monitoring Script for Web2img High-Performance Setup
Monitors performance and provides optimization recommendations
"""

import requests
import time
import json
from datetime import datetime
from typing import Dict, Any

class EasyPanelMonitor:
    def __init__(self, app_url: str = "http://localhost:8000"):
        self.app_url = app_url
        
    async def get_app_metrics(self) -> Dict[str, Any]:
        """Get application metrics from web2img service."""
        try:
            # Health check
            health_resp = requests.get(f"{self.app_url}/health", timeout=5)
            health_data = health_resp.json()
            
            # Cache stats
            cache_resp = requests.get(f"{self.app_url}/cache/stats", timeout=5)
            cache_data = cache_resp.json()
            
            # Monitoring metrics
            try:
                metrics_resp = requests.get(f"{self.app_url}/monitoring/metrics", timeout=5)
                metrics_data = metrics_resp.json()
            except:
                metrics_data = {}
            
            return {
                "status": health_data.get("status", "unknown"),
                "cache_hit_rate": cache_data.get("hit_rate", 0),
                "cache_size": cache_data.get("size", 0),
                "cache_max_size": cache_data.get("max_size", 0),
                "total_requests": metrics_data.get("total_requests", 0),
                "active_requests": metrics_data.get("active_requests", 0),
                "avg_response_time": metrics_data.get("avg_response_time_ms", 0),
                "error_rate": metrics_data.get("error_rate", 0),
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            return {
                "status": "error",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }
    
    def calculate_performance_score(self, metrics: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate performance score and recommendations."""
        score_factors = []
        recommendations = []
        
        # Service health
        if metrics["status"] == "ok":
            score_factors.append(100)
        elif metrics["status"] == "degraded":
            score_factors.append(70)
            recommendations.append("⚠️ Service is degraded - check logs")
        else:
            score_factors.append(0)
            recommendations.append("🚨 Service is down - immediate attention required")
        
        # Cache performance
        cache_hit_rate = metrics.get("cache_hit_rate", 0)
        if cache_hit_rate > 0.7:
            score_factors.append(100)
        elif cache_hit_rate > 0.5:
            score_factors.append(80)
            recommendations.append("📈 Cache hit rate could be improved")
        else:
            score_factors.append(50)
            recommendations.append("🔄 Low cache hit rate - consider increasing TTL")
        
        # Response time
        avg_response_time = metrics.get("avg_response_time", 0)
        if avg_response_time < 15000:  # < 15 seconds
            score_factors.append(100)
        elif avg_response_time < 30000:  # < 30 seconds
            score_factors.append(80)
            recommendations.append("🐌 Response times are getting slow")
        else:
            score_factors.append(50)
            recommendations.append("🚨 Response times are too slow - check configuration")
        
        # Error rate
        error_rate = metrics.get("error_rate", 0)
        if error_rate < 0.01:  # < 1%
            score_factors.append(100)
        elif error_rate < 0.05:  # < 5%
            score_factors.append(80)
            recommendations.append("⚠️ Error rate is elevated")
        else:
            score_factors.append(50)
            recommendations.append("🚨 High error rate - investigate immediately")
        
        # Active requests (capacity utilization)
        active_requests = metrics.get("active_requests", 0)
        if active_requests < 1600:  # < 80% of 2000 capacity
            score_factors.append(100)
        elif active_requests < 1900:  # < 95% of capacity
            score_factors.append(80)
            recommendations.append("📊 Approaching capacity limits")
        else:
            score_factors.append(50)
            recommendations.append("🔥 At capacity - consider scaling")
        
        # Calculate overall score
        performance_score = sum(score_factors) / len(score_factors) if score_factors else 0
        
        # Add general recommendations
        if not recommendations:
            recommendations.append("✅ System performing optimally")
        
        return {
            "performance_score": round(performance_score, 1),
            "recommendations": recommendations,
            "capacity_utilization": round((active_requests / 2000) * 100, 1) if active_requests else 0
        }
    
    def display_dashboard(self):
        """Display monitoring dashboard."""
        metrics = self.get_app_metrics()
        performance = self.calculate_performance_score(metrics)
        
        # Clear screen
        print("\033[2J\033[H")
        print("=" * 80)
        print(f"📊 EASYPANEL WEB2IMG MONITOR - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 80)
        
        # Service Status
        status_emoji = "✅" if metrics["status"] == "ok" else "⚠️" if metrics["status"] == "degraded" else "❌"
        print(f"\n🚀 SERVICE STATUS: {status_emoji} {metrics['status'].upper()}")
        
        # Performance Metrics
        print(f"\n📈 PERFORMANCE METRICS:")
        print(f"  Performance Score: {performance['performance_score']:.1f}/100")
        print(f"  Active Requests:   {metrics.get('active_requests', 0)}")
        print(f"  Capacity Usage:    {performance['capacity_utilization']:.1f}%")
        print(f"  Avg Response:      {metrics.get('avg_response_time', 0):.0f}ms")
        print(f"  Error Rate:        {metrics.get('error_rate', 0):.2%}")
        
        # Cache Performance
        print(f"\n💾 CACHE PERFORMANCE:")
        print(f"  Hit Rate:          {metrics.get('cache_hit_rate', 0):.2%}")
        print(f"  Cache Size:        {metrics.get('cache_size', 0)}/{metrics.get('cache_max_size', 0)}")
        print(f"  Total Requests:    {metrics.get('total_requests', 0)}")
        
        # Recommendations
        print(f"\n💡 RECOMMENDATIONS:")
        for rec in performance['recommendations']:
            print(f"  {rec}")
        
        # EasyPanel Specific Info
        print(f"\n🐳 EASYPANEL INFO:")
        print(f"  App URL:           {self.app_url}")
        print(f"  Dashboard:         {self.app_url}/dashboard")
        print(f"  API Docs:          {self.app_url}/docs")
        print(f"  Health Check:      {self.app_url}/health")
        
        print("\n" + "=" * 80)
        print("Press Ctrl+C to exit")
    
    def get_app_metrics(self) -> Dict[str, Any]:
        """Synchronous version of get_app_metrics for compatibility."""
        try:
            # Health check
            health_resp = requests.get(f"{self.app_url}/health", timeout=5)
            health_data = health_resp.json()
            
            # Cache stats
            cache_resp = requests.get(f"{self.app_url}/cache/stats", timeout=5)
            cache_data = cache_resp.json()
            
            # Try to get monitoring metrics
            try:
                metrics_resp = requests.get(f"{self.app_url}/monitoring/metrics", timeout=5)
                metrics_data = metrics_resp.json()
            except:
                metrics_data = {}
            
            return {
                "status": health_data.get("status", "unknown"),
                "cache_hit_rate": cache_data.get("hit_rate", 0),
                "cache_size": cache_data.get("size", 0),
                "cache_max_size": cache_data.get("max_size", 0),
                "total_requests": metrics_data.get("total_requests", 0),
                "active_requests": metrics_data.get("active_requests", 0),
                "avg_response_time": metrics_data.get("avg_response_time_ms", 0),
                "error_rate": metrics_data.get("error_rate", 0),
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            return {
                "status": "error",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="EasyPanel Web2img Monitor")
    parser.add_argument("--url", default="http://localhost:8000", help="App URL")
    parser.add_argument("--interval", type=int, default=5, help="Update interval")
    parser.add_argument("--json", action="store_true", help="JSON output")
    
    args = parser.parse_args()
    
    monitor = EasyPanelMonitor(args.url)
    
    if args.json:
        metrics = monitor.get_app_metrics()
        performance = monitor.calculate_performance_score(metrics)
        result = {**metrics, **performance}
        print(json.dumps(result, indent=2))
        return
    
    try:
        while True:
            monitor.display_dashboard()
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\n👋 Monitor stopped")

if __name__ == "__main__":
    main()
