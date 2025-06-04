#!/usr/bin/env python3
"""
Load Test for 2000 Concurrent Screenshots
Tests the high-performance configuration
"""

import asyncio
import aiohttp
import time
import json
import argparse
from typing import List, Dict, Any
from dataclasses import dataclass
from datetime import datetime

@dataclass
class TestResult:
    success: bool
    response_time: float
    status_code: int
    error: str = None
    cached: bool = False

class LoadTester:
    def __init__(self, base_url: str = "http://localhost:8000"):
        self.base_url = base_url
        self.results: List[TestResult] = []
        
    async def single_screenshot_request(self, session: aiohttp.ClientSession, url: str, request_id: int) -> TestResult:
        """Make a single screenshot request."""
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
                timeout=aiohttp.ClientTimeout(total=60)
            ) as response:
                response_time = time.time() - start_time
                
                if response.status == 200:
                    data = await response.json()
                    return TestResult(
                        success=True,
                        response_time=response_time,
                        status_code=response.status,
                        cached=False  # Could parse from response headers
                    )
                else:
                    error_text = await response.text()
                    return TestResult(
                        success=False,
                        response_time=response_time,
                        status_code=response.status,
                        error=error_text
                    )
                    
        except Exception as e:
            response_time = time.time() - start_time
            return TestResult(
                success=False,
                response_time=response_time,
                status_code=0,
                error=str(e)
            )
    
    async def batch_test(self, session: aiohttp.ClientSession, batch_size: int = 50) -> TestResult:
        """Test batch processing with high concurrency."""
        start_time = time.time()
        
        # Create a large batch request
        items = []
        test_urls = [
            "https://example.com",
            "https://google.com",
            "https://github.com",
            "https://stackoverflow.com",
            "https://reddit.com"
        ]
        
        for i in range(batch_size):
            items.append({
                "id": f"test-{i}",
                "url": test_urls[i % len(test_urls)],
                "width": 1280,
                "height": 720,
                "format": "png"
            })
        
        payload = {
            "items": items,
            "config": {
                "parallel": 20,  # High parallelism
                "timeout": 30,
                "cache": True,
                "fail_fast": False
            }
        }
        
        try:
            # Submit batch job
            async with session.post(
                f"{self.base_url}/batch/screenshots",
                json=payload,
                timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                if response.status != 202:
                    error_text = await response.text()
                    return TestResult(
                        success=False,
                        response_time=time.time() - start_time,
                        status_code=response.status,
                        error=f"Failed to submit batch: {error_text}"
                    )
                
                batch_data = await response.json()
                job_id = batch_data["job_id"]
            
            # Poll for completion
            max_wait = 300  # 5 minutes max
            poll_start = time.time()
            
            while time.time() - poll_start < max_wait:
                async with session.get(f"{self.base_url}/batch/screenshots/{job_id}") as response:
                    if response.status == 200:
                        status_data = await response.json()
                        if status_data["status"] in ["completed", "failed"]:
                            response_time = time.time() - start_time
                            return TestResult(
                                success=status_data["status"] == "completed",
                                response_time=response_time,
                                status_code=200,
                                error=None if status_data["status"] == "completed" else "Batch failed"
                            )
                
                await asyncio.sleep(2)  # Poll every 2 seconds
            
            # Timeout
            return TestResult(
                success=False,
                response_time=time.time() - start_time,
                status_code=408,
                error="Batch processing timeout"
            )
            
        except Exception as e:
            return TestResult(
                success=False,
                response_time=time.time() - start_time,
                status_code=0,
                error=str(e)
            )
    
    async def run_concurrent_test(self, concurrency: int, total_requests: int, test_urls: List[str]):
        """Run concurrent load test."""
        print(f"🚀 Starting load test: {concurrency} concurrent, {total_requests} total requests")
        
        # Create semaphore to limit concurrency
        semaphore = asyncio.Semaphore(concurrency)
        
        async def bounded_request(session: aiohttp.ClientSession, url: str, request_id: int):
            async with semaphore:
                return await self.single_screenshot_request(session, url, request_id)
        
        # Create session with optimized settings
        connector = aiohttp.TCPConnector(
            limit=concurrency * 2,
            limit_per_host=concurrency,
            keepalive_timeout=30,
            enable_cleanup_closed=True
        )
        
        start_time = time.time()
        
        async with aiohttp.ClientSession(connector=connector) as session:
            # Create tasks
            tasks = []
            for i in range(total_requests):
                url = test_urls[i % len(test_urls)]
                task = bounded_request(session, url, i)
                tasks.append(task)
            
            # Execute all tasks
            print(f"⏳ Executing {len(tasks)} requests...")
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Process results
            for result in results:
                if isinstance(result, TestResult):
                    self.results.append(result)
                else:
                    # Handle exceptions
                    self.results.append(TestResult(
                        success=False,
                        response_time=0,
                        status_code=0,
                        error=str(result)
                    ))
        
        total_time = time.time() - start_time
        self.print_results(total_time, concurrency)
    
    def print_results(self, total_time: float, concurrency: int):
        """Print test results."""
        successful = [r for r in self.results if r.success]
        failed = [r for r in self.results if not r.success]
        
        if successful:
            avg_response_time = sum(r.response_time for r in successful) / len(successful)
            min_response_time = min(r.response_time for r in successful)
            max_response_time = max(r.response_time for r in successful)
            p95_response_time = sorted([r.response_time for r in successful])[int(len(successful) * 0.95)]
        else:
            avg_response_time = min_response_time = max_response_time = p95_response_time = 0
        
        requests_per_second = len(self.results) / total_time
        
        print("\n" + "=" * 60)
        print("📊 LOAD TEST RESULTS")
        print("=" * 60)
        print(f"Total Requests:     {len(self.results)}")
        print(f"Successful:         {len(successful)} ({len(successful)/len(self.results)*100:.1f}%)")
        print(f"Failed:             {len(failed)} ({len(failed)/len(self.results)*100:.1f}%)")
        print(f"Total Time:         {total_time:.2f}s")
        print(f"Requests/Second:    {requests_per_second:.2f}")
        print(f"Concurrency:        {concurrency}")
        print()
        print("📈 RESPONSE TIMES:")
        print(f"Average:            {avg_response_time:.2f}s")
        print(f"Minimum:            {min_response_time:.2f}s")
        print(f"Maximum:            {max_response_time:.2f}s")
        print(f"95th Percentile:    {p95_response_time:.2f}s")
        
        if failed:
            print("\n❌ ERROR SUMMARY:")
            error_counts = {}
            for result in failed:
                error_key = f"HTTP {result.status_code}" if result.status_code > 0 else "Network Error"
                error_counts[error_key] = error_counts.get(error_key, 0) + 1
            
            for error, count in error_counts.items():
                print(f"  {error}: {count}")
        
        print("\n" + "=" * 60)

async def main():
    parser = argparse.ArgumentParser(description="Load test for 2000 concurrent screenshots")
    parser.add_argument("--url", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--concurrency", type=int, default=100, help="Number of concurrent requests")
    parser.add_argument("--requests", type=int, default=1000, help="Total number of requests")
    parser.add_argument("--ramp-up", action="store_true", help="Gradually ramp up to target concurrency")
    parser.add_argument("--batch-test", action="store_true", help="Test batch processing")
    parser.add_argument("--production", action="store_true", help="Use production URL and test scenarios")

    args = parser.parse_args()

    tester = LoadTester(args.url)

    # Test URLs - mix of simple and complex sites
    if args.production:
        # Production test URLs including URL transformation scenarios
        test_urls = [
            "https://viding.co",  # Will be transformed to http://viding-co_website-revamp
            "https://viding.org", # Will be transformed to http://viding-org_website-revamp
            "https://viding.co/about",
            "https://viding.org/contact",
            "https://example.com",
            "https://httpbin.org/html",
            "https://google.com"
        ]
    else:
        test_urls = [
            "https://example.com",
            "https://httpbin.org/html",
            "https://google.com",
            "https://github.com",
            "https://stackoverflow.com"
        ]
    
    if args.batch_test:
        print("🔄 Running batch processing test...")
        async with aiohttp.ClientSession() as session:
            result = await tester.batch_test(session, 100)
            print(f"Batch test result: {'✅ Success' if result.success else '❌ Failed'}")
            print(f"Response time: {result.response_time:.2f}s")
            if result.error:
                print(f"Error: {result.error}")
    else:
        if args.ramp_up:
            # Gradual ramp-up test
            ramp_steps = [10, 25, 50, 100, 200, 500, 1000, 2000]
            for step_concurrency in ramp_steps:
                if step_concurrency > args.concurrency:
                    break
                print(f"\n🔄 Ramp-up step: {step_concurrency} concurrent requests")
                tester.results = []  # Reset results
                await tester.run_concurrent_test(step_concurrency, min(step_concurrency * 2, args.requests), test_urls)
                await asyncio.sleep(5)  # Brief pause between steps
        else:
            await tester.run_concurrent_test(args.concurrency, args.requests, test_urls)

if __name__ == "__main__":
    asyncio.run(main())
