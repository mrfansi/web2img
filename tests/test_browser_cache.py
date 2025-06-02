#!/usr/bin/env python3
"""
Test Browser Cache Functionality
Tests the browser cache feature for CSS, JS, and media files
"""

import asyncio
import aiohttp
import time
import json
from typing import Dict, Any, List

class BrowserCacheTester:
    def __init__(self, base_url: str = "http://localhost:8000"):
        self.base_url = base_url
    
    async def test_cache_stats(self) -> Dict[str, Any]:
        """Test cache statistics endpoint."""
        async with aiohttp.ClientSession() as session:
            try:
                async with session.get(f"{self.base_url}/browser-cache/stats") as response:
                    return {
                        "success": response.status == 200,
                        "status_code": response.status,
                        "data": await response.json() if response.status == 200 else await response.text()
                    }
            except Exception as e:
                return {
                    "success": False,
                    "error": str(e)
                }
    
    async def test_cache_info(self) -> Dict[str, Any]:
        """Test cache information endpoint."""
        async with aiohttp.ClientSession() as session:
            try:
                async with session.get(f"{self.base_url}/browser-cache/info") as response:
                    return {
                        "success": response.status == 200,
                        "status_code": response.status,
                        "data": await response.json() if response.status == 200 else await response.text()
                    }
            except Exception as e:
                return {
                    "success": False,
                    "error": str(e)
                }
    
    async def test_cache_performance(self) -> Dict[str, Any]:
        """Test cache performance endpoint."""
        async with aiohttp.ClientSession() as session:
            try:
                async with session.get(f"{self.base_url}/browser-cache/performance") as response:
                    return {
                        "success": response.status == 200,
                        "status_code": response.status,
                        "data": await response.json() if response.status == 200 else await response.text()
                    }
            except Exception as e:
                return {
                    "success": False,
                    "error": str(e)
                }
    
    async def test_cache_cleanup(self) -> Dict[str, Any]:
        """Test cache cleanup endpoint."""
        async with aiohttp.ClientSession() as session:
            try:
                async with session.post(f"{self.base_url}/browser-cache/cleanup") as response:
                    return {
                        "success": response.status == 200,
                        "status_code": response.status,
                        "data": await response.json() if response.status == 200 else await response.text()
                    }
            except Exception as e:
                return {
                    "success": False,
                    "error": str(e)
                }
    
    async def test_screenshot_with_cache(self, url: str) -> Dict[str, Any]:
        """Test screenshot capture with browser cache enabled."""
        payload = {
            "url": url,
            "width": 1280,
            "height": 720,
            "format": "png"
        }
        
        async with aiohttp.ClientSession() as session:
            try:
                start_time = time.time()
                async with session.post(
                    f"{self.base_url}/screenshot",
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=60)
                ) as response:
                    end_time = time.time()
                    
                    return {
                        "success": response.status == 200,
                        "status_code": response.status,
                        "response_time": end_time - start_time,
                        "url": url,
                        "data": await response.json() if response.status == 200 else await response.text()
                    }
            except Exception as e:
                return {
                    "success": False,
                    "error": str(e),
                    "url": url
                }
    
    async def test_cache_effectiveness(self) -> Dict[str, Any]:
        """Test cache effectiveness by taking screenshots of resource-heavy sites."""
        # Sites with lots of CSS/JS resources that should benefit from caching
        test_sites = [
            "https://getbootstrap.com",  # Bootstrap CSS/JS
            "https://fontawesome.com",   # Font files
            "https://jquery.com",        # jQuery library
            "https://cdnjs.com",         # CDN resources
        ]
        
        results = []
        
        # Get initial cache stats
        initial_stats = await self.test_cache_stats()
        
        for site in test_sites:
            print(f"Testing cache effectiveness with: {site}")
            
            # First request (should populate cache)
            first_result = await self.test_screenshot_with_cache(site)
            await asyncio.sleep(2)  # Brief pause
            
            # Second request (should benefit from cache)
            second_result = await self.test_screenshot_with_cache(site)
            
            results.append({
                "site": site,
                "first_request": first_result,
                "second_request": second_result,
                "cache_benefit": {
                    "time_difference": first_result.get("response_time", 0) - second_result.get("response_time", 0),
                    "both_successful": first_result.get("success", False) and second_result.get("success", False)
                }
            })
            
            await asyncio.sleep(3)  # Pause between sites
        
        # Get final cache stats
        final_stats = await self.test_cache_stats()
        
        return {
            "test_results": results,
            "initial_cache_stats": initial_stats,
            "final_cache_stats": final_stats,
            "cache_improvement": {
                "hits_gained": (final_stats.get("data", {}).get("hits", 0) - 
                               initial_stats.get("data", {}).get("hits", 0)),
                "items_cached": (final_stats.get("data", {}).get("cached_items", 0) - 
                                initial_stats.get("data", {}).get("cached_items", 0))
            }
        }
    
    def print_test_results(self, results: Dict[str, Any]):
        """Print formatted test results."""
        print("=" * 80)
        print("🧪 BROWSER CACHE TEST RESULTS")
        print("=" * 80)
        
        # Cache Stats Test
        if "cache_stats" in results:
            stats_result = results["cache_stats"]
            print(f"\n📊 Cache Stats Test: {'✅ PASSED' if stats_result['success'] else '❌ FAILED'}")
            if stats_result["success"]:
                data = stats_result["data"]
                print(f"   Cache Enabled: {data.get('enabled', False)}")
                print(f"   Hit Rate: {data.get('hit_rate', 0):.2%}")
                print(f"   Cache Size: {data.get('cache_size_mb', 0):.2f} MB")
                print(f"   Cached Items: {data.get('cached_items', 0)}")
        
        # Cache Info Test
        if "cache_info" in results:
            info_result = results["cache_info"]
            print(f"\n📋 Cache Info Test: {'✅ PASSED' if info_result['success'] else '❌ FAILED'}")
            if info_result["success"]:
                data = info_result["data"]
                print(f"   Max Cache Size: {data.get('configuration', {}).get('max_cache_size_mb', 0)} MB")
                print(f"   Cache TTL: {data.get('configuration', {}).get('cache_ttl_hours', 0)} hours")
                print(f"   Priority Domains: {len(data.get('priority_domains', []))}")
        
        # Cache Performance Test
        if "cache_performance" in results:
            perf_result = results["cache_performance"]
            print(f"\n⚡ Cache Performance Test: {'✅ PASSED' if perf_result['success'] else '❌ FAILED'}")
            if perf_result["success"]:
                data = perf_result["data"]
                metrics = data.get("performance_metrics", {})
                print(f"   Performance Grade: {metrics.get('performance_grade', 'N/A')}")
                print(f"   Total Requests: {metrics.get('total_requests', 0)}")
                print(f"   Cache Hits: {metrics.get('cache_hits', 0)}")
        
        # Cache Effectiveness Test
        if "cache_effectiveness" in results:
            eff_result = results["cache_effectiveness"]
            print(f"\n🎯 Cache Effectiveness Test:")
            
            improvement = eff_result.get("cache_improvement", {})
            print(f"   Cache Hits Gained: {improvement.get('hits_gained', 0)}")
            print(f"   Items Cached: {improvement.get('items_cached', 0)}")
            
            test_results = eff_result.get("test_results", [])
            successful_tests = sum(1 for r in test_results if r["cache_benefit"]["both_successful"])
            print(f"   Successful Tests: {successful_tests}/{len(test_results)}")
            
            for result in test_results:
                site = result["site"]
                benefit = result["cache_benefit"]
                success_emoji = "✅" if benefit["both_successful"] else "❌"
                time_saved = benefit.get("time_difference", 0)
                print(f"   {success_emoji} {site}: {time_saved:.2f}s time difference")
        
        print("\n" + "=" * 80)

async def main():
    tester = BrowserCacheTester()
    
    print("🚀 Starting Browser Cache Tests...")
    print(f"Testing against: {tester.base_url}")
    
    results = {}
    
    # Test 1: Cache Stats
    print("\n📊 Testing cache statistics...")
    results["cache_stats"] = await tester.test_cache_stats()
    
    # Test 2: Cache Info
    print("📋 Testing cache information...")
    results["cache_info"] = await tester.test_cache_info()
    
    # Test 3: Cache Performance
    print("⚡ Testing cache performance...")
    results["cache_performance"] = await tester.test_cache_performance()
    
    # Test 4: Cache Cleanup
    print("🧹 Testing cache cleanup...")
    results["cache_cleanup"] = await tester.test_cache_cleanup()
    
    # Test 5: Cache Effectiveness (takes longer)
    print("🎯 Testing cache effectiveness with real websites...")
    print("   This may take a few minutes...")
    results["cache_effectiveness"] = await tester.test_cache_effectiveness()
    
    # Print results
    tester.print_test_results(results)
    
    # Summary
    successful_tests = sum(1 for test_name, result in results.items() 
                          if test_name != "cache_effectiveness" and result.get("success", False))
    total_basic_tests = len(results) - 1  # Exclude effectiveness test
    
    print(f"\n🎉 Browser Cache Tests Completed!")
    print(f"Basic Tests: {successful_tests}/{total_basic_tests} passed")
    
    if "cache_effectiveness" in results:
        eff_data = results["cache_effectiveness"]
        cache_hits_gained = eff_data.get("cache_improvement", {}).get("hits_gained", 0)
        if cache_hits_gained > 0:
            print(f"✅ Cache is working! Gained {cache_hits_gained} cache hits during testing")
        else:
            print("⚠️ Cache may not be working optimally - no cache hits gained")

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Test browser cache functionality")
    parser.add_argument("--url", default="http://localhost:8000", help="API base URL")
    
    args = parser.parse_args()
    
    # Update the tester with the provided URL
    tester = BrowserCacheTester(args.url)
    
    # Run the tests
    asyncio.run(main())
