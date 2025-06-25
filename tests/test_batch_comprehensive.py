#!/usr/bin/env python3
"""
Comprehensive test script to reproduce the batch screenshot URL null bug.

This script will test various scenarios that might trigger the bug:
1. Multiple batch jobs in quick succession
2. Longer time periods (up to 5 minutes)
3. Different URL types and configurations
4. High load scenarios with multiple concurrent requests
"""

import asyncio
import json
import time
from typing import Dict, Any, List
import httpx
from datetime import datetime

# Configuration
BASE_URL = "http://localhost:8000"
TEST_URLS = [
    "https://example.com",
    "https://httpbin.org/html",
    "https://jsonplaceholder.typicode.com",
    "https://httpstat.us/200"
]

class BatchURLTester:
    def __init__(self):
        self.results = []
        self.client = None
    
    async def __aenter__(self):
        self.client = httpx.AsyncClient(timeout=60.0)
        return self
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.client:
            await self.client.aclose()
    
    async def submit_batch_job(self, urls: List[str], job_name: str) -> str:
        """Submit a batch screenshot job and return the job ID."""
        payload = {
            "items": [
                {
                    "id": f"{job_name}-item-{i}",
                    "url": url,
                    "width": 1280,
                    "height": 720,
                    "format": "png"
                }
                for i, url in enumerate(urls)
            ],
            "config": {
                "parallel": min(len(urls), 3),
                "timeout": 30,
                "cache": True
            }
        }
        
        response = await self.client.post(f"{BASE_URL}/batch/screenshots", json=payload)
        response.raise_for_status()
        result = response.json()
        return result["job_id"]
    
    async def get_job_results(self, job_id: str) -> Dict[str, Any]:
        """Get the results of a batch job."""
        response = await self.client.get(f"{BASE_URL}/batch/screenshots/{job_id}/results")
        response.raise_for_status()
        return response.json()
    
    async def wait_for_completion(self, job_id: str, timeout: int = 120) -> Dict[str, Any]:
        """Wait for a job to complete and return the results."""
        start_time = time.time()
        
        while time.time() - start_time < timeout:
            try:
                response = await self.client.get(f"{BASE_URL}/batch/screenshots/{job_id}/results")
                response.raise_for_status()
                results = response.json()
                if results["status"] in ["completed", "failed"]:
                    return results
                await asyncio.sleep(2)
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 202:  # Still processing
                    await asyncio.sleep(2)
                    continue
                raise
        
        raise TimeoutError(f"Job {job_id} did not complete within {timeout} seconds")
    
    async def monitor_url_persistence(self, job_id: str, duration_minutes: int = 5, check_interval: int = 10):
        """Monitor URL persistence over a longer period."""
        print(f"\n🔍 Monitoring job {job_id} for {duration_minutes} minutes...")
        
        start_time = time.time()
        end_time = start_time + (duration_minutes * 60)
        check_count = 0
        null_count = 0
        
        while time.time() < end_time:
            check_count += 1
            elapsed = int(time.time() - start_time)
            
            try:
                results = await self.get_job_results(job_id)
                
                # Check each item's URL
                for item in results.get("results", []):
                    item_id = item.get("id", "unknown")
                    url = item.get("url")
                    
                    if url is None:
                        null_count += 1
                        print(f"❌ Check {check_count} ({elapsed}s): Item {item_id} URL is NULL!")
                        
                        # Record the null occurrence
                        self.results.append({
                            "timestamp": datetime.now().isoformat(),
                            "job_id": job_id,
                            "item_id": item_id,
                            "check_number": check_count,
                            "elapsed_seconds": elapsed,
                            "url_status": "null",
                            "item_status": item.get("status"),
                            "full_item": item
                        })
                    else:
                        print(f"✓ Check {check_count} ({elapsed}s): Item {item_id} URL present")
                        
                        # Record the successful check
                        self.results.append({
                            "timestamp": datetime.now().isoformat(),
                            "job_id": job_id,
                            "item_id": item_id,
                            "check_number": check_count,
                            "elapsed_seconds": elapsed,
                            "url_status": "present",
                            "url_length": len(url),
                            "item_status": item.get("status")
                        })
                
                await asyncio.sleep(check_interval)
                
            except Exception as e:
                print(f"❌ Check {check_count} failed: {e}")
                await asyncio.sleep(check_interval)
        
        return {
            "total_checks": check_count,
            "null_occurrences": null_count,
            "monitoring_duration": duration_minutes
        }
    
    async def test_scenario_1_basic_persistence(self):
        """Test 1: Basic URL persistence over 5 minutes."""
        print("\n" + "="*60)
        print("🧪 TEST 1: Basic URL Persistence (5 minutes)")
        print("="*60)
        
        job_id = await self.submit_batch_job([TEST_URLS[0]], "basic-test")
        print(f"✓ Submitted job: {job_id}")
        
        # Wait for completion
        results = await self.wait_for_completion(job_id)
        print(f"✓ Job completed with status: {results['status']}")
        
        # Monitor for 5 minutes
        stats = await self.monitor_url_persistence(job_id, duration_minutes=5, check_interval=15)
        
        return {
            "test": "basic_persistence",
            "job_id": job_id,
            "stats": stats
        }
    
    async def test_scenario_2_multiple_jobs(self):
        """Test 2: Multiple jobs in quick succession."""
        print("\n" + "="*60)
        print("🧪 TEST 2: Multiple Jobs in Quick Succession")
        print("="*60)
        
        job_ids = []
        
        # Submit 3 jobs quickly
        for i in range(3):
            job_id = await self.submit_batch_job([TEST_URLS[i % len(TEST_URLS)]], f"multi-job-{i}")
            job_ids.append(job_id)
            print(f"✓ Submitted job {i+1}: {job_id}")
            await asyncio.sleep(1)  # Small delay
        
        # Wait for all to complete
        completed_jobs = []
        for job_id in job_ids:
            results = await self.wait_for_completion(job_id)
            completed_jobs.append(job_id)
            print(f"✓ Job {job_id} completed")
        
        # Monitor all jobs for 3 minutes
        monitoring_tasks = []
        for job_id in completed_jobs:
            task = asyncio.create_task(
                self.monitor_url_persistence(job_id, duration_minutes=3, check_interval=10)
            )
            monitoring_tasks.append(task)
        
        stats_list = await asyncio.gather(*monitoring_tasks)
        
        return {
            "test": "multiple_jobs",
            "job_ids": job_ids,
            "stats": stats_list
        }
    
    async def test_scenario_3_high_load(self):
        """Test 3: High load scenario with multiple URLs per job."""
        print("\n" + "="*60)
        print("🧪 TEST 3: High Load Scenario")
        print("="*60)
        
        # Submit a job with multiple URLs
        job_id = await self.submit_batch_job(TEST_URLS, "high-load-test")
        print(f"✓ Submitted high-load job: {job_id}")
        
        # Wait for completion
        results = await self.wait_for_completion(job_id, timeout=180)
        print(f"✓ Job completed with status: {results['status']}")
        
        # Monitor for 3 minutes with more frequent checks
        stats = await self.monitor_url_persistence(job_id, duration_minutes=3, check_interval=5)
        
        return {
            "test": "high_load",
            "job_id": job_id,
            "stats": stats
        }

async def main():
    print("🧪 Comprehensive Batch Screenshot URL Persistence Test")
    print("="*60)
    
    async with BatchURLTester() as tester:
        test_results = []
        
        try:
            # Run all test scenarios
            result1 = await tester.test_scenario_1_basic_persistence()
            test_results.append(result1)
            
            result2 = await tester.test_scenario_2_multiple_jobs()
            test_results.append(result2)
            
            result3 = await tester.test_scenario_3_high_load()
            test_results.append(result3)
            
        except Exception as e:
            print(f"❌ Test failed: {e}")
            import traceback
            traceback.print_exc()
        
        # Analyze results
        print("\n" + "="*60)
        print("📊 COMPREHENSIVE TEST ANALYSIS")
        print("="*60)
        
        total_null_occurrences = 0
        for result in test_results:
            if isinstance(result.get("stats"), list):
                for stat in result["stats"]:
                    total_null_occurrences += stat.get("null_occurrences", 0)
            else:
                total_null_occurrences += result.get("stats", {}).get("null_occurrences", 0)
        
        print(f"Total test scenarios: {len(test_results)}")
        print(f"Total NULL URL occurrences: {total_null_occurrences}")
        
        if total_null_occurrences > 0:
            print("❌ BUG DETECTED: URL became null during testing!")
        else:
            print("✅ No bug detected: URLs remained persistent across all tests")
        
        # Save detailed results
        detailed_results = {
            "test_summary": {
                "total_scenarios": len(test_results),
                "total_null_occurrences": total_null_occurrences,
                "test_timestamp": datetime.now().isoformat()
            },
            "test_results": test_results,
            "detailed_checks": tester.results
        }
        
        with open("comprehensive_batch_test_results.json", "w") as f:
            json.dump(detailed_results, f, indent=2)
        
        print(f"\n💾 Detailed results saved to: comprehensive_batch_test_results.json")

if __name__ == "__main__":
    asyncio.run(main())
