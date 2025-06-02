#!/usr/bin/env python3
"""
Performance Dashboard for 2000 Concurrent Screenshots Setup
Monitors system resources and web2img performance metrics
"""

import asyncio
import aiohttp
import psutil
import time
import json
from datetime import datetime
from typing import Dict, Any

class PerformanceDashboard:
    def __init__(self, api_url: str = "http://localhost:8000"):
        self.api_url = api_url
        self.start_time = time.time()
        
    async def get_system_metrics(self) -> Dict[str, Any]:
        """Get system resource metrics."""
        cpu_percent = psutil.cpu_percent(interval=1)
        memory = psutil.virtual_memory()
        disk = psutil.disk_usage('/tmp')
        
        # Count browser processes
        browser_processes = 0
        for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
            try:
                if proc.info['name'] and 'chrome' in proc.info['name'].lower():
                    browser_processes += 1
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        
        return {
            "cpu_percent": cpu_percent,
            "memory_total_gb": round(memory.total / (1024**3), 2),
            "memory_used_gb": round(memory.used / (1024**3), 2),
            "memory_percent": memory.percent,
            "disk_free_gb": round(disk.free / (1024**3), 2),
            "browser_processes": browser_processes,
            "uptime_hours": round((time.time() - self.start_time) / 3600, 2)
        }
    
    async def get_web2img_metrics(self) -> Dict[str, Any]:
        """Get web2img service metrics."""
        try:
            async with aiohttp.ClientSession() as session:
                # Health check
                async with session.get(f"{self.api_url}/health") as resp:
                    health_data = await resp.json()
                
                # Cache stats
                async with session.get(f"{self.api_url}/cache/stats") as resp:
                    cache_data = await resp.json()
                
                # Monitoring metrics
                async with session.get(f"{self.api_url}/monitoring/metrics") as resp:
                    metrics_data = await resp.json()
                
                return {
                    "service_status": health_data.get("status", "unknown"),
                    "cache_hit_rate": cache_data.get("hit_rate", 0),
                    "cache_size": cache_data.get("size", 0),
                    "total_requests": metrics_data.get("total_requests", 0),
                    "active_requests": metrics_data.get("active_requests", 0),
                    "avg_response_time": metrics_data.get("avg_response_time_ms", 0),
                    "error_rate": metrics_data.get("error_rate", 0)
                }
        except Exception as e:
            return {
                "service_status": "error",
                "error": str(e),
                "cache_hit_rate": 0,
                "cache_size": 0,
                "total_requests": 0,
                "active_requests": 0,
                "avg_response_time": 0,
                "error_rate": 0
            }
    
    def calculate_capacity_metrics(self, system_metrics: Dict, web2img_metrics: Dict) -> Dict[str, Any]:
        """Calculate capacity and performance metrics."""
        # Estimate current capacity based on browser processes
        estimated_concurrent = web2img_metrics.get("active_requests", 0)
        max_concurrent = 2080  # 16 workers × 130 browsers
        
        capacity_utilization = (estimated_concurrent / max_concurrent) * 100
        
        # Memory efficiency
        memory_per_browser = system_metrics["memory_used_gb"] / max(system_metrics["browser_processes"], 1)
        
        # Performance score (0-100)
        performance_factors = [
            100 - system_metrics["cpu_percent"],  # Lower CPU is better
            100 - system_metrics["memory_percent"],  # Lower memory usage is better
            min(web2img_metrics["cache_hit_rate"] * 100, 100),  # Higher cache hit rate is better
            max(0, 100 - web2img_metrics["error_rate"] * 100),  # Lower error rate is better
            max(0, 100 - (web2img_metrics["avg_response_time"] / 1000))  # Lower response time is better
        ]
        performance_score = sum(performance_factors) / len(performance_factors)
        
        return {
            "estimated_concurrent": estimated_concurrent,
            "max_concurrent": max_concurrent,
            "capacity_utilization_percent": round(capacity_utilization, 2),
            "memory_per_browser_mb": round(memory_per_browser * 1024, 2),
            "performance_score": round(performance_score, 2),
            "recommendations": self.get_recommendations(system_metrics, web2img_metrics, capacity_utilization)
        }
    
    def get_recommendations(self, system_metrics: Dict, web2img_metrics: Dict, capacity_utilization: float) -> list:
        """Generate performance recommendations."""
        recommendations = []
        
        if system_metrics["cpu_percent"] > 80:
            recommendations.append("⚠️ High CPU usage - consider reducing browser pool size")
        
        if system_metrics["memory_percent"] > 85:
            recommendations.append("⚠️ High memory usage - consider reducing BROWSER_POOL_MAX_SIZE")
        
        if web2img_metrics["cache_hit_rate"] < 0.5:
            recommendations.append("📈 Low cache hit rate - consider increasing CACHE_TTL_SECONDS")
        
        if web2img_metrics["error_rate"] > 0.05:
            recommendations.append("🚨 High error rate - check logs and consider increasing timeouts")
        
        if capacity_utilization > 90:
            recommendations.append("🔥 Near capacity - consider horizontal scaling")
        
        if web2img_metrics["avg_response_time"] > 30000:
            recommendations.append("🐌 Slow response times - consider reducing timeouts or increasing browser pool")
        
        if not recommendations:
            recommendations.append("✅ System performing optimally")
        
        return recommendations
    
    async def display_dashboard(self):
        """Display the performance dashboard."""
        system_metrics = await self.get_system_metrics()
        web2img_metrics = await self.get_web2img_metrics()
        capacity_metrics = self.calculate_capacity_metrics(system_metrics, web2img_metrics)
        
        # Clear screen and display dashboard
        print("\033[2J\033[H")  # Clear screen
        print("=" * 80)
        print(f"🚀 WEB2IMG HIGH-PERFORMANCE DASHBOARD - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 80)
        
        # System Resources
        print("\n📊 SYSTEM RESOURCES:")
        print(f"  CPU Usage:     {system_metrics['cpu_percent']:.1f}%")
        print(f"  Memory:        {system_metrics['memory_used_gb']:.1f}GB / {system_metrics['memory_total_gb']:.1f}GB ({system_metrics['memory_percent']:.1f}%)")
        print(f"  Disk Free:     {system_metrics['disk_free_gb']:.1f}GB")
        print(f"  Browser Procs: {system_metrics['browser_processes']}")
        print(f"  Uptime:        {system_metrics['uptime_hours']:.1f} hours")
        
        # Service Metrics
        print("\n🌐 SERVICE METRICS:")
        print(f"  Status:        {web2img_metrics['service_status']}")
        print(f"  Active Reqs:   {web2img_metrics['active_requests']}")
        print(f"  Total Reqs:    {web2img_metrics['total_requests']}")
        print(f"  Avg Response:  {web2img_metrics['avg_response_time']:.0f}ms")
        print(f"  Error Rate:    {web2img_metrics['error_rate']:.2%}")
        print(f"  Cache Hit:     {web2img_metrics['cache_hit_rate']:.2%}")
        print(f"  Cache Size:    {web2img_metrics['cache_size']}")
        
        # Capacity Metrics
        print("\n🎯 CAPACITY METRICS:")
        print(f"  Current Load:  {capacity_metrics['estimated_concurrent']} / {capacity_metrics['max_concurrent']} ({capacity_metrics['capacity_utilization_percent']:.1f}%)")
        print(f"  Memory/Browser: {capacity_metrics['memory_per_browser_mb']:.1f}MB")
        print(f"  Performance:   {capacity_metrics['performance_score']:.1f}/100")
        
        # Recommendations
        print("\n💡 RECOMMENDATIONS:")
        for rec in capacity_metrics['recommendations']:
            print(f"  {rec}")
        
        print("\n" + "=" * 80)
        print("Press Ctrl+C to exit")

async def main():
    dashboard = PerformanceDashboard()
    
    try:
        while True:
            await dashboard.display_dashboard()
            await asyncio.sleep(5)  # Update every 5 seconds
    except KeyboardInterrupt:
        print("\n👋 Dashboard stopped")

if __name__ == "__main__":
    asyncio.run(main())
