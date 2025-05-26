#!/usr/bin/env python3

import asyncio
import time
import os
import sys
from typing import Dict, Any

import httpx
import pytest
from fastapi.testclient import TestClient
from fastapi import FastAPI

# Add the app directory to the path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.main import app


@pytest.mark.asyncio
async def test_batch_job():
    """Test batch job creation, status, and results using AsyncClient."""
    print("\n=== Testing Batch Job Processing ===\n")
    
    # Use HTTPX AsyncClient with TestClient as a transport to properly handle FastAPI app
    test_client = TestClient(app)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Create batch job
        payload = {
            "items": [
                {
                    "url": "https://viding.co/mini-rsvp/1179317",
                    "width": 800,
                    "height": 600,
                    "format": "png",
                    "id": "test-1"
                },
                {
                    "url": "https://viding.co/mini-rsvp/1179324",
                    "width": 800,
                    "height": 600,
                    "format": "png",
                    "id": "test-2"
                }
            ],
            "config": {
                "parallel": 2,
                "timeout": 30,
                "fail_fast": False,
                "cache": True
            }
        }
        
        print("Creating batch job...")
        response = await client.post("/batch/screenshots", json=payload)
        assert response.status_code == 202, f"Expected status 202, got {response.status_code}: {response.text}"
        job_id = response.json().get("job_id")
        assert job_id, "Job ID not found in response"
        print(f"Created batch job with ID: {job_id}")
        
        # Wait for job to complete
        print("Waiting for job to complete...")
        completed = False
        max_wait_time = 60  # 60 seconds timeout
        start_time = time.time()
        while time.time() - start_time < max_wait_time:
            response = await client.get(f"/batch/screenshots/{job_id}")
            assert response.status_code == 200, f"Failed to get job status: {response.status_code}: {response.text}"
            
            status = response.json().get("status")
            completed_count = response.json().get("completed", 0)
            total_count = response.json().get("total", 0)
            print(f"Job status: {status}, Completed: {completed_count}/{total_count}")
            
            if status in ["completed", "completed_with_errors", "failed"]:
                completed = True
                break
                
            await asyncio.sleep(2)  # Check every 2 seconds
        
        assert completed, f"Batch job did not complete within {max_wait_time} seconds"
        print(f"Job completed with status: {status}")
        
        # Check job results
        print("\nChecking job results...")
        response = await client.get(f"/batch/screenshots/{job_id}/results")
        assert response.status_code == 200, f"Failed to get job results: {response.status_code}: {response.text}"
        
        results = response.json()
        print(f"Job ID: {results.get('job_id')}")
        print(f"Status: {results.get('status')}")
        print(f"Total items: {results.get('total')}")
        print(f"Succeeded: {results.get('succeeded')}")
        print(f"Failed: {results.get('failed')}")
        
        assert results.get("job_id") == job_id, "Job ID mismatch in results"
        assert results.get("status") in ["completed", "completed_with_errors", "failed"], f"Unexpected job status: {results.get('status')}"
        assert results.get("total") == 2, f"Expected 2 total items, got {results.get('total')}"
        assert results.get("succeeded") + results.get("failed") == 2, "Total items doesn't match succeeded + failed"
        
        # Print detailed information about failed items
        if results.get('failed', 0) > 0:
            print("\nFailed Items Details:")
            result_items = results.get('results', [])
            if not result_items:
                print("No result items found")
            
            for item in result_items:
                if item.get('status') == 'error':
                    print(f"  Item ID: {item.get('id')}")
                    print(f"  URL: {item.get('url') or 'Not available'}")
                    error = item.get('error', 'Unknown error')
                    print(f"  Error: {error}")


if __name__ == "__main__":
    # Run the async test directly
    asyncio.run(test_batch_job())
