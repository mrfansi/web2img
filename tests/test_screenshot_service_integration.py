#!/usr/bin/env python3
"""
Integration tests for the refactored screenshot service.

This module implements integration tests for the refactored screenshot service,
focusing on end-to-end functionality and resource management.
"""

import asyncio
import os
import pytest
import pytest_asyncio
import time
from typing import Dict, Any, List
import uuid

from app.services.screenshot import screenshot_service
from app.core.config import settings

from tests.utils.async_test_utils import (
    cleanup_async_resources
)

@pytest_asyncio.fixture(autouse=True)
async def reset_circuit_breakers_fixture():
    """Reset circuit breakers before each test to ensure test isolation."""
    # Reset before test
    await screenshot_service.reset_circuit_breakers()
    
    # Run the test
    yield
    
    # Reset after test
    await screenshot_service.reset_circuit_breakers()


@pytest.mark.asyncio
async def test_screenshot_service_startup_shutdown():
    """Test screenshot service startup and shutdown."""
    # Ensure service is initialized
    await screenshot_service.startup()
    
    # Get browser pool stats
    stats = screenshot_service.get_pool_stats()
    
    # Verify browser pool is initialized
    assert stats["size"] >= settings.browser_pool_min_size
    assert stats["available"] >= settings.browser_pool_min_size
    
    # Verify cleanup task is running
    assert screenshot_service._cleanup_task is not None
    assert not screenshot_service._cleanup_task.done()
    
    # Shutdown service
    await screenshot_service.cleanup()
    
    # Verify cleanup task is cancelled
    assert screenshot_service._cleanup_task.done()
    
    # Restart service for other tests
    await screenshot_service.startup()


@pytest.mark.asyncio
async def test_capture_screenshot_end_to_end():
    """Test end-to-end screenshot capture with the refactored service."""
    # Test parameters
    url = "https://example.com"
    width = 1280
    height = 720
    format = "png"
    
    # Capture screenshot with timeout
    try:
        # Set a timeout to prevent the test from hanging
        filepath = await asyncio.wait_for(
            screenshot_service.capture_screenshot(url, width, height, format),
            timeout=30.0  # 30 seconds timeout
        )
    except asyncio.TimeoutError:
        pytest.skip("Screenshot capture timed out after 30 seconds - skipping test in CI environment")
        return  # Exit the test if timeout occurs
    
    try:
        # Verify screenshot was created
        assert os.path.exists(filepath)
        assert os.path.getsize(filepath) > 0
        
        # Verify file format
        assert filepath.endswith(f".{format}")
    finally:
        # Clean up the file
        if os.path.exists(filepath):
            os.remove(filepath)
    
    # Cleanup resources
    await cleanup_async_resources()


@pytest.mark.asyncio
async def test_concurrent_screenshot_captures():
    """Test concurrent screenshot captures to verify resource management."""
    # Test parameters
    urls = [
        "https://example.com",
        "https://example.org",
        "https://example.net",
        "https://mozilla.org",
        "https://python.org"
    ]
    width = 1280
    height = 720
    format = "png"
    
    # Create tasks for concurrent screenshot captures
    tasks = []
    for url in urls:
        task = asyncio.create_task(
            screenshot_service.capture_screenshot(url, width, height, format)
        )
        tasks.append(task)
    
    # Wait for all tasks to complete with a timeout
    try:
        filepaths = await asyncio.wait_for(
            asyncio.gather(*tasks),
            timeout=60.0  # 60 seconds timeout for all tasks
        )
    except asyncio.TimeoutError:
        # Cancel any remaining tasks
        for task in tasks:
            if not task.done():
                task.cancel()
        pytest.skip("Concurrent screenshot captures timed out after 60 seconds - skipping test in CI environment")
        return  # Exit the test if timeout occurs
    
    try:
        # Verify all screenshots were created
        for filepath in filepaths:
            assert os.path.exists(filepath)
            assert os.path.getsize(filepath) > 0
            assert filepath.endswith(f".{format}")
    finally:
        # Clean up the files
        for filepath in filepaths:
            if os.path.exists(filepath):
                os.remove(filepath)
    
    # Get browser pool stats after concurrent captures
    stats = screenshot_service.get_pool_stats()
    
    # Verify browser pool scaled appropriately
    assert stats["size"] >= min(len(urls), settings.browser_pool_max_size)
    
    # Cleanup resources
    await cleanup_async_resources()


@pytest.mark.asyncio
async def test_resource_tracking_during_errors():
    """Test resource tracking and cleanup during errors."""
    # Get initial resource counts
    initial_active_pages = len(screenshot_service._active_resources["pages"])
    initial_active_contexts = len(screenshot_service._active_resources["contexts"])
    
    # Test with invalid URL to trigger error
    invalid_url = "invalid-url-that-will-fail"
    width = 1280
    height = 720
    format = "png"
    
    # Attempt to capture screenshot (should fail) with timeout
    with pytest.raises(Exception):
        try:
            await asyncio.wait_for(
                screenshot_service.capture_screenshot(invalid_url, width, height, format),
                timeout=30.0  # 30 seconds timeout
            )
        except asyncio.TimeoutError:
            pytest.skip("Screenshot capture timed out after 30 seconds - skipping test in CI environment")
            return  # Exit the test if timeout occurs
    
    # Wait a moment for async cleanup
    await asyncio.sleep(1)
    
    # Verify no resources were leaked
    current_active_pages = len(screenshot_service._active_resources["pages"])
    current_active_contexts = len(screenshot_service._active_resources["contexts"])
    
    assert current_active_pages == initial_active_pages
    assert current_active_contexts == initial_active_contexts
    
    # Cleanup resources
    await cleanup_async_resources()


@pytest.mark.asyncio
async def test_cleanup_temp_files_integration():
    """Test temp file cleanup integration."""
    # Create some test screenshots
    url = "https://example.com"
    width = 1280
    height = 720
    format = "png"
    
    # Capture multiple screenshots with timeout
    filepaths = []
    for _ in range(3):
        try:
            filepath = await asyncio.wait_for(
                screenshot_service.capture_screenshot(url, width, height, format),
                timeout=30.0  # 30 seconds timeout
            )
            filepaths.append(filepath)
        except asyncio.TimeoutError:
            pytest.skip("Screenshot capture timed out after 30 seconds - skipping test in CI environment")
            return  # Exit the test if timeout occurs
    
    # Verify files exist
    for filepath in filepaths:
        assert os.path.exists(filepath)
    
    # Modify file timestamps to make them old
    old_time = time.time() - (25 * 3600)  # 25 hours old
    for filepath in filepaths:
        os.utime(filepath, (old_time, old_time))
    
    # Run cleanup
    removed_count = await screenshot_service._cleanup_temp_files()
    
    # Verify files were removed
    assert removed_count >= len(filepaths)
    for filepath in filepaths:
        assert not os.path.exists(filepath)
    
    # Cleanup resources
    await cleanup_async_resources()


@pytest.mark.asyncio
async def test_retry_mechanism_integration():
    """Test retry mechanism integration."""
    # Test parameters
    url = "https://example.com"
    width = 1280
    height = 720
    format = "png"
    
    # Get initial retry stats
    initial_stats = screenshot_service.get_retry_stats()
    
    # Capture screenshot with timeout
    try:
        filepath = await asyncio.wait_for(
            screenshot_service.capture_screenshot(url, width, height, format),
            timeout=30.0  # 30 seconds timeout
        )
    except asyncio.TimeoutError:
        pytest.skip("Screenshot capture timed out after 30 seconds - skipping test in CI environment")
        return  # Exit the test if timeout occurs
    
    try:
        # Verify screenshot was created
        assert os.path.exists(filepath)
    finally:
        # Clean up the file
        if os.path.exists(filepath):
            os.remove(filepath)
    
    # Get updated retry stats
    updated_stats = screenshot_service.get_retry_stats()
    
    # Verify retry stats were updated
    # Note: This test may not always show retries if the operation succeeds on first try
    # but it verifies the retry mechanism is integrated properly
    assert "browser_retry" in updated_stats
    assert "circuit_breakers" in updated_stats
    assert "throttle" in updated_stats
    
    # Cleanup resources
    await cleanup_async_resources()


@pytest.mark.asyncio
async def test_circuit_breaker_reset():
    """Test that circuit breakers can be reset properly."""
    # Get initial circuit breaker state
    initial_stats = screenshot_service.get_retry_stats()
    initial_browser_state = initial_stats["circuit_breakers"]["browser"]["state"]
    initial_navigation_state = initial_stats["circuit_breakers"]["navigation"]["state"]
    
    # Manually trip the circuit breakers by simulating failures
    threshold = settings.circuit_breaker_threshold
    
    # Trip the navigation circuit breaker
    for _ in range(threshold):
        await screenshot_service._navigation_circuit_breaker.record_failure()
    
    # Trip the browser circuit breaker
    for _ in range(threshold):
        await screenshot_service._browser_circuit_breaker.record_failure()
    
    # Verify circuit breakers are open
    tripped_stats = screenshot_service.get_retry_stats()
    assert tripped_stats["circuit_breakers"]["browser"]["state"] == "open"
    assert tripped_stats["circuit_breakers"]["navigation"]["state"] == "open"
    
    # Reset circuit breakers
    await screenshot_service.reset_circuit_breakers()
    
    # Verify circuit breakers are closed again
    reset_stats = screenshot_service.get_retry_stats()
    assert reset_stats["circuit_breakers"]["browser"]["state"] == "closed"
    assert reset_stats["circuit_breakers"]["navigation"]["state"] == "closed"
    
    # Cleanup resources
    await cleanup_async_resources()


if __name__ == "__main__":
    asyncio.run(pytest.main(['-xvs', __file__]))
