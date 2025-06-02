#!/usr/bin/env python3
"""
Test URL Transformation Functionality
Tests the URL transformation feature for viding.co and viding.org domains
"""

import pytest
import asyncio
import aiohttp
import json
from typing import Dict, Any

class URLTransformationTester:
    def __init__(self, base_url: str = "http://localhost:8000"):
        self.base_url = base_url
    
    async def test_single_screenshot_transformation(self, url: str, expected_transformation: str = None) -> Dict[str, Any]:
        """Test URL transformation for single screenshot endpoint."""
        payload = {
            "url": url,
            "width": 1280,
            "height": 720,
            "format": "png"
        }
        
        async with aiohttp.ClientSession() as session:
            try:
                async with session.post(
                    f"{self.base_url}/screenshot",
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=60)
                ) as response:
                    result = {
                        "original_url": url,
                        "expected_transformation": expected_transformation,
                        "status_code": response.status,
                        "success": response.status == 200
                    }
                    
                    if response.status == 200:
                        data = await response.json()
                        result["response"] = data
                    else:
                        result["error"] = await response.text()
                    
                    return result
            except Exception as e:
                return {
                    "original_url": url,
                    "expected_transformation": expected_transformation,
                    "status_code": 0,
                    "success": False,
                    "error": str(e)
                }
    
    async def test_batch_screenshot_transformation(self, urls: list) -> Dict[str, Any]:
        """Test URL transformation for batch screenshot endpoint."""
        items = []
        for i, url in enumerate(urls):
            items.append({
                "id": f"test-{i}",
                "url": url,
                "width": 1280,
                "height": 720,
                "format": "png"
            })
        
        payload = {
            "items": items,
            "config": {
                "parallel": 3,
                "timeout": 30,
                "cache": False,  # Disable cache for testing
                "fail_fast": False
            }
        }
        
        async with aiohttp.ClientSession() as session:
            try:
                # Submit batch job
                async with session.post(
                    f"{self.base_url}/batch/screenshots",
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as response:
                    if response.status != 202:
                        return {
                            "success": False,
                            "error": f"Failed to submit batch: {response.status}",
                            "response": await response.text()
                        }
                    
                    batch_data = await response.json()
                    job_id = batch_data["job_id"]
                
                # Poll for completion
                max_wait = 300  # 5 minutes
                poll_start = asyncio.get_event_loop().time()
                
                while asyncio.get_event_loop().time() - poll_start < max_wait:
                    async with session.get(f"{self.base_url}/batch/screenshots/{job_id}") as response:
                        if response.status == 200:
                            status_data = await response.json()
                            if status_data["status"] in ["completed", "failed"]:
                                # Get results
                                async with session.get(f"{self.base_url}/batch/screenshots/{job_id}/results") as results_response:
                                    if results_response.status == 200:
                                        results_data = await results_response.json()
                                        return {
                                            "success": True,
                                            "job_id": job_id,
                                            "status": status_data["status"],
                                            "results": results_data
                                        }
                    
                    await asyncio.sleep(2)
                
                return {
                    "success": False,
                    "error": "Batch processing timeout",
                    "job_id": job_id
                }
                
            except Exception as e:
                return {
                    "success": False,
                    "error": str(e)
                }
    
    def print_test_results(self, results: list):
        """Print formatted test results."""
        print("=" * 80)
        print("🧪 URL TRANSFORMATION TEST RESULTS")
        print("=" * 80)
        
        for i, result in enumerate(results, 1):
            print(f"\n📋 Test {i}: {result['original_url']}")
            print(f"   Expected: {result.get('expected_transformation', 'No transformation')}")
            print(f"   Status: {'✅ SUCCESS' if result['success'] else '❌ FAILED'}")
            print(f"   HTTP Code: {result['status_code']}")
            
            if result['success']:
                print(f"   Response URL: {result['response']['url'][:100]}...")
            else:
                print(f"   Error: {result.get('error', 'Unknown error')}")
        
        success_count = sum(1 for r in results if r['success'])
        print(f"\n📊 Summary: {success_count}/{len(results)} tests passed")
        print("=" * 80)

async def main():
    tester = URLTransformationTester()
    
    # Test cases for URL transformation
    test_cases = [
        {
            "url": "https://viding.co",
            "expected": "http://viding-co_website-revamp"
        },
        {
            "url": "https://www.viding.co",
            "expected": "http://viding-co_website-revamp"
        },
        {
            "url": "https://viding.co/about",
            "expected": "http://viding-co_website-revamp/about"
        },
        {
            "url": "https://viding.org",
            "expected": "http://viding-org_website-revamp"
        },
        {
            "url": "https://www.viding.org",
            "expected": "http://viding-org_website-revamp"
        },
        {
            "url": "https://viding.org/contact",
            "expected": "http://viding-org_website-revamp/contact"
        },
        {
            "url": "https://example.com",
            "expected": "No transformation (should remain as-is)"
        },
        {
            "url": "https://google.com",
            "expected": "No transformation (should remain as-is)"
        }
    ]
    
    print("🚀 Starting URL Transformation Tests...")
    print(f"Testing against: {tester.base_url}")
    
    # Test single screenshot endpoint
    print("\n📸 Testing Single Screenshot Endpoint...")
    single_results = []
    
    for test_case in test_cases:
        print(f"Testing: {test_case['url']}")
        result = await tester.test_single_screenshot_transformation(
            test_case['url'], 
            test_case['expected']
        )
        single_results.append(result)
        await asyncio.sleep(1)  # Brief pause between requests
    
    tester.print_test_results(single_results)
    
    # Test batch screenshot endpoint
    print("\n📦 Testing Batch Screenshot Endpoint...")
    batch_urls = [case['url'] for case in test_cases[:4]]  # Test first 4 URLs
    batch_result = await tester.test_batch_screenshot_transformation(batch_urls)
    
    if batch_result['success']:
        print("✅ Batch processing completed successfully")
        print(f"Job ID: {batch_result['job_id']}")
        print(f"Status: {batch_result['status']}")
        
        if 'results' in batch_result:
            results = batch_result['results']['results']
            print(f"Processed {len(results)} items:")
            for result in results:
                status_emoji = "✅" if result['status'] == 'success' else "❌"
                print(f"  {status_emoji} {result['id']}: {result['status']}")
    else:
        print(f"❌ Batch processing failed: {batch_result['error']}")
    
    print("\n🎉 URL Transformation Tests Completed!")

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Test URL transformation functionality")
    parser.add_argument("--url", default="http://localhost:8000", help="API base URL")
    
    args = parser.parse_args()
    
    # Update the tester with the provided URL
    tester = URLTransformationTester(args.url)
    
    # Run the tests
    asyncio.run(main())
