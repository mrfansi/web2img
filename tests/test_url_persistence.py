#!/usr/bin/env python3
"""
Focused test to reproduce the batch screenshot URL null bug.

This test specifically targets scenarios that might cause URLs to become null:
1. Extended monitoring over longer periods
2. Memory pressure scenarios
3. Cache invalidation scenarios
4. Multiple concurrent requests
"""

import asyncio
import json
import time
from typing import Dict, Any
import httpx
from datetime import datetime

BASE_URL = "http://localhost:8000"
TEST_URL = "https://example.com"

async def test_url_persistence():
    """Test URL persistence over an extended period with detailed monitoring."""
    print("🧪 Testing Batch Screenshot URL Persistence")
    print("="*60)
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        # Submit batch job
        payload = {
            "items": [
                {
                    "id": "persistence-test-1",
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
        
        print("📤 Submitting batch job...")
        response = await client.post(f"{BASE_URL}/batch/screenshots", json=payload)
        response.raise_for_status()
        job_data = response.json()
        job_id = job_data["job_id"]
        print(f"✓ Job submitted: {job_id}")
        
        # Wait for completion
        print("⏳ Waiting for job completion...")
        while True:
            try:
                response = await client.get(f"{BASE_URL}/batch/screenshots/{job_id}/results")
                if response.status_code == 200:
                    results = response.json()
                    print(f"✓ Job completed with status: {results['status']}")
                    break
                elif response.status_code == 202:
                    print("⏳ Still processing...")
                    await asyncio.sleep(2)
                else:
                    response.raise_for_status()
            except Exception as e:
                print(f"❌ Error checking job status: {e}")
                await asyncio.sleep(2)
        
        # Initial URL check
        initial_url = results["results"][0].get("url")
        print(f"✓ Initial URL: {initial_url[:100] if initial_url else 'NULL'}...")
        
        if not initial_url:
            print("❌ CRITICAL: URL is already null after job completion!")
            return
        
        # Extended monitoring
        print(f"\n🔍 Starting extended monitoring for 10 minutes...")
        print("Checking every 30 seconds for URL persistence...")
        
        start_time = time.time()
        check_count = 0
        null_detections = []
        
        # Monitor for 10 minutes
        while time.time() - start_time < 600:  # 10 minutes
            check_count += 1
            elapsed = int(time.time() - start_time)
            
            try:
                response = await client.get(f"{BASE_URL}/batch/screenshots/{job_id}/results")
                response.raise_for_status()
                current_results = response.json()
                
                current_url = current_results["results"][0].get("url")
                
                if current_url is None:
                    null_detections.append({
                        "check_number": check_count,
                        "elapsed_seconds": elapsed,
                        "timestamp": datetime.now().isoformat(),
                        "full_item": current_results["results"][0]
                    })
                    print(f"❌ Check {check_count} ({elapsed}s): URL is NULL!")
                else:
                    url_changed = current_url != initial_url
                    change_indicator = " (CHANGED)" if url_changed else ""
                    print(f"✓ Check {check_count} ({elapsed}s): URL present{change_indicator}")
                    
                    if url_changed:
                        print(f"  Old: {initial_url[:50]}...")
                        print(f"  New: {current_url[:50]}...")
                
                await asyncio.sleep(30)  # Check every 30 seconds
                
            except Exception as e:
                print(f"❌ Check {check_count} failed: {e}")
                await asyncio.sleep(30)
        
        # Final analysis
        print(f"\n📊 FINAL ANALYSIS")
        print("="*60)
        print(f"Total monitoring time: 10 minutes")
        print(f"Total checks performed: {check_count}")
        print(f"NULL URL detections: {len(null_detections)}")
        
        if null_detections:
            print("❌ BUG CONFIRMED: URL became null during monitoring!")
            print("\nNull detection details:")
            for detection in null_detections:
                print(f"  - Check {detection['check_number']} at {detection['elapsed_seconds']}s")
        else:
            print("✅ No bug detected: URL remained persistent throughout monitoring")
        
        # Save results
        test_results = {
            "job_id": job_id,
            "initial_url": initial_url,
            "monitoring_duration_seconds": 600,
            "total_checks": check_count,
            "null_detections": null_detections,
            "test_timestamp": datetime.now().isoformat()
        }
        
        with open("url_persistence_test_results.json", "w") as f:
            json.dump(test_results, f, indent=2)
        
        print(f"\n💾 Results saved to: url_persistence_test_results.json")

async def test_concurrent_load():
    """Test URL persistence under concurrent load."""
    print("\n" + "="*60)
    print("🧪 Testing URL Persistence Under Concurrent Load")
    print("="*60)
    
    async with httpx.AsyncClient(timeout=60.0) as client:
        # Submit multiple jobs concurrently
        job_ids = []
        tasks = []
        
        for i in range(5):
            payload = {
                "items": [
                    {
                        "id": f"load-test-{i}",
                        "url": f"https://httpbin.org/delay/{i % 3}",  # Variable delay
                        "width": 1280,
                        "height": 720,
                        "format": "png"
                    }
                ],
                "config": {
                    "parallel": 1,
                    "timeout": 30,
                    "cache": False  # Disable cache to force processing
                }
            }
            
            task = client.post(f"{BASE_URL}/batch/screenshots", json=payload)
            tasks.append(task)
        
        print("📤 Submitting 5 concurrent batch jobs...")
        responses = await asyncio.gather(*tasks, return_exceptions=True)
        
        for i, response in enumerate(responses):
            if isinstance(response, Exception):
                print(f"❌ Job {i} failed: {response}")
            else:
                try:
                    response.raise_for_status()
                    job_data = response.json()
                    job_ids.append(job_data["job_id"])
                    print(f"✓ Job {i} submitted: {job_data['job_id']}")
                except Exception as e:
                    print(f"❌ Job {i} error: {e}")
        
        if not job_ids:
            print("❌ No jobs submitted successfully")
            return
        
        # Wait for all jobs to complete
        print(f"\n⏳ Waiting for {len(job_ids)} jobs to complete...")
        completed_jobs = []
        
        for job_id in job_ids:
            while True:
                try:
                    response = await client.get(f"{BASE_URL}/batch/screenshots/{job_id}/results")
                    if response.status_code == 200:
                        results = response.json()
                        completed_jobs.append((job_id, results))
                        print(f"✓ Job {job_id} completed")
                        break
                    elif response.status_code == 202:
                        await asyncio.sleep(1)
                    else:
                        response.raise_for_status()
                except Exception as e:
                    print(f"❌ Error with job {job_id}: {e}")
                    break
        
        # Monitor all completed jobs for URL persistence
        print(f"\n🔍 Monitoring {len(completed_jobs)} jobs for URL persistence...")
        
        for job_id, initial_results in completed_jobs:
            initial_url = initial_results["results"][0].get("url")
            print(f"Job {job_id}: Initial URL {'present' if initial_url else 'NULL'}")
            
            # Check again after a delay
            await asyncio.sleep(10)
            
            try:
                response = await client.get(f"{BASE_URL}/batch/screenshots/{job_id}/results")
                response.raise_for_status()
                current_results = response.json()
                current_url = current_results["results"][0].get("url")
                
                if initial_url and not current_url:
                    print(f"❌ Job {job_id}: URL became NULL!")
                elif not initial_url and current_url:
                    print(f"✓ Job {job_id}: URL appeared!")
                elif initial_url != current_url:
                    print(f"⚠️  Job {job_id}: URL changed!")
                else:
                    print(f"✓ Job {job_id}: URL persistent")
                    
            except Exception as e:
                print(f"❌ Error checking job {job_id}: {e}")

async def main():
    """Run all URL persistence tests."""
    try:
        await test_url_persistence()
        await test_concurrent_load()
    except Exception as e:
        print(f"❌ Test suite failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
