#!/usr/bin/env python3
"""
Production Timeout Stress Test for web2img
Specifically designed to test and analyze timeout patterns
"""

import asyncio
import aiohttp
import time
import argparse
from typing import List, Dict, Any
from dataclasses import dataclass
import statistics

@dataclass
class TimeoutTestResult:
    url: str
    success: bool
    response_time: float
    status_code: int
    error: str = None
    timeout_stage: str = None  # Which stage timed out

class ProductionTimeoutStressTester:
    def __init__(self, base_url: str = "https://system-web2img.2wczxa.easypanel.host"):
        self.base_url = base_url
        self.results: List[TimeoutTestResult] = []
        
        # URLs that are known to cause timeouts based on production logs
        self.problematic_urls = [
            "https://viding.co/mini-rsvp/1238786",
            "https://viding.co/mini-rsvp/1238789",
            "https://viding.co/mini-rsvp/1238790",
            "https://viding.co/mini-rsvp/1238791",
            "https://viding.co/mini-rsvp/1238792",
        ]
        
        # Control URLs that should work
        self.control_urls = [
            "https://example.com",
            "https://httpbin.org/html",
            "https://viding.co",
            "https://viding.org",
        ]
    
    async def test_single_url(self, session: aiohttp.ClientSession, url: str, timeout: int = 180) -> TimeoutTestResult:
        """Test a single URL with detailed timeout analysis."""
        start_time = time.time()
        
        payload = {
            "url": url,
            "width": 1280,
            "height": 720,
            "format": "png"
        }
        
        try:
            async with session.post(
                f"{self.base_url}/screenshot",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=timeout)
            ) as response:
                response_time = time.time() - start_time
                
                if response.status == 200:
                    await response.json()  # Consume response
                    return TimeoutTestResult(
                        url=url,
                        success=True,
                        response_time=response_time,
                        status_code=response.status
                    )
                else:
                    error_text = await response.text()
                    return TimeoutTestResult(
                        url=url,
                        success=False,
                        response_time=response_time,
                        status_code=response.status,
                        error=f"HTTP {response.status}: {error_text[:200]}"
                    )
                    
        except asyncio.TimeoutError:
            response_time = time.time() - start_time
            return TimeoutTestResult(
                url=url,
                success=False,
                response_time=response_time,
                status_code=0,
                error="Request timeout",
                timeout_stage="request"
            )
        except Exception as e:
            response_time = time.time() - start_time
            return TimeoutTestResult(
                url=url,
                success=False,
                response_time=response_time,
                status_code=0,
                error=str(e)
            )
    
    async def run_sequential_timeout_test(self):
        """Run sequential tests to isolate timeout patterns."""
        print("🔍 Sequential Timeout Analysis")
        print("=" * 60)
        
        connector = aiohttp.TCPConnector(
            limit=5,
            keepalive_timeout=30,
            enable_cleanup_closed=True
        )
        
        async with aiohttp.ClientSession(connector=connector) as session:
            print("📊 Testing Control URLs (should work):")
            for url in self.control_urls:
                print(f"   Testing: {url}")
                result = await self.test_single_url(session, url, timeout=120)
                self.results.append(result)
                
                status_icon = "✅" if result.success else "❌"
                print(f"   {status_icon} {result.response_time:.2f}s - {result.error or 'Success'}")
                
                # Brief pause between requests
                await asyncio.sleep(3)
            
            print(f"\n🚨 Testing Problematic URLs (known timeouts):")
            for url in self.problematic_urls:
                print(f"   Testing: {url}")
                result = await self.test_single_url(session, url, timeout=180)
                self.results.append(result)
                
                status_icon = "✅" if result.success else "❌"
                print(f"   {status_icon} {result.response_time:.2f}s - {result.error or 'Success'}")
                
                # Longer pause between problematic requests
                await asyncio.sleep(5)
    
    async def run_concurrent_timeout_test(self, concurrency: int = 3):
        """Run concurrent tests to see how timeouts behave under load."""
        print(f"\n🔄 Concurrent Timeout Test ({concurrency} concurrent)")
        print("=" * 60)
        
        connector = aiohttp.TCPConnector(
            limit=concurrency * 2,
            limit_per_host=concurrency,
            keepalive_timeout=30,
            enable_cleanup_closed=True
        )
        
        async with aiohttp.ClientSession(connector=connector) as session:
            # Test concurrent requests to the same problematic URL
            test_url = self.problematic_urls[0]  # Use the first problematic URL
            print(f"Testing {concurrency} concurrent requests to: {test_url}")
            
            tasks = []
            for i in range(concurrency):
                task = self.test_single_url(session, test_url, timeout=180)
                tasks.append(task)
            
            start_time = time.time()
            concurrent_results = await asyncio.gather(*tasks, return_exceptions=True)
            total_time = time.time() - start_time
            
            # Process results
            successful = 0
            failed = 0
            timeout_errors = 0
            
            for i, result in enumerate(concurrent_results):
                if isinstance(result, TimeoutTestResult):
                    self.results.append(result)
                    if result.success:
                        successful += 1
                        print(f"   Request {i+1}: ✅ Success ({result.response_time:.2f}s)")
                    else:
                        failed += 1
                        if "timeout" in (result.error or "").lower():
                            timeout_errors += 1
                        print(f"   Request {i+1}: ❌ Failed ({result.response_time:.2f}s) - {result.error}")
                else:
                    failed += 1
                    print(f"   Request {i+1}: ❌ Exception - {result}")
            
            print(f"\n📊 Concurrent Test Results:")
            print(f"   Total Time: {total_time:.2f}s")
            print(f"   Successful: {successful}/{concurrency} ({successful/concurrency*100:.1f}%)")
            print(f"   Failed: {failed}/{concurrency} ({failed/concurrency*100:.1f}%)")
            print(f"   Timeout Errors: {timeout_errors}/{concurrency} ({timeout_errors/concurrency*100:.1f}%)")
    
    def analyze_timeout_patterns(self):
        """Analyze timeout patterns and provide recommendations."""
        print(f"\n📈 Timeout Pattern Analysis")
        print("=" * 60)
        
        if not self.results:
            print("No results to analyze")
            return
        
        # Categorize results
        control_results = [r for r in self.results if any(url in r.url for url in self.control_urls)]
        problematic_results = [r for r in self.results if any(url in r.url for url in self.problematic_urls)]
        
        # Control URL analysis
        if control_results:
            control_success = [r for r in control_results if r.success]
            control_success_rate = len(control_success) / len(control_results) * 100
            print(f"🎯 Control URLs (should work):")
            print(f"   Success Rate: {control_success_rate:.1f}% ({len(control_success)}/{len(control_results)})")
            
            if control_success:
                avg_time = statistics.mean([r.response_time for r in control_success])
                print(f"   Average Response Time: {avg_time:.2f}s")
        
        # Problematic URL analysis
        if problematic_results:
            prob_success = [r for r in problematic_results if r.success]
            prob_success_rate = len(prob_success) / len(problematic_results) * 100
            print(f"\n🚨 Problematic URLs (mini-rsvp pages):")
            print(f"   Success Rate: {prob_success_rate:.1f}% ({len(prob_success)}/{len(problematic_results)})")
            
            if prob_success:
                avg_time = statistics.mean([r.response_time for r in prob_success])
                print(f"   Average Response Time: {avg_time:.2f}s")
        
        # Error analysis
        all_errors = [r.error for r in self.results if r.error]
        if all_errors:
            timeout_errors = [e for e in all_errors if "timeout" in e.lower()]
            print(f"\n❌ Error Analysis:")
            print(f"   Total Errors: {len(all_errors)}")
            print(f"   Timeout Errors: {len(timeout_errors)} ({len(timeout_errors)/len(all_errors)*100:.1f}%)")
        
        # Recommendations
        print(f"\n💡 Recommendations:")
        
        if control_results and len([r for r in control_results if r.success]) == 0:
            print("   🚨 CRITICAL: Even control URLs are failing - service may be down")
        elif problematic_results and len([r for r in problematic_results if r.success]) == 0:
            print("   ⚠️  Specific URL pattern causing 100% timeout rate")
            print("   💡 Check if mini-rsvp pages have specific content causing browser issues")
            print("   💡 Consider implementing URL-specific timeout strategies")
        
        if len(timeout_errors) > len(all_errors) * 0.5:
            print("   ⚠️  High timeout rate detected")
            print("   💡 Consider increasing browser pool size")
            print("   💡 Check server resources (CPU, memory)")
            print("   💡 Monitor browser context creation performance")
        
        print("   💡 Check production logs for browser context creation patterns")
        print("   💡 Consider implementing emergency context creation for all requests")

async def main():
    parser = argparse.ArgumentParser(description="Production timeout stress test for web2img")
    parser.add_argument("--url", default="https://system-web2img.2wczxa.easypanel.host",
                       help="Production API base URL")
    parser.add_argument("--sequential", action="store_true",
                       help="Run sequential timeout tests")
    parser.add_argument("--concurrent", type=int, default=3,
                       help="Run concurrent timeout tests with N requests")
    parser.add_argument("--all", action="store_true",
                       help="Run all timeout tests")
    
    args = parser.parse_args()
    
    tester = ProductionTimeoutStressTester(args.url)
    
    if args.all or args.sequential:
        await tester.run_sequential_timeout_test()
    
    if args.all or args.concurrent > 0:
        await tester.run_concurrent_timeout_test(args.concurrent)
    
    if not args.sequential and args.concurrent == 0 and not args.all:
        # Default: run sequential test
        await tester.run_sequential_timeout_test()
    
    tester.analyze_timeout_patterns()

if __name__ == "__main__":
    asyncio.run(main())
