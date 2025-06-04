#!/usr/bin/env python3
"""
Production Health Monitor for web2img
Continuously monitors the health and performance after applying optimizations
"""

import asyncio
import aiohttp
import time
import json
from datetime import datetime
from typing import Dict, List
from dataclasses import dataclass

@dataclass
class HealthCheck:
    timestamp: datetime
    endpoint: str
    success: bool
    response_time: float
    status_code: int
    error: str = None

class ProductionHealthMonitor:
    def __init__(self, base_url: str = "https://system-web2img.2wczxa.easypanel.host"):
        self.base_url = base_url
        self.health_history: List[HealthCheck] = []
        
        # Test scenarios
        self.test_scenarios = [
            {
                "name": "Simple Screenshot",
                "payload": {
                    "url": "https://example.com",
                    "width": 1280,
                    "height": 720,
                    "format": "png"
                },
                "expected_time": 10.0
            },
            {
                "name": "URL Transformation",
                "payload": {
                    "url": "https://viding.co",
                    "width": 1280,
                    "height": 720,
                    "format": "png"
                },
                "expected_time": 15.0
            },
            {
                "name": "Problematic URL",
                "payload": {
                    "url": "https://viding.co/mini-rsvp/1238786",
                    "width": 1280,
                    "height": 720,
                    "format": "png"
                },
                "expected_time": 30.0
            }
        ]
    
    async def check_endpoint(self, session: aiohttp.ClientSession, endpoint: str, method: str = "GET", payload: dict = None, timeout: int = 60) -> HealthCheck:
        """Check a specific endpoint and return health status."""
        start_time = time.time()
        url = f"{self.base_url}{endpoint}"
        
        try:
            if method.upper() == "POST":
                async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=timeout)) as response:
                    response_time = time.time() - start_time
                    success = 200 <= response.status < 300
                    
                    return HealthCheck(
                        timestamp=datetime.now(),
                        endpoint=endpoint,
                        success=success,
                        response_time=response_time,
                        status_code=response.status,
                        error=None if success else f"HTTP {response.status}"
                    )
            else:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as response:
                    response_time = time.time() - start_time
                    success = 200 <= response.status < 300
                    
                    return HealthCheck(
                        timestamp=datetime.now(),
                        endpoint=endpoint,
                        success=success,
                        response_time=response_time,
                        status_code=response.status,
                        error=None if success else f"HTTP {response.status}"
                    )
                    
        except asyncio.TimeoutError:
            response_time = time.time() - start_time
            return HealthCheck(
                timestamp=datetime.now(),
                endpoint=endpoint,
                success=False,
                response_time=response_time,
                status_code=0,
                error="Timeout"
            )
        except Exception as e:
            response_time = time.time() - start_time
            return HealthCheck(
                timestamp=datetime.now(),
                endpoint=endpoint,
                success=False,
                response_time=response_time,
                status_code=0,
                error=str(e)
            )
    
    async def run_health_cycle(self):
        """Run a complete health check cycle."""
        print(f"🔍 Health Check - {datetime.now().strftime('%H:%M:%S')}")
        
        connector = aiohttp.TCPConnector(
            limit=5,
            keepalive_timeout=30,
            enable_cleanup_closed=True
        )
        
        async with aiohttp.ClientSession(connector=connector) as session:
            # Check basic endpoints
            basic_checks = [
                await self.check_endpoint(session, "/health", "GET"),
                await self.check_endpoint(session, "/", "GET")
            ]
            
            # Check screenshot scenarios
            screenshot_checks = []
            for scenario in self.test_scenarios:
                print(f"   Testing: {scenario['name']}")
                check = await self.check_endpoint(
                    session, 
                    "/screenshot", 
                    "POST", 
                    scenario["payload"],
                    timeout=90
                )
                screenshot_checks.append(check)
                
                # Status indicator
                if check.success:
                    status = "✅" if check.response_time <= scenario["expected_time"] else "⚠️"
                    print(f"   {status} {check.response_time:.1f}s")
                else:
                    print(f"   ❌ {check.response_time:.1f}s - {check.error}")
                
                # Brief pause between tests
                await asyncio.sleep(2)
            
            # Store results
            self.health_history.extend(basic_checks + screenshot_checks)
            
            # Print summary
            self.print_cycle_summary(basic_checks + screenshot_checks)
    
    def print_cycle_summary(self, checks: List[HealthCheck]):
        """Print summary of the current health check cycle."""
        successful = [c for c in checks if c.success]
        failed = [c for c in checks if not c.success]
        
        success_rate = len(successful) / len(checks) * 100 if checks else 0
        avg_response_time = sum(c.response_time for c in successful) / len(successful) if successful else 0
        
        print(f"   📊 Success Rate: {success_rate:.1f}% ({len(successful)}/{len(checks)})")
        if successful:
            print(f"   ⏱️  Avg Response Time: {avg_response_time:.1f}s")
        if failed:
            print(f"   ❌ Failed: {len(failed)} ({', '.join(set(c.error for c in failed if c.error))})")
        print()
    
    def print_trend_analysis(self):
        """Print trend analysis based on historical data."""
        if len(self.health_history) < 10:
            return
        
        # Get recent data (last 10 checks)
        recent_checks = self.health_history[-10:]
        screenshot_checks = [c for c in recent_checks if c.endpoint == "/screenshot"]
        
        if not screenshot_checks:
            return
        
        print("📈 Trend Analysis (Last 10 Screenshot Tests)")
        print("-" * 50)
        
        success_rate = len([c for c in screenshot_checks if c.success]) / len(screenshot_checks) * 100
        avg_time = sum(c.response_time for c in screenshot_checks if c.success) / max(1, len([c for c in screenshot_checks if c.success]))
        timeout_rate = len([c for c in screenshot_checks if c.error == "Timeout"]) / len(screenshot_checks) * 100
        
        print(f"Success Rate: {success_rate:.1f}%")
        print(f"Avg Response Time: {avg_time:.1f}s")
        print(f"Timeout Rate: {timeout_rate:.1f}%")
        
        # Trend indicators
        if success_rate >= 80:
            print("🟢 Service health: GOOD")
        elif success_rate >= 50:
            print("🟡 Service health: FAIR")
        else:
            print("🔴 Service health: POOR")
        
        if avg_time <= 20:
            print("🟢 Response times: GOOD")
        elif avg_time <= 60:
            print("🟡 Response times: FAIR")
        else:
            print("🔴 Response times: POOR")
        
        print()
    
    async def continuous_monitoring(self, interval: int = 300, cycles: int = None):
        """Run continuous monitoring with specified interval."""
        print(f"🚀 Starting Production Health Monitoring")
        print(f"🎯 Target: {self.base_url}")
        print(f"⏱️  Interval: {interval} seconds")
        print(f"🔄 Cycles: {'Unlimited' if cycles is None else cycles}")
        print("=" * 60)
        
        cycle_count = 0
        try:
            while cycles is None or cycle_count < cycles:
                await self.run_health_cycle()
                
                # Print trend analysis every 5 cycles
                if cycle_count > 0 and cycle_count % 5 == 0:
                    self.print_trend_analysis()
                
                cycle_count += 1
                
                if cycles is None or cycle_count < cycles:
                    print(f"⏳ Waiting {interval} seconds until next check...")
                    await asyncio.sleep(interval)
                    
        except KeyboardInterrupt:
            print("\n🛑 Monitoring stopped by user")
        
        # Final summary
        self.print_final_summary()
    
    def print_final_summary(self):
        """Print final monitoring summary."""
        if not self.health_history:
            return
        
        print("\n" + "=" * 60)
        print("📊 FINAL MONITORING SUMMARY")
        print("=" * 60)
        
        screenshot_checks = [c for c in self.health_history if c.endpoint == "/screenshot"]
        if screenshot_checks:
            successful = [c for c in screenshot_checks if c.success]
            overall_success_rate = len(successful) / len(screenshot_checks) * 100
            
            print(f"Total Screenshot Tests: {len(screenshot_checks)}")
            print(f"Overall Success Rate: {overall_success_rate:.1f}%")
            
            if successful:
                avg_time = sum(c.response_time for c in successful) / len(successful)
                min_time = min(c.response_time for c in successful)
                max_time = max(c.response_time for c in successful)
                
                print(f"Average Response Time: {avg_time:.1f}s")
                print(f"Min Response Time: {min_time:.1f}s")
                print(f"Max Response Time: {max_time:.1f}s")
            
            # Error analysis
            errors = [c.error for c in screenshot_checks if c.error]
            if errors:
                error_counts = {}
                for error in errors:
                    error_counts[error] = error_counts.get(error, 0) + 1
                
                print(f"\nError Breakdown:")
                for error, count in sorted(error_counts.items(), key=lambda x: x[1], reverse=True):
                    percentage = count / len(screenshot_checks) * 100
                    print(f"  {error}: {count} ({percentage:.1f}%)")

async def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Production health monitor for web2img")
    parser.add_argument("--url", default="https://system-web2img.2wczxa.easypanel.host",
                       help="Production API base URL")
    parser.add_argument("--interval", type=int, default=300,
                       help="Check interval in seconds (default: 300)")
    parser.add_argument("--cycles", type=int,
                       help="Number of cycles to run (default: unlimited)")
    parser.add_argument("--single", action="store_true",
                       help="Run single health check cycle")
    
    args = parser.parse_args()
    
    monitor = ProductionHealthMonitor(args.url)
    
    if args.single:
        await monitor.run_health_cycle()
    else:
        await monitor.continuous_monitoring(args.interval, args.cycles)

if __name__ == "__main__":
    asyncio.run(main())
