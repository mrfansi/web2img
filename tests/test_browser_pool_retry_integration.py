#!/usr/bin/env python3

import asyncio
import sys
import os
import time
import random
from pathlib import Path
from typing import List, Dict, Any, Optional, Tuple
import argparse

# Add the parent directory to the path so we can import app modules
sys.path.append(str(Path(__file__).parent.parent))

from app.services.browser_pool import BrowserPool
from app.services.retry import RetryConfig, CircuitBreaker, RetryManager
from app.services.screenshot import ScreenshotService
from app.core.config import settings
from app.core.logging import get_logger


# Initialize logger
logger = get_logger("test_browser_pool_retry_integration")


async def test_retry_with_browser_pool_exhaustion():
    """Test retry behavior when browser pool is exhausted."""
    print("\n=== Testing Retry with Browser Pool Exhaustion ===\n")
    
    # Create a small browser pool for testing
    pool = BrowserPool(min_size=1, max_size=2)
    await pool.initialize()
    
    # Create retry configuration
    retry_config = RetryConfig(
        max_retries=3,
        base_delay=0.5,
        max_delay=2.0,
        jitter=0.1
    )
    
    # Create retry manager
    retry_manager = RetryManager(
        retry_config=retry_config,
        name="test_browser_pool_exhaustion"
    )
    
    # Get all browsers to exhaust the pool
    print("Exhausting the browser pool...")
    browsers = []
    indices = []
    for i in range(pool._max_size):
        browser, browser_index = await pool.get_browser()
        if browser is not None and browser_index is not None:
            browsers.append(browser)
            indices.append(browser_index)
            print(f"  Got browser {browser_index}")
    
    # Verify pool is exhausted
    stats = pool.get_stats()
    print(f"Pool stats after exhaustion: {stats}")
    assert stats["available"] == 0, "Pool should be exhausted"
    
    # Operation that tries to get a browser from the exhausted pool
    async def get_browser_operation():
        print("  Attempting to get browser from exhausted pool...")
        browser, browser_index = await pool.get_browser()
        if browser is None or browser_index is None:
            raise RuntimeError("Failed to get browser from pool")
        
        print(f"  Got browser {browser_index}")
        await pool.release_browser(browser_index)
        return browser_index
    
    # Execute with retry (should fail after retries)
    print("\nExecuting operation with retry on exhausted pool...")
    try:
        start_time = time.time()
        result = await retry_manager.execute(get_browser_operation)
        elapsed = time.time() - start_time
        print(f"  Result: {result} (after {elapsed:.2f} seconds)")
        print(f"  Retry stats: {retry_manager.get_stats()}")
        success = True
    except Exception as e:
        elapsed = time.time() - start_time
        print(f"  Error: {e} (after {elapsed:.2f} seconds)")
        print(f"  Retry stats: {retry_manager.get_stats()}")
        success = False
    
    # Release browsers to unblock the pool
    print("\nReleasing browsers to unblock the pool...")
    for browser_index in indices:
        await pool.release_browser(browser_index)
        print(f"  Released browser {browser_index}")
    
    # Try again after unblocking
    print("\nExecuting operation with retry after unblocking pool...")
    try:
        start_time = time.time()
        result = await retry_manager.execute(get_browser_operation)
        elapsed = time.time() - start_time
        print(f"  Result: {result} (after {elapsed:.2f} seconds)")
        print(f"  Retry stats: {retry_manager.get_stats()}")
        success = True
    except Exception as e:
        print(f"  Error: {e}")
        success = False
    
    # Clean up
    await pool.shutdown()
    
    return success


async def test_screenshot_service_with_browser_errors():
    """Test screenshot service handling of browser errors with retry."""
    print("\n=== Testing Screenshot Service with Browser Errors ===\n")
    
    # Create screenshot service
    screenshot_service = ScreenshotService()
    await screenshot_service.startup()
    
    # Get initial retry and pool stats
    retry_stats = screenshot_service.get_retry_stats()
    pool_stats = screenshot_service.get_pool_stats()
    print("Initial stats:")
    print(f"  Retry stats: {retry_stats}")
    print(f"  Pool stats: {pool_stats}")
    
    # Test 1: Capture screenshot with simulated browser error
    print("\nTest 1: Capture screenshot with simulated browser error")
    
    # Patch the _get_context method to simulate errors
    original_get_context = screenshot_service._get_context
    error_count = 0
    
    async def mock_get_context(*args, **kwargs):
        nonlocal error_count
        if error_count < 2:  # Fail twice then succeed
            error_count += 1
            print(f"  Simulating browser context error (attempt {error_count})")
            raise RuntimeError("Simulated browser context error")
        return await original_get_context(*args, **kwargs)
    
    # Apply the patch
    screenshot_service._get_context = mock_get_context
    
    # Capture screenshot (should retry and eventually succeed)
    try:
        start_time = time.time()
        filepath = await screenshot_service.capture_screenshot(
            url="https://example.com",
            width=800,
            height=600,
            format="png"
        )
        elapsed = time.time() - start_time
        print(f"  Screenshot captured: {filepath} (after {elapsed:.2f} seconds)")
        success = True
        
        # Clean up the file
        if os.path.exists(filepath):
            os.unlink(filepath)
            print(f"  Removed temporary file: {filepath}")
    except Exception as e:
        elapsed = time.time() - start_time
        print(f"  Screenshot failed: {e} (after {elapsed:.2f} seconds)")
        success = False
    
    # Restore the original method
    screenshot_service._get_context = original_get_context
    
    # Get updated stats
    retry_stats = screenshot_service.get_retry_stats()
    pool_stats = screenshot_service.get_pool_stats()
    print("Updated stats:")
    print(f"  Retry stats: {retry_stats}")
    print(f"  Pool stats: {pool_stats}")
    
    # Clean up
    await screenshot_service.cleanup()
    
    return success


async def test_concurrent_screenshot_with_retry():
    """Test concurrent screenshot capture with retry system."""
    print("\n=== Testing Concurrent Screenshot Capture with Retry ===\n")
    
    # Create screenshot service
    screenshot_service = ScreenshotService()
    await screenshot_service.startup()
    
    # Test parameters
    num_concurrent = 3
    test_urls = [
        "https://example.com",
        "https://google.com",
        "https://github.com"
    ]
    
    # Results tracking
    results = {
        "success": 0,
        "failure": 0,
        "retry_used": 0,
        "times": []
    }
    
    async def capture_with_stats(url: str):
        """Capture a screenshot and track statistics."""
        try:
            start_time = time.time()
            filepath = await screenshot_service.capture_screenshot(
                url=url,
                width=800,
                height=600,
                format="png"
            )
            elapsed = time.time() - start_time
            results["times"].append(elapsed)
            results["success"] += 1
            print(f"  Screenshot of {url} captured: {filepath} (took {elapsed:.2f}s)")
            
            # Check if retry was used
            retry_stats = screenshot_service.get_retry_stats()
            if retry_stats["browser_retry"] > 0 or retry_stats["navigation_retry"] > 0:
                results["retry_used"] += 1
            
            # Clean up the file
            if os.path.exists(filepath):
                os.unlink(filepath)
        except Exception as e:
            elapsed = time.time() - start_time
            results["failure"] += 1
            print(f"  Screenshot of {url} failed: {e} (after {elapsed:.2f}s)")
    
    # Create tasks for concurrent execution
    print(f"Capturing {num_concurrent} screenshots concurrently...")
    tasks = []
    for url in test_urls[:num_concurrent]:
        task = asyncio.create_task(capture_with_stats(url))
        tasks.append(task)
    
    # Wait for all tasks to complete
    await asyncio.gather(*tasks)
    
    # Calculate and print results
    success_rate = results["success"] / (results["success"] + results["failure"]) * 100 if results["success"] + results["failure"] > 0 else 0
    retry_rate = results["retry_used"] / results["success"] * 100 if results["success"] > 0 else 0
    avg_time = sum(results["times"]) / len(results["times"]) if results["times"] else 0
    
    print("\nResults:")
    print(f"  Success: {results['success']}/{num_concurrent} ({success_rate:.1f}%)")
    print(f"  Retry used: {results['retry_used']}/{results['success']} ({retry_rate:.1f}%)")
    print(f"  Average time: {avg_time:.2f}s")
    
    # Get stats
    retry_stats = screenshot_service.get_retry_stats()
    pool_stats = screenshot_service.get_pool_stats()
    print("\nFinal stats:")
    print(f"  Retry stats: {retry_stats}")
    print(f"  Pool stats: {pool_stats}")
    
    # Clean up
    await screenshot_service.cleanup()
    
    return results["success"] > 0


async def test_circuit_breaker_with_browser_pool():
    """Test circuit breaker integration with browser pool."""
    print("\n=== Testing Circuit Breaker with Browser Pool ===\n")
    
    # Create browser pool
    pool = BrowserPool(min_size=1, max_size=2)
    await pool.initialize()
    
    # Create circuit breaker with low threshold for testing
    circuit_breaker = CircuitBreaker(
        threshold=3,  # Open after 3 failures
        reset_time=2  # Reset after 2 seconds
    )
    
    # Create retry configuration
    retry_config = RetryConfig(
        max_retries=2,
        base_delay=0.2,
        max_delay=1.0,
        jitter=0.1
    )
    
    # Create retry manager with circuit breaker
    retry_manager = RetryManager(
        retry_config=retry_config,
        circuit_breaker=circuit_breaker,
        name="test_circuit_breaker_with_browser_pool"
    )
    
    # Operation that simulates browser errors
    async def browser_operation():
        # Get a browser
        browser, browser_index = await pool.get_browser()
        if browser is None or browser_index is None:
            raise RuntimeError("Failed to get browser from pool")
        
        try:
            # Simulate an error
            raise RuntimeError("Simulated browser error")
        finally:
            # Always release the browser
            await pool.release_browser(browser_index)
    
    # Phase 1: Trigger circuit breaker with failing operations
    print("Phase 1: Triggering circuit breaker with failures...")
    for i in range(5):
        try:
            await retry_manager.execute(browser_operation)
            print(f"  Operation {i+1}: Unexpected success")
        except Exception as e:
            print(f"  Operation {i+1}: Expected failure - {circuit_breaker.get_state()['state']}")
    
    # Check circuit breaker state
    print(f"Circuit breaker state: {circuit_breaker.get_state()['state']}")
    assert circuit_breaker.get_state()['state'] == "open", "Circuit breaker should be open"
    
    # Phase 2: Verify operations are blocked by circuit breaker
    print("\nPhase 2: Verifying operations are blocked by circuit breaker...")
    try:
        start_time = time.time()
        await retry_manager.execute(browser_operation)
        print("  Error: Operation succeeded when it should be blocked")
        success = False
    except Exception as e:
        elapsed = time.time() - start_time
        print(f"  Expected error: {e} (after {elapsed:.2f}s)")
        success = "circuit breaker is open" in str(e).lower()
    
    # Phase 3: Wait for circuit breaker reset
    print("\nPhase 3: Waiting for circuit breaker reset...")
    print("  Waiting 2.5 seconds for reset...")
    await asyncio.sleep(2.5)  # Wait for reset_time + buffer
    
    # Check circuit breaker state after reset
    print(f"  Circuit breaker state after wait: {circuit_breaker.get_state()['state']}")
    
    # Phase 4: Create a successful operation
    async def successful_operation():
        # Get a browser
        browser, browser_index = await pool.get_browser()
        if browser is None or browser_index is None:
            raise RuntimeError("Failed to get browser from pool")
        
        try:
            # Simulate successful operation
            return "success"
        finally:
            # Always release the browser
            await pool.release_browser(browser_index)
    
    # Try successful operation after reset
    print("\nPhase 4: Trying successful operation after reset...")
    try:
        result = await retry_manager.execute(successful_operation)
        print(f"  Result: {result}")
        print(f"  Circuit breaker state: {circuit_breaker.get_state()['state']}")
        success = True
    except Exception as e:
        print(f"  Error: {e}")
        success = False
    
    # Clean up
    await pool.shutdown()
    
    return success


async def test_browser_pool_recovery_after_errors():
    """Test browser pool recovery after browser errors."""
    print("\n=== Testing Browser Pool Recovery After Errors ===\n")
    
    # Create browser pool
    pool = BrowserPool(min_size=2, max_size=3)
    await pool.initialize()
    
    # Get initial stats
    initial_stats = pool.get_stats()
    print(f"Initial pool stats: {initial_stats}")
    
    # Test 1: Get a browser and simulate an error
    print("\nTest 1: Simulate browser error")
    browser, browser_index = await pool.get_browser()
    print(f"  Got browser {browser_index}")
    
    # Release as unhealthy (simulating an error)
    print("  Releasing browser as unhealthy")
    await pool.release_browser(browser_index, is_healthy=False)
    
    # Check stats after unhealthy release
    stats_after_error = pool.get_stats()
    print(f"Stats after error: {stats_after_error}")
    assert stats_after_error["recycled"] > initial_stats["recycled"], "Browser should be recycled after error"
    
    # Test 2: Verify pool recovers by creating new browsers
    print("\nTest 2: Verify pool recovery")
    
    # Get browsers until we reach max_size
    browsers = []
    indices = []
    for i in range(pool._max_size):
        browser, browser_index = await pool.get_browser()
        if browser is not None and browser_index is not None:
            browsers.append(browser)
            indices.append(browser_index)
            print(f"  Got browser {browser_index}")
    
    # Check stats after getting all browsers
    stats_after_recovery = pool.get_stats()
    print(f"Stats after recovery: {stats_after_recovery}")
    assert stats_after_recovery["size"] >= initial_stats["size"], "Pool should recover by creating new browsers"
    
    # Release all browsers
    for browser_index in indices:
        await pool.release_browser(browser_index)
    
    # Clean up
    await pool.shutdown()
    
    return True


async def main():
    """Run all tests."""
    parser = argparse.ArgumentParser(description="Test browser pool retry integration")
    parser.add_argument("--test", type=str, help="Run a specific test")
    args = parser.parse_args()
    
    print("Starting browser pool retry integration tests...")
    
    # Define all tests
    all_tests = {
        "exhaustion": ("Retry with Browser Pool Exhaustion", test_retry_with_browser_pool_exhaustion),
        "browser_errors": ("Screenshot Service with Browser Errors", test_screenshot_service_with_browser_errors),
        "concurrent": ("Concurrent Screenshot with Retry", test_concurrent_screenshot_with_retry),
        "circuit_breaker": ("Circuit Breaker with Browser Pool", test_circuit_breaker_with_browser_pool),
        "recovery": ("Browser Pool Recovery After Errors", test_browser_pool_recovery_after_errors)
    }
    
    # Run tests
    if args.test and args.test in all_tests:
        # Run a specific test
        tests = [all_tests[args.test]]
    else:
        # Run all tests
        tests = list(all_tests.values())
    
    # Execute tests and collect results
    results = []
    for name, test_func in tests:
        print(f"\nRunning {name}...")
        try:
            # Call the function to get the coroutine, then await it
            result = await test_func()
            results.append((name, result))
        except Exception as e:
            print(f"Test {name} failed with error: {e}")
            results.append((name, False))
    
    # Print summary
    print("\n=== Test Summary ===")
    all_passed = True
    for name, result in results:
        status = "PASSED" if result else "FAILED"
        print(f"{name}: {status}")
        if not result:
            all_passed = False
    
    print(f"\nOverall result: {'PASSED' if all_passed else 'FAILED'}")


if __name__ == "__main__":
    asyncio.run(main())
