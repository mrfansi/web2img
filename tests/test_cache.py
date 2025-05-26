#!/usr/bin/env python
"""
Test script for the web2img caching system.

This script tests the performance of the caching system by making multiple
requests to the screenshot endpoint with and without caching.
"""

import asyncio
import time
import json
import argparse
from typing import Dict, Any, List

import aiohttp


async def capture_screenshot(session: aiohttp.ClientSession, url: str, test_url: str, use_cache: bool = True) -> Dict[str, Any]:
    """
    Capture a screenshot using the web2img API.
    
    Args:
        session: HTTP session to use
        url: URL of the web2img API
        test_url: URL to capture screenshot of
        use_cache: Whether to use the cache
        
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
        
        # Add cache parameter if needed
        cache_param = "" if use_cache else "?cache=false"
        
        async with session.post(f"{url}/screenshot{cache_param}", json=payload) as response:
            status = response.status
            if status == 200:
                data = await response.json()
                result = {
                    "success": True,
                    "status": status,
                    "url": data.get("url", ""),
                    "time": time.time() - start_time,
                    "cached": use_cache
                }
            else:
                text = await response.text()
                result = {
                    "success": False,
                    "status": status,
                    "error": text,
                    "time": time.time() - start_time,
                    "cached": use_cache
                }
    except Exception as e:
        result = {
            "success": False,
            "error": str(e),
            "time": time.time() - start_time,
            "cached": use_cache
        }
    
    return result


async def get_cache_stats(session: aiohttp.ClientSession, url: str) -> Dict[str, Any]:
    """
    Get cache statistics from the API.
    
    Args:
        session: HTTP session to use
        url: URL of the web2img API
        
    Returns:
        Dictionary with cache statistics
    """
    try:
        async with session.get(f"{url}/cache/stats") as response:
            if response.status == 200:
                return await response.json()
            else:
                return {"error": await response.text()}
    except Exception as e:
        return {"error": str(e)}


async def clear_cache(session: aiohttp.ClientSession, url: str) -> bool:
    """
    Clear the cache.
    
    Args:
        session: HTTP session to use
        url: URL of the web2img API
        
    Returns:
        True if successful, False otherwise
    """
    try:
        async with session.delete(f"{url}/cache") as response:
            return response.status == 204
    except Exception:
        return False


async def run_cache_test(api_url: str, test_urls: List[str], iterations: int) -> None:
    """
    Run a test of the caching system.
    
    Args:
        api_url: URL of the web2img API
        test_urls: List of URLs to capture screenshots of
        iterations: Number of times to request each URL
    """
    async with aiohttp.ClientSession() as session:
        # Clear the cache to start fresh
        print("Clearing cache...")
        success = await clear_cache(session, api_url)
        if not success:
            print("Failed to clear cache, but continuing with test")
        
        # Get initial cache stats
        print("\nInitial cache stats:")
        stats = await get_cache_stats(session, api_url)
        print(json.dumps(stats, indent=2))
        
        # Test with cache disabled (baseline)
        print("\nTesting with cache disabled (baseline)...")
        uncached_results = []
        for i, test_url in enumerate(test_urls):
            print(f"Testing URL {i+1}/{len(test_urls)}: {test_url}")
            for j in range(iterations):
                result = await capture_screenshot(session, api_url, test_url, use_cache=False)
                uncached_results.append(result)
                print(f"  Request {j+1}/{iterations}: {'Success' if result['success'] else 'Failed'} in {result['time']:.2f}s")
        
        # Calculate average time for uncached requests
        uncached_times = [r["time"] for r in uncached_results if r["success"]]
        avg_uncached_time = sum(uncached_times) / len(uncached_times) if uncached_times else 0
        print(f"\nAverage time for uncached requests: {avg_uncached_time:.2f}s")
        
        # Clear the cache again
        print("\nClearing cache...")
        await clear_cache(session, api_url)
        
        # Test with cache enabled
        print("\nTesting with cache enabled...")
        cached_results = []
        for i, test_url in enumerate(test_urls):
            print(f"Testing URL {i+1}/{len(test_urls)}: {test_url}")
            for j in range(iterations):
                result = await capture_screenshot(session, api_url, test_url, use_cache=True)
                cached_results.append(result)
                print(f"  Request {j+1}/{iterations}: {'Success' if result['success'] else 'Failed'} in {result['time']:.2f}s")
        
        # Calculate average time for first (uncached) and subsequent (cached) requests
        first_request_times = []
        subsequent_request_times = []
        
        current_url = None
        for result in cached_results:
            if result["success"]:
                url = result.get("url", "")
                if url != current_url:
                    current_url = url
                    first_request_times.append(result["time"])
                else:
                    subsequent_request_times.append(result["time"])
        
        avg_first_time = sum(first_request_times) / len(first_request_times) if first_request_times else 0
        avg_subsequent_time = sum(subsequent_request_times) / len(subsequent_request_times) if subsequent_request_times else 0
        
        print(f"\nAverage time for first requests (uncached): {avg_first_time:.2f}s")
        print(f"Average time for subsequent requests (cached): {avg_subsequent_time:.2f}s")
        
        if avg_subsequent_time > 0 and avg_uncached_time > 0:
            speedup = avg_uncached_time / avg_subsequent_time
            print(f"Speedup from caching: {speedup:.2f}x")
        
        # Get final cache stats
        print("\nFinal cache stats:")
        stats = await get_cache_stats(session, api_url)
        print(json.dumps(stats, indent=2))


async def main():
    """
    Main entry point for the cache test script.
    """
    parser = argparse.ArgumentParser(description="Test the web2img caching system")
    parser.add_argument("--url", default="http://localhost:8000", help="URL of the web2img API")
    parser.add_argument("--iterations", type=int, default=3, help="Number of times to request each URL")
    
    args = parser.parse_args()
    
    # List of test URLs
    test_urls = [
        "https://viding.co/mini-rsvp/1179317",
        "https://viding.co/mini-rsvp/1179324",
        "https://viding.co/mini-rsvp/1179333"
    ]
    
    # Run the cache test
    await run_cache_test(args.url, test_urls, args.iterations)


if __name__ == "__main__":
    asyncio.run(main())
