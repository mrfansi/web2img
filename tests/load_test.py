#!/usr/bin/env python
"""
Load test script for web2img service.

This script tests the performance of the web2img service by sending multiple
concurrent requests to the screenshot endpoint.
"""

import asyncio
import time
import json
import argparse
from typing import Dict, List, Any

import aiohttp


async def capture_screenshot(session: aiohttp.ClientSession, url: str, test_url: str) -> Dict[str, Any]:
    """
    Capture a screenshot using the web2img API.
    
    Args:
        session: HTTP session to use
        url: URL of the web2img API
        test_url: URL to capture screenshot of
        
    Returns:
        Dictionary with response data and timing information
    """
    start_time = time.time()
    
    try:
        payload = {
            "url": test_url,
            "width": 1280,
            "height": 720,
            "format": "png"
        }
        
        async with session.post(f"{url}/screenshot", json=payload) as response:
            status = response.status
            if status == 200:
                data = await response.json()
                result = {
                    "success": True,
                    "status": status,
                    "url": data.get("url", ""),
                    "time": time.time() - start_time
                }
            else:
                text = await response.text()
                result = {
                    "success": False,
                    "status": status,
                    "error": text,
                    "time": time.time() - start_time
                }
    except Exception as e:
        result = {
            "success": False,
            "error": str(e),
            "time": time.time() - start_time
        }
    
    return result


async def check_health(session: aiohttp.ClientSession, url: str) -> Dict[str, Any]:
    """
    Check the health of the web2img service.
    
    Args:
        session: HTTP session to use
        url: URL of the web2img API
        
    Returns:
        Dictionary with health status
    """
    try:
        async with session.get(f"{url}/health") as response:
            if response.status == 200:
                return await response.json()
            else:
                return {"status": "error", "message": await response.text()}
    except Exception as e:
        return {"status": "error", "message": str(e)}


async def run_load_test(api_url: str, test_urls: List[str], concurrency: int, total_requests: int) -> Dict[str, Any]:
    """
    Run a load test against the web2img service.
    
    Args:
        api_url: URL of the web2img API
        test_urls: List of URLs to capture screenshots of
        concurrency: Number of concurrent requests
        total_requests: Total number of requests to make
        
    Returns:
        Dictionary with test results
    """
    # Check service health before starting
    async with aiohttp.ClientSession() as session:
        print("Checking service health...")
        health = await check_health(session, api_url)
        if health.get("status") != "ok":
            print(f"Service is not healthy: {health}")
            return {"success": False, "error": "Service is not healthy"}
        
        print(f"Service is healthy: {health}")
        print(f"Starting load test with {concurrency} concurrent requests, {total_requests} total requests")
        
        # Create a semaphore to limit concurrency
        semaphore = asyncio.Semaphore(concurrency)
        
        # Create tasks for all requests
        tasks = []
        for i in range(total_requests):
            # Cycle through test URLs
            test_url = test_urls[i % len(test_urls)]
            
            # Create a task that respects the semaphore
            tasks.append(
                run_with_semaphore(semaphore, capture_screenshot, session, api_url, test_url)
            )
        
        # Start the timer
        start_time = time.time()
        
        # Run all tasks
        results = await asyncio.gather(*tasks)
        
        # Calculate statistics
        end_time = time.time()
        total_time = end_time - start_time
        
        successful_requests = [r for r in results if r.get("success", False)]
        failed_requests = [r for r in results if not r.get("success", False)]
        
        response_times = [r.get("time", 0) for r in results if r.get("success", False)]
        avg_response_time = sum(response_times) / len(response_times) if response_times else 0
        min_response_time = min(response_times) if response_times else 0
        max_response_time = max(response_times) if response_times else 0
        
        # Prepare the result
        return {
            "total_requests": total_requests,
            "successful_requests": len(successful_requests),
            "failed_requests": len(failed_requests),
            "total_time": total_time,
            "requests_per_second": total_requests / total_time,
            "avg_response_time": avg_response_time,
            "min_response_time": min_response_time,
            "max_response_time": max_response_time,
            "concurrency": concurrency,
            "detailed_results": results
        }


async def run_with_semaphore(semaphore, func, *args, **kwargs):
    """
    Run a function with a semaphore to limit concurrency.
    
    Args:
        semaphore: Semaphore to use
        func: Function to run
        *args: Arguments to pass to the function
        **kwargs: Keyword arguments to pass to the function
        
    Returns:
        Result of the function
    """
    async with semaphore:
        return await func(*args, **kwargs)


def print_results(results: Dict[str, Any]) -> None:
    """
    Print the results of a load test.
    
    Args:
        results: Dictionary with test results
    """
    print("\n===== LOAD TEST RESULTS =====")
    print(f"Total requests: {results['total_requests']}")
    print(f"Successful requests: {results['successful_requests']}")
    print(f"Failed requests: {results['failed_requests']}")
    print(f"Total time: {results['total_time']:.2f} seconds")
    print(f"Requests per second: {results['requests_per_second']:.2f}")
    print(f"Average response time: {results['avg_response_time']:.2f} seconds")
    print(f"Minimum response time: {results['min_response_time']:.2f} seconds")
    print(f"Maximum response time: {results['max_response_time']:.2f} seconds")
    print("============================\n")
    
    if results['failed_requests'] > 0:
        print("\n===== FAILED REQUESTS =====")
        for result in results['detailed_results']:
            if not result.get("success", False):
                print(f"Status: {result.get('status', 'N/A')}")
                print(f"Error: {result.get('error', 'Unknown')}")
                print("---")
        print("============================\n")


async def main():
    """
    Main entry point for the load test script.
    """
    parser = argparse.ArgumentParser(description="Load test for web2img service")
    parser.add_argument("--url", default="http://localhost:8000", help="URL of the web2img API")
    parser.add_argument("--concurrency", type=int, default=10, help="Number of concurrent requests")
    parser.add_argument("--requests", type=int, default=50, help="Total number of requests")
    parser.add_argument("--output", help="Output file for detailed results (JSON)")
    
    args = parser.parse_args()
    
    # List of test URLs
    test_urls = [
        "https://example.com",
        "https://google.com",
        "https://github.com",
        "https://news.ycombinator.com",
        "https://mozilla.org"
    ]
    
    # Run the load test
    results = await run_load_test(args.url, test_urls, args.concurrency, args.requests)
    
    # Print the results
    print_results(results)
    
    # Save detailed results to file if requested
    if args.output:
        with open(args.output, "w") as f:
            json.dump(results, f, indent=2)
        print(f"Detailed results saved to {args.output}")


if __name__ == "__main__":
    asyncio.run(main())
