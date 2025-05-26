#!/usr/bin/env python3

import argparse
import asyncio
import json
import time
from typing import Dict, List, Any

import httpx


async def test_batch_processing(base_url: str = "http://localhost:8000", urls: List[str] = None, parallel: int = 3, use_cache: bool = True) -> None:
    # Default list of URLs if none provided
    if urls is None:
        urls = [
            "https://example.com",
            "https://google.com",
            "https://github.com",
            "https://microsoft.com",
            "https://apple.com"
        ]
    """Test the batch processing API with the given URLs."""
    print("\nTesting batch processing API...\n")
    
    # Prepare batch request
    items = []
    for i, url in enumerate(urls):
        items.append({
            "url": url,
            "width": 1280,
            "height": 720,
            "format": "png",
            "id": f"test-{i}"
        })
    
    batch_request = {
        "items": items,
        "config": {
            "parallel": parallel,
            "timeout": 30,
            "fail_fast": False,
            "cache": use_cache
        }
    }
    
    # Submit batch job
    print(f"Submitting batch job with {len(items)} URLs...")
    start_time = time.time()
    
    async with httpx.AsyncClient(timeout=120.0) as client:
        # Create batch job
        response = await client.post(
            f"{base_url}/batch/screenshots",
            json=batch_request
        )
        
        if response.status_code != 202:
            print(f"Error creating batch job: {response.status_code} {response.text}")
            return
        
        job_data = response.json()
        job_id = job_data["job_id"]
        print(f"Batch job created: {job_id}")
        print(f"Initial status: {job_data['status']}")
        print(f"Total items: {job_data['total']}")
        
        # Poll for job status
        completed = False
        while not completed:
            await asyncio.sleep(1.0)  # Wait before checking status
            
            response = await client.get(f"{base_url}/batch/screenshots/{job_id}")
            
            if response.status_code != 200:
                print(f"Error checking job status: {response.status_code} {response.text}")
                return
            
            status_data = response.json()
            print(f"Status: {status_data['status']}, Completed: {status_data['completed']}/{status_data['total']}")
            
            if status_data["status"] in ["completed", "completed_with_errors", "failed"]:
                completed = True
        
        # Get job results
        response = await client.get(f"{base_url}/batch/screenshots/{job_id}/results")
        
        if response.status_code != 200:
            print(f"Error getting job results: {response.status_code} {response.text}")
            return
        
        results_data = response.json()
        
        # Calculate processing time
        total_time = time.time() - start_time
        
        # Print results
        print("\nBatch processing results:")
        print(f"Job ID: {results_data['job_id']}")
        print(f"Status: {results_data['status']}")
        print(f"Total items: {results_data['total']}")
        print(f"Succeeded: {results_data['succeeded']}")
        print(f"Failed: {results_data['failed']}")
        print(f"Processing time (API): {results_data['processing_time']:.2f}s")
        print(f"Total time (including polling): {total_time:.2f}s")
        # Avoid division by zero for cached results
        if results_data['processing_time'] > 0:
            print(f"Throughput: {results_data['total'] / results_data['processing_time']:.2f} screenshots/second")
        else:
            print("Throughput: ∞ screenshots/second (cached results)")

        
        # Print item results
        print("\nItem results:")
        for item in results_data["results"]:
            status_icon = "✅" if item["status"] == "success" else "❌"
            cache_icon = "🔄" if item.get("cached") else "🆕"
            print(f"{status_icon} {cache_icon} {item['id']}: {item['status']}")
            if item["status"] == "success":
                print(f"    URL: {item['url']}")
            else:
                print(f"    Error: {item.get('error', 'Unknown error')}")
        
        # Print performance comparison
        if use_cache:
            cached_count = sum(1 for item in results_data["results"] if item.get("cached"))
            print(f"\nCache performance: {cached_count}/{len(items)} items served from cache")


def main():
    parser = argparse.ArgumentParser(description="Test the batch processing API")
    parser.add_argument("--url", default="http://localhost:8000", help="API base URL")
    parser.add_argument("--parallel", type=int, default=3, help="Number of parallel requests")
    parser.add_argument("--no-cache", action="store_true", help="Disable caching")
    args = parser.parse_args()
    
    # Test URLs
    urls = [
        "https://viding.co/mini-rsvp/1179317",
        "https://viding.co/mini-rsvp/1179324",
        "https://viding.co/mini-rsvp/1179333",
        "https://viding.co/mini-rsvp/1179340",
        "https://viding.co/mini-rsvp/1220490",
        "https://viding.co/mini-rsvp/1179422",
        "https://viding.co/mini-rsvp/1176156",
        "https://viding.co/mini-rsvp/1176154",
        "https://viding.co/mini-rsvp/1176152",
        "https://viding.co/mini-rsvp/1176147"
    ]
    
    # Run the test
    asyncio.run(test_batch_processing(
        base_url=args.url,
        urls=urls,
        parallel=args.parallel,
        use_cache=not args.no_cache
    ))


if __name__ == "__main__":
    main()
