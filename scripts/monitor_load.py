#!/usr/bin/env python3
"""
Load monitoring script for web2img service.
Monitors browser pool usage and provides recommendations for scaling.
"""

import asyncio
import aiohttp
import json
import time
import sys
from datetime import datetime
from typing import Dict, List, Optional


class LoadMonitor:
    """Monitor web2img service load and provide scaling recommendations."""
    
    def __init__(self, service_url: str = "http://localhost:8000"):
        self.service_url = service_url
        self.history: List[Dict] = []
        self.max_history = 100
    
    async def get_service_stats(self) -> Optional[Dict]:
        """Get current service statistics."""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.service_url}/health") as response:
                    if response.status == 200:
                        return await response.json()
                    else:
                        print(f"❌ Health check failed: {response.status}")
                        return None
        except Exception as e:
            print(f"❌ Error getting service stats: {str(e)}")
            return None
    
    def analyze_load(self, stats: Dict) -> Dict:
        """Analyze current load and provide recommendations."""
        browser_pool = stats.get("browser_pool", {})
        
        total_browsers = browser_pool.get("size", 0)
        available_browsers = browser_pool.get("available", 0)
        in_use_browsers = browser_pool.get("in_use", 0)
        
        # Calculate utilization
        utilization = (in_use_browsers / max(total_browsers, 1)) * 100
        
        # Determine load level
        if utilization >= 90:
            load_level = "CRITICAL"
            color = "🔴"
        elif utilization >= 80:
            load_level = "HIGH"
            color = "🟠"
        elif utilization >= 60:
            load_level = "MEDIUM"
            color = "🟡"
        else:
            load_level = "LOW"
            color = "🟢"
        
        # Generate recommendations
        recommendations = []
        
        if utilization >= 85:
            recommendations.append("🚨 URGENT: Consider increasing BROWSER_POOL_MAX_SIZE")
            recommendations.append("💡 Apply high_load_config.env configuration")
            recommendations.append("⚡ Enable adaptive scaling if not already enabled")
        elif utilization >= 70:
            recommendations.append("⚠️  Monitor closely - approaching high load")
            recommendations.append("🔧 Consider pre-scaling browser pool")
        elif utilization < 30:
            recommendations.append("✅ Load is low - consider reducing pool size to save resources")
        
        return {
            "load_level": load_level,
            "color": color,
            "utilization": utilization,
            "total_browsers": total_browsers,
            "available_browsers": available_browsers,
            "in_use_browsers": in_use_browsers,
            "recommendations": recommendations
        }
    
    def print_status(self, stats: Dict, analysis: Dict):
        """Print current status in a readable format."""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        print(f"\n{'='*60}")
        print(f"🕐 {timestamp}")
        print(f"{'='*60}")
        
        # Browser Pool Status
        print(f"{analysis['color']} Load Level: {analysis['load_level']}")
        print(f"📊 Browser Pool Utilization: {analysis['utilization']:.1f}%")
        print(f"🌐 Total Browsers: {analysis['total_browsers']}")
        print(f"✅ Available: {analysis['available_browsers']}")
        print(f"🔄 In Use: {analysis['in_use_browsers']}")
        
        # Additional stats if available
        if "response_times" in stats:
            response_times = stats["response_times"]
            print(f"⏱️  Avg Response Time: {response_times.get('average', 'N/A')}ms")
            print(f"🐌 Max Response Time: {response_times.get('max', 'N/A')}ms")
        
        if "error_rate" in stats:
            error_rate = stats["error_rate"]
            print(f"❌ Error Rate: {error_rate:.2f}%")
        
        # Recommendations
        if analysis['recommendations']:
            print(f"\n💡 Recommendations:")
            for rec in analysis['recommendations']:
                print(f"   {rec}")
        
        print(f"{'='*60}")
    
    def save_history(self, stats: Dict, analysis: Dict):
        """Save current stats to history."""
        entry = {
            "timestamp": time.time(),
            "utilization": analysis["utilization"],
            "total_browsers": analysis["total_browsers"],
            "in_use_browsers": analysis["in_use_browsers"],
            "load_level": analysis["load_level"]
        }
        
        self.history.append(entry)
        
        # Keep only recent history
        if len(self.history) > self.max_history:
            self.history = self.history[-self.max_history:]
    
    def print_trend_analysis(self):
        """Print trend analysis based on history."""
        if len(self.history) < 5:
            return
        
        recent = self.history[-5:]
        utilizations = [entry["utilization"] for entry in recent]
        
        # Calculate trend
        if len(utilizations) >= 2:
            trend = utilizations[-1] - utilizations[0]
            
            if trend > 10:
                trend_indicator = "📈 INCREASING"
                trend_color = "🔴"
            elif trend < -10:
                trend_indicator = "📉 DECREASING"
                trend_color = "🟢"
            else:
                trend_indicator = "➡️  STABLE"
                trend_color = "🟡"
            
            print(f"\n📊 Trend Analysis (last 5 readings):")
            print(f"   {trend_color} {trend_indicator} ({trend:+.1f}%)")
            print(f"   📊 Range: {min(utilizations):.1f}% - {max(utilizations):.1f}%")
    
    async def monitor_continuous(self, interval: int = 30):
        """Monitor service continuously."""
        print(f"🚀 Starting continuous monitoring (interval: {interval}s)")
        print(f"📡 Service URL: {self.service_url}")
        print(f"⏹️  Press Ctrl+C to stop")
        
        try:
            while True:
                stats = await self.get_service_stats()
                
                if stats:
                    analysis = self.analyze_load(stats)
                    self.print_status(stats, analysis)
                    self.save_history(stats, analysis)
                    self.print_trend_analysis()
                else:
                    print(f"❌ Failed to get service stats at {datetime.now()}")
                
                await asyncio.sleep(interval)
                
        except KeyboardInterrupt:
            print(f"\n👋 Monitoring stopped")
    
    async def check_once(self):
        """Perform a single check."""
        print(f"🔍 Checking service status...")
        
        stats = await self.get_service_stats()
        
        if stats:
            analysis = self.analyze_load(stats)
            self.print_status(stats, analysis)
            
            # Return exit code based on load level
            if analysis["load_level"] == "CRITICAL":
                return 2
            elif analysis["load_level"] == "HIGH":
                return 1
            else:
                return 0
        else:
            print(f"❌ Service is not responding")
            return 3


async def main():
    """Main function."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Monitor web2img service load")
    parser.add_argument("--url", default="http://localhost:8000", help="Service URL")
    parser.add_argument("--interval", type=int, default=30, help="Monitoring interval in seconds")
    parser.add_argument("--once", action="store_true", help="Check once and exit")
    
    args = parser.parse_args()
    
    monitor = LoadMonitor(args.url)
    
    if args.once:
        exit_code = await monitor.check_once()
        sys.exit(exit_code)
    else:
        await monitor.monitor_continuous(args.interval)


if __name__ == "__main__":
    asyncio.run(main())
