#!/usr/bin/env python3
"""
Async tests for the screenshot service.

This module implements async tests for the screenshot service using the
async testing patterns defined in the async_test_utils module.
"""

import asyncio
import pytest
import time
from typing import Dict, Any

import httpx
from fastapi.testclient import TestClient
from app.main import app

from tests.utils.async_test_utils import (
    get_async_client,
    wait_for_condition,
    wait_for_response_condition,
    cleanup_async_resources,
    run_concurrent_requests
)


@pytest.mark.asyncio
async def test_screenshot_capture():
    """Test screenshot capture using AsyncClient."""
    async with await get_async_client() as client:
        # Test data
        payload = {
            "url": "https://example.com",
            "format": "png",
            "width": 1280,
            "height": 720
        }
        
        # Make the request
        response = await client.post("/screenshot", json=payload)
        
        # Assertions
        assert response.status_code == 200
        data = response.json()
        assert "url" in data
        assert data["url"].startswith("https://")
        
        # Cleanup any lingering resources
        await cleanup_async_resources()


@pytest.mark.asyncio
async def test_screenshot_with_options():
    """Test screenshot capture with various options using AsyncClient."""
    async with await get_async_client() as client:
        # Test data with additional options
        payload = {
            "url": "https://example.com",
            "format": "jpeg",
            "width": 800,
            "height": 600,
            "full_page": True,
            "quality": 80,
            "wait_for": "networkidle",
            "timeout": 30000
        }
        
        # Make the request
        response = await client.post("/screenshot", json=payload)
        
        # Assertions
        assert response.status_code == 200
        data = response.json()
        assert "url" in data
        assert data["url"].startswith("https://")
        assert "format:jpg" in data["url"] or "format:jpeg" in data["url"]
        
        # Cleanup any lingering resources
        await cleanup_async_resources()


@pytest.mark.asyncio
async def test_screenshot_with_cache():
    """Test screenshot caching using AsyncClient."""
    async with await get_async_client() as client:
        # Test data
        payload = {
            "url": "https://example.com",
            "format": "png",
            "width": 1280,
            "height": 720,
            "cache": True
        }
        
        # First request (no cache)
        start_time = time.time()
        response1 = await client.post("/screenshot", json=payload)
        first_request_time = time.time() - start_time
        
        # Second request (should use cache)
        start_time = time.time()
        response2 = await client.post("/screenshot", json=payload)
        second_request_time = time.time() - start_time
        
        # Assertions
        assert response1.status_code == 200
        assert response2.status_code == 200
        
        data1 = response1.json()
        data2 = response2.json()
        
        assert data1["url"] == data2["url"]
        assert second_request_time < first_request_time
        
        # Cleanup any lingering resources
        await cleanup_async_resources()


@pytest.mark.asyncio
async def test_concurrent_screenshots():
    """Test concurrent screenshot requests using AsyncClient."""
    async with await get_async_client() as client:
        # Define request function
        async def make_screenshot_request(client, i):
            payload = {
                "url": f"https://example.com?test={i}",
                "format": "png",
                "width": 1280,
                "height": 720
            }
            response = await client.post("/screenshot", json=payload)
            return response.status_code, response.json() if response.status_code == 200 else None
        
        # Run 5 concurrent requests
        results = await run_concurrent_requests(client, make_screenshot_request, 5, 3)
        
        # Assertions
        for status_code, data in results:
            assert status_code == 200
            assert data is not None
            assert "url" in data
            assert data["url"].startswith("https://")
        
        # Cleanup any lingering resources
        await cleanup_async_resources()


@pytest.mark.asyncio
async def test_screenshot_error_handling():
    """Test screenshot error handling using AsyncClient."""
    async with await get_async_client() as client:
        # Test with invalid URL
        payload = {
            "url": "invalid-url",
            "format": "png",
            "width": 1280,
            "height": 720
        }
        
        # Make the request
        response = await client.post("/screenshot", json=payload)
        
        # Assertions
        assert response.status_code == 400
        data = response.json()
        assert "error" in data
        
        # Cleanup any lingering resources
        await cleanup_async_resources()


if __name__ == "__main__":
    asyncio.run(pytest.main(['-xvs', __file__]))
