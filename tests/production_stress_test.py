#!/usr/bin/env python3
"""
Production Stress Test for web2img
Specifically designed to test https://system-web2img.2wczxa.easypanel.host
"""

import asyncio
import aiohttp
import time
import argparse
import sys
from typing import List, Optional
from dataclasses import dataclass, field
from datetime import datetime
import statistics

@dataclass
class TestResult:
    success: bool
    response_time: float
    status_code: int
    error: Optional[str] = None
    url: Optional[str] = None
    timestamp: float = field(default_factory=time.time)

@dataclass
class TestMetrics:
    total_requests: int = 0
    successful_requests: int = 0
    failed_requests: int = 0
    total_time: float = 0.0
    response_times: List[float] = field(default_factory=list)
    error_counts: dict = field(default_factory=dict)
    
    @property
    def success_rate(self) -> float:
        return (self.successful_requests / self.total_requests * 100) if self.total_requests > 0 else 0
    
    @property
    def requests_per_second(self) -> float:
        return self.total_requests / self.total_time if self.total_time > 0 else 0
    
    @property
    def avg_response_time(self) -> float:
        return statistics.mean(self.response_times) if self.response_times else 0
    
    @property
    def p95_response_time(self) -> float:
        if not self.response_times:
            return 0
        sorted_times = sorted(self.response_times)
        index = int(len(sorted_times) * 0.95)
        return sorted_times[index] if index < len(sorted_times) else sorted_times[-1]

class ProductionStressTester:
    def __init__(self, base_url: str = "https://system-web2img.2wczxa.easypanel.host"):
        self.base_url = base_url
        self.results: List[TestResult] = []
        
        # Production test URLs including URL transformation scenarios
        # Based on production logs, focusing on problematic URLs
        self.test_urls = [
            "https://viding.co",  # Will be transformed to http://viding-co_website-revamp
            "https://viding.org", # Will be transformed to http://viding-org_website-revamp
            "https://viding.co/about",
            "https://viding.org/contact",
            "https://viding.co/mini-rsvp/1238786",  # Known problematic URL from logs
            "https://viding.co/mini-rsvp/1238789",  # Known problematic URL from logs
            "https://example.com",
            "https://httpbin.org/html",
            "https://google.com",
            "https://github.com",
        ]

        # Separate list for timeout-prone URLs for focused testing
        self.timeout_prone_urls = [
            "https://viding.co/mini-rsvp/1238786",
            "https://viding.co/mini-rsvp/1238789",
            "https://viding.co/mini-rsvp/1238790",
            "https://viding.co/mini-rsvp/1238791",
            "https://viding.co/mini-rsvp/1238792",
        ]
    
    async def single_screenshot_request(self, session: aiohttp.ClientSession, url: str) -> TestResult:
        """Make a single screenshot request to production."""
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
                timeout=aiohttp.ClientTimeout(total=180)  # Even longer timeout for production issues
            ) as response:
                response_time = time.time() - start_time
                
                if response.status == 200:
                    await response.json()  # Consume response
                    return TestResult(
                        success=True,
                        response_time=response_time,
                        status_code=response.status,
                        url=url
                    )
                else:
                    error_text = await response.text()
                    return TestResult(
                        success=False,
                        response_time=response_time,
                        status_code=response.status,
                        error=f"HTTP {response.status}: {error_text[:200]}",
                        url=url
                    )
                    
        except asyncio.TimeoutError:
            response_time = time.time() - start_time
            return TestResult(
                success=False,
                response_time=response_time,
                status_code=0,
                error="Request timeout",
                url=url
            )
        except Exception as e:
            response_time = time.time() - start_time
            return TestResult(
                success=False,
                response_time=response_time,
                status_code=0,
                error=str(e),
                url=url
            )
    
    async def health_check(self, session: aiohttp.ClientSession) -> bool:
        """Check if the service is healthy before starting tests."""
        try:
            async with session.get(
                f"{self.base_url}/health",
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                return response.status == 200
        except:
            # Try root endpoint if health endpoint doesn't exist
            try:
                async with session.get(
                    f"{self.base_url}/",
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as response:
                    return response.status in [200, 404]  # 404 is OK if no root handler
            except:
                return False
    
    async def warmup_test(self, session: aiohttp.ClientSession) -> bool:
        """Perform a warmup test with a single request."""
        print("🔥 Performing warmup test...")
        result = await self.single_screenshot_request(session, "https://example.com")

        if result.success:
            print(f"✅ Warmup successful ({result.response_time:.2f}s)")
            return True
        else:
            print(f"❌ Warmup failed: {result.error}")
            return False

    async def timeout_analysis_test(self, session: aiohttp.ClientSession) -> None:
        """Run focused test on timeout-prone URLs to analyze patterns."""
        print("🔍 Running timeout analysis on problematic URLs...")

        timeout_results = []
        for url in self.timeout_prone_urls:
            print(f"   Testing: {url}")
            result = await self.single_screenshot_request(session, url)
            timeout_results.append(result)

            if result.success:
                print(f"   ✅ Success ({result.response_time:.2f}s)")
            else:
                print(f"   ❌ Failed: {result.error} ({result.response_time:.2f}s)")

            # Brief pause between timeout-prone requests
            await asyncio.sleep(2)

        # Analyze timeout patterns
        successful = [r for r in timeout_results if r.success]
        failed = [r for r in timeout_results if not r.success]

        print(f"\n📊 Timeout Analysis Results:")
        print(f"   Total tested: {len(timeout_results)}")
        print(f"   Successful: {len(successful)} ({len(successful)/len(timeout_results)*100:.1f}%)")
        print(f"   Failed: {len(failed)} ({len(failed)/len(timeout_results)*100:.1f}%)")

        if successful:
            avg_success_time = sum(r.response_time for r in successful) / len(successful)
            print(f"   Avg success time: {avg_success_time:.2f}s")

        if failed:
            avg_fail_time = sum(r.response_time for r in failed) / len(failed)
            print(f"   Avg failure time: {avg_fail_time:.2f}s")

            timeout_errors = [r for r in failed if "timeout" in (r.error or "").lower()]
            if timeout_errors:
                print(f"   Timeout errors: {len(timeout_errors)}")

        print()
    
    async def run_concurrent_test(self, concurrency: int, total_requests: int, duration_limit: Optional[int] = None):
        """Run concurrent stress test with safety measures."""
        print(f"🚀 Starting production stress test")
        print(f"   Target: {self.base_url}")
        print(f"   Concurrency: {concurrency}")
        print(f"   Total Requests: {total_requests}")
        if duration_limit:
            print(f"   Duration Limit: {duration_limit}s")
        print()
        
        # Create optimized session
        connector = aiohttp.TCPConnector(
            limit=concurrency * 2,
            limit_per_host=concurrency,
            keepalive_timeout=30,
            enable_cleanup_closed=True,
            ttl_dns_cache=300,
            use_dns_cache=True
        )
        
        async with aiohttp.ClientSession(connector=connector) as session:
            # Health check
            if not await self.health_check(session):
                print("❌ Health check failed. Service may be down.")
                return
            
            # Warmup
            if not await self.warmup_test(session):
                print("❌ Warmup test failed. Aborting stress test.")
                return

            # Optional timeout analysis for problematic URLs
            if hasattr(self, 'run_timeout_analysis') and self.run_timeout_analysis:
                await self.timeout_analysis_test(session)
            
            # Create semaphore for concurrency control
            semaphore = asyncio.Semaphore(concurrency)
            
            async def bounded_request(url: str):
                async with semaphore:
                    return await self.single_screenshot_request(session, url)
            
            # Create tasks
            tasks = []
            start_time = time.time()
            
            for i in range(total_requests):
                # Stop if duration limit reached
                if duration_limit and (time.time() - start_time) > duration_limit:
                    break
                    
                url = self.test_urls[i % len(self.test_urls)]
                task = bounded_request(url)
                tasks.append(task)
            
            print(f"⏳ Executing {len(tasks)} requests...")
            
            # Execute with progress reporting
            completed = 0
            batch_size = min(50, len(tasks))
            
            for i in range(0, len(tasks), batch_size):
                batch = tasks[i:i + batch_size]
                batch_results = await asyncio.gather(*batch, return_exceptions=True)
                
                # Process batch results
                for result in batch_results:
                    if isinstance(result, TestResult):
                        self.results.append(result)
                    else:
                        self.results.append(TestResult(
                            success=False,
                            response_time=0,
                            status_code=0,
                            error=str(result)
                        ))
                
                completed += len(batch)
                progress = (completed / len(tasks)) * 100
                print(f"Progress: {progress:.1f}% ({completed}/{len(tasks)})")
                
                # Brief pause between batches to avoid overwhelming
                if i + batch_size < len(tasks):
                    await asyncio.sleep(0.1)
        
        total_time = time.time() - start_time
        self.print_detailed_results(total_time, concurrency)
    
    def calculate_metrics(self, total_time: float) -> TestMetrics:
        """Calculate comprehensive test metrics."""
        metrics = TestMetrics()
        metrics.total_requests = len(self.results)
        metrics.total_time = total_time
        
        for result in self.results:
            if result.success:
                metrics.successful_requests += 1
                metrics.response_times.append(result.response_time)
            else:
                metrics.failed_requests += 1
                error_key = result.error or "Unknown error"
                metrics.error_counts[error_key] = metrics.error_counts.get(error_key, 0) + 1
        
        return metrics
    
    def print_detailed_results(self, total_time: float, concurrency: int):
        """Print comprehensive test results."""
        metrics = self.calculate_metrics(total_time)
        
        print("\n" + "=" * 80)
        print("📊 PRODUCTION STRESS TEST RESULTS")
        print("=" * 80)
        print(f"🎯 Target URL:          {self.base_url}")
        print(f"📊 Total Requests:      {metrics.total_requests}")
        print(f"✅ Successful:          {metrics.successful_requests} ({metrics.success_rate:.1f}%)")
        print(f"❌ Failed:              {metrics.failed_requests} ({100-metrics.success_rate:.1f}%)")
        print(f"⏱️  Total Time:          {metrics.total_time:.2f}s")
        print(f"🚀 Requests/Second:     {metrics.requests_per_second:.2f}")
        print(f"🔄 Concurrency:         {concurrency}")
        print()
        
        if metrics.response_times:
            print("📈 RESPONSE TIME ANALYSIS:")
            print(f"   Average:             {metrics.avg_response_time:.2f}s")
            print(f"   Minimum:             {min(metrics.response_times):.2f}s")
            print(f"   Maximum:             {max(metrics.response_times):.2f}s")
            print(f"   95th Percentile:     {metrics.p95_response_time:.2f}s")
            print(f"   Median:              {statistics.median(metrics.response_times):.2f}s")
        
        if metrics.error_counts:
            print("\n❌ ERROR BREAKDOWN:")
            for error, count in sorted(metrics.error_counts.items(), key=lambda x: x[1], reverse=True):
                percentage = (count / metrics.total_requests) * 100
                print(f"   {error}: {count} ({percentage:.1f}%)")
        
        # Performance assessment
        print(f"\n🎯 PERFORMANCE ASSESSMENT:")
        if metrics.success_rate >= 99:
            print("   ✅ Excellent - Very high success rate")
        elif metrics.success_rate >= 95:
            print("   ✅ Good - High success rate")
        elif metrics.success_rate >= 90:
            print("   ⚠️  Fair - Acceptable success rate")
        else:
            print("   ❌ Poor - Low success rate, investigate issues")
        
        if metrics.avg_response_time <= 5:
            print("   ✅ Excellent response times")
        elif metrics.avg_response_time <= 10:
            print("   ✅ Good response times")
        elif metrics.avg_response_time <= 20:
            print("   ⚠️  Fair response times")
        else:
            print("   ❌ Slow response times, optimization needed")
        
        print("\n" + "=" * 80)

async def main():
    parser = argparse.ArgumentParser(description="Production stress test for web2img")
    parser.add_argument("--url", default="https://system-web2img.2wczxa.easypanel.host",
                       help="Production API base URL")
    parser.add_argument("--concurrency", type=int, default=50,
                       help="Number of concurrent requests (default: 50)")
    parser.add_argument("--requests", type=int, default=500,
                       help="Total number of requests (default: 500)")
    parser.add_argument("--duration", type=int,
                       help="Maximum test duration in seconds")
    parser.add_argument("--ramp-up", action="store_true",
                       help="Gradually ramp up concurrency")
    parser.add_argument("--timeout-analysis", action="store_true",
                       help="Run timeout analysis on problematic URLs")

    args = parser.parse_args()
    
    # Safety check for production
    if "easypanel.host" in args.url and args.concurrency > 200:
        print("⚠️  WARNING: High concurrency detected for production URL")
        print(f"   Concurrency: {args.concurrency}")
        print(f"   Target: {args.url}")
        response = input("Continue? (y/N): ")
        if response.lower() != 'y':
            print("Test cancelled.")
            sys.exit(0)
    
    tester = ProductionStressTester(args.url)
    tester.run_timeout_analysis = args.timeout_analysis

    if args.ramp_up:
        # Gradual ramp-up test
        ramp_steps = [10, 25, 50, 100, 200]
        for step_concurrency in ramp_steps:
            if step_concurrency > args.concurrency:
                break
            print(f"\n🔄 Ramp-up step: {step_concurrency} concurrent requests")
            tester.results = []  # Reset results
            step_requests = min(step_concurrency * 5, args.requests)
            await tester.run_concurrent_test(step_concurrency, step_requests, args.duration)
            await asyncio.sleep(10)  # Pause between steps
    else:
        await tester.run_concurrent_test(args.concurrency, args.requests, args.duration)

if __name__ == "__main__":
    asyncio.run(main())
