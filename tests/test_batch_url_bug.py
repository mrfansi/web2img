#!/usr/bin/env python3
"""
Test script to reproduce the batch screenshot URL null bug.

This script will:
1. Submit a batch screenshot job
2. Poll the results endpoint multiple times
3. Check if the URL becomes null after initial success
"""

import asyncio
import json
import time
from typing import Dict, Any
import httpx

# Configuration
BASE_URL = "http://localhost:8000"
TEST_URL = "https://example.com"

async def submit_batch_job() -> str:
    """Submit a batch screenshot job and return the job ID."""
    async with httpx.AsyncClient() as client:
        payload = {
            "items": [
                {
                    "id": "test-item-1",
                    "url": TEST_URL,
                    "width": 1280,
                    "height": 720,
                    "format": "png"
                }
            ],
            "config": {
                "parallel": 1,
                "timeout": 30,
                "cache": True
            }
        }
        
        response = await client.post(f"{BASE_URL}/batch/screenshots", json=payload)
        response.raise_for_status()
        
        result = response.json()
        job_id = result["job_id"]
        print(f"✓ Submitted batch job: {job_id}")
        return job_id

async def get_job_results(job_id: str) -> Dict[str, Any]:
    """Get the results for a batch job."""
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{BASE_URL}/batch/screenshots/{job_id}/results")
        
        if response.status_code == 202:
            # Still processing
            return {"status": "processing"}
        
        response.raise_for_status()
        return response.json()

async def wait_for_completion(job_id: str, max_wait: int = 60) -> Dict[str, Any]:
    """Wait for job completion and return final results."""
    start_time = time.time()
    
    while time.time() - start_time < max_wait:
        results = await get_job_results(job_id)
        
        if results.get("status") != "processing":
            return results
        
        print(f"⏳ Job still processing... (elapsed: {int(time.time() - start_time)}s)")
        await asyncio.sleep(2)
    
    raise TimeoutError(f"Job did not complete within {max_wait} seconds")

async def test_url_persistence(job_id: str, num_checks: int = 10, interval: int = 3):
    """Test if URL persists across multiple result requests."""
    print(f"\n🔍 Testing URL persistence with {num_checks} checks every {interval}s...")
    
    url_history = []
    
    for i in range(num_checks):
        try:
            results = await get_job_results(job_id)
            
            # Extract URL from first result item
            items = results.get("results", [])
            if items:
                url = items[0].get("url")
                url_history.append({
                    "check": i + 1,
                    "timestamp": time.time(),
                    "url": url,
                    "url_present": url is not None
                })
                
                status = "✓ Present" if url else "✗ NULL"
                print(f"Check {i+1:2d}: URL {status}")
                
                if url:
                    # Show first 60 characters of URL for verification
                    url_preview = url[:60] + "..." if len(url) > 60 else url
                    print(f"         URL: {url_preview}")
            else:
                print(f"Check {i+1:2d}: No results found")
                
        except Exception as e:
            print(f"Check {i+1:2d}: Error - {e}")
            
        if i < num_checks - 1:  # Don't sleep after last check
            await asyncio.sleep(interval)
    
    return url_history

def analyze_url_history(url_history):
    """Analyze the URL history to identify patterns."""
    print(f"\n📊 Analysis:")
    print(f"Total checks: {len(url_history)}")
    
    present_count = sum(1 for h in url_history if h["url_present"])
    null_count = len(url_history) - present_count
    
    print(f"URL present: {present_count}")
    print(f"URL null: {null_count}")
    
    if null_count > 0:
        # Find when URL first became null
        first_null = next((h for h in url_history if not h["url_present"]), None)
        if first_null:
            print(f"URL first became null at check {first_null['check']}")
            
        # Check if URL was ever present
        was_present = any(h["url_present"] for h in url_history)
        if was_present:
            print("🐛 BUG CONFIRMED: URL was present but became null!")
        else:
            print("⚠️  URL was never present (different issue)")
    else:
        print("✅ No bug detected: URL remained present throughout all checks")

async def main():
    """Main test function."""
    print("🧪 Testing Batch Screenshot URL Persistence Bug")
    print("=" * 50)
    
    try:
        # Step 1: Submit batch job
        job_id = await submit_batch_job()
        
        # Step 2: Wait for completion
        print(f"\n⏳ Waiting for job completion...")
        results = await wait_for_completion(job_id)
        
        print(f"✓ Job completed with status: {results.get('status')}")
        
        # Check if we have results
        items = results.get("results", [])
        if not items:
            print("❌ No results found in completed job")
            return
            
        initial_url = items[0].get("url")
        if initial_url:
            print(f"✓ Initial URL present: {initial_url[:60]}...")
        else:
            print("❌ No URL in initial results")
            return
        
        # Step 3: Test URL persistence
        url_history = await test_url_persistence(job_id)
        
        # Step 4: Analyze results
        analyze_url_history(url_history)
        
        # Step 5: Save detailed results
        with open("batch_url_test_results.json", "w") as f:
            json.dump({
                "job_id": job_id,
                "initial_results": results,
                "url_history": url_history,
                "test_timestamp": time.time()
            }, f, indent=2)
        
        print(f"\n💾 Detailed results saved to: batch_url_test_results.json")
        
    except Exception as e:
        print(f"❌ Test failed: {e}")
        raise

if __name__ == "__main__":
    asyncio.run(main())
