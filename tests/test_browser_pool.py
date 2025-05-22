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
from playwright.async_api import Browser, BrowserContext


async def test_browser_pool_initialization():
    """Test browser pool initialization with different configurations."""
    print("\n=== Testing Browser Pool Initialization ===\n")
    
    # Test 1: Default initialization
    print("Test 1: Default initialization")
    pool = BrowserPool()
    await pool.initialize()
    stats = pool.get_stats()
    print(f"  Pool stats: {stats}")
    assert stats["size"] >= 2, "Pool should have at least 2 browsers"
    
    # Test 2: Custom min/max size
    print("\nTest 2: Custom min/max size")
    custom_pool = BrowserPool(min_size=3, max_size=5)
    await custom_pool.initialize()
    stats = custom_pool.get_stats()
    print(f"  Pool stats: {stats}")
    assert stats["size"] >= 3, "Pool should have at least 3 browsers"
    
    # Clean up
    await pool.shutdown()
    await custom_pool.shutdown()
    
    return True


async def test_browser_pool_get_release():
    """Test getting and releasing browsers from the pool."""
    print("\n=== Testing Browser Pool Get/Release Operations ===\n")
    
    # Create pool with small size for testing
    pool = BrowserPool(min_size=2, max_size=3)
    await pool.initialize()
    
    # Test 1: Get a browser
    print("Test 1: Get a browser")
    browser, browser_index = await pool.get_browser()
    stats = pool.get_stats()
    print(f"  Got browser {browser_index}")
    print(f"  Pool stats: {stats}")
    assert browser is not None, "Should get a valid browser"
    assert browser_index is not None, "Should get a valid browser index"
    assert stats["available"] == 1, "Should have one browser left available"
    
    # Test 2: Get another browser
    print("\nTest 2: Get another browser")
    browser2, browser_index2 = await pool.get_browser()
    stats = pool.get_stats()
    print(f"  Got browser {browser_index2}")
    print(f"  Pool stats: {stats}")
    assert browser2 is not None, "Should get a valid browser"
    assert browser_index2 is not None, "Should get a valid browser index"
    assert browser_index != browser_index2, "Should get a different browser"
    assert stats["available"] == 0, "Should have no browsers left available"
    
    # Test 3: Release a browser
    print("\nTest 3: Release a browser")
    await pool.release_browser(browser_index)
    stats = pool.get_stats()
    print(f"  Released browser {browser_index}")
    print(f"  Pool stats: {stats}")
    assert stats["available"] == 1, "Should have one browser available after release"
    
    # Test 4: Get a browser after release (should get the released one)
    print("\nTest 4: Get a browser after release")
    browser3, browser_index3 = await pool.get_browser()
    stats = pool.get_stats()
    print(f"  Got browser {browser_index3}")
    print(f"  Pool stats: {stats}")
    assert browser_index3 == browser_index, "Should get the previously released browser"
    
    # Clean up
    await pool.release_browser(browser_index2)
    await pool.release_browser(browser_index3)
    await pool.shutdown()
    
    return True


async def test_browser_pool_context_management():
    """Test browser context creation and management."""
    print("\n=== Testing Browser Context Management ===\n")
    
    # Create pool
    pool = BrowserPool(min_size=2, max_size=3)
    await pool.initialize()
    
    # Test 1: Create a context
    print("Test 1: Create a context")
    browser, browser_index = await pool.get_browser()
    context = await pool.create_context(browser_index, viewport={"width": 1280, "height": 720})
    print(f"  Created context for browser {browser_index}")
    assert context is not None, "Should create a valid context"
    
    # Test 2: Create a page in the context
    print("\nTest 2: Create a page in the context")
    page = await context.new_page()
    print(f"  Created page in context")
    assert page is not None, "Should create a valid page"
    
    # Test 3: Navigate to a simple page
    print("\nTest 3: Navigate to a simple page")
    try:
        await page.goto("https://example.com", timeout=30000)
        title = await page.title()
        print(f"  Page title: {title}")
        assert "Example" in title, "Should load example.com"
    except Exception as e:
        print(f"  Navigation error: {e}")
        # Don't fail the test if navigation fails due to network issues
    
    # Test 4: Release the context
    print("\nTest 4: Release the context")
    await pool.release_context(browser_index, context)
    print(f"  Released context for browser {browser_index}")
    
    # Clean up
    await pool.release_browser(browser_index)
    await pool.shutdown()
    
    return True


async def test_browser_pool_scaling():
    """Test browser pool scaling under load."""
    print("\n=== Testing Browser Pool Scaling ===\n")
    
    # Create pool with room to scale
    pool = BrowserPool(min_size=1, max_size=4)
    await pool.initialize()
    
    # Initial stats
    initial_stats = pool.get_stats()
    print(f"Initial pool stats: {initial_stats}")
    
    # Test 1: Scale up by requesting more browsers than min_size
    print("\nTest 1: Scale up by requesting more browsers")
    browsers = []
    indices = []
    
    # Get browsers until we reach max_size
    for i in range(pool._max_size):
        browser, browser_index = await pool.get_browser()
        if browser is not None and browser_index is not None:
            browsers.append(browser)
            indices.append(browser_index)
            print(f"  Got browser {browser_index}")
        else:
            print(f"  Could not get browser {i+1} (pool exhausted)")
            break
    
    # Check stats after scaling up
    stats_after_scale_up = pool.get_stats()
    print(f"Stats after scale up: {stats_after_scale_up}")
    assert stats_after_scale_up["size"] > initial_stats["size"], "Pool should have scaled up"
    assert stats_after_scale_up["available"] == 0, "All browsers should be in use"
    
    # Test 2: Release browsers and verify they're returned to the pool
    print("\nTest 2: Release browsers")
    for i, browser_index in enumerate(indices):
        await pool.release_browser(browser_index)
        print(f"  Released browser {browser_index}")
        
        # Check stats after each release
        stats = pool.get_stats()
        print(f"  Stats after release {i+1}: {stats}")
        assert stats["available"] == i+1, f"Should have {i+1} browsers available after release"
    
    # Clean up
    await pool.shutdown()
    
    return True


async def test_browser_pool_error_handling():
    """Test browser pool error handling and recovery."""
    print("\n=== Testing Browser Pool Error Handling ===\n")
    
    # Create pool
    pool = BrowserPool(min_size=2, max_size=3)
    await pool.initialize()
    
    # Test 1: Handle unhealthy browser
    print("Test 1: Handle unhealthy browser")
    browser, browser_index = await pool.get_browser()
    print(f"  Got browser {browser_index}")
    
    # Release as unhealthy
    print("  Releasing browser as unhealthy")
    await pool.release_browser(browser_index, is_healthy=False)
    
    # Check if browser was recycled
    stats = pool.get_stats()
    print(f"  Pool stats after unhealthy release: {stats}")
    assert stats["recycled"] > 0, "Unhealthy browser should be recycled"
    
    # Test 2: Handle browser context errors
    print("\nTest 2: Handle browser context errors")
    browser, browser_index = await pool.get_browser()
    context = await pool.create_context(browser_index)
    print(f"  Created context for browser {browser_index}")
    
    # Close the context directly (simulating an error)
    print("  Closing context directly (simulating an error)")
    await context.close()
    
    # Try to use the closed context (should fail gracefully)
    print("  Attempting to use closed context")
    try:
        page = await context.new_page()
        print("  Error: Created page in closed context")
        success = False
    except Exception as e:
        print(f"  Expected error: {e}")
        success = True
    
    # Release the browser
    print("  Releasing browser")
    await pool.release_browser(browser_index)
    
    # Clean up
    await pool.shutdown()
    
    return success


async def test_browser_pool_concurrent_access():
    """Test concurrent access to the browser pool."""
    print("\n=== Testing Browser Pool Concurrent Access ===\n")
    
    # Create pool
    pool = BrowserPool(min_size=2, max_size=5)
    await pool.initialize()
    
    # Number of concurrent operations
    num_concurrent = 10
    
    # Create a semaphore to limit concurrency for test stability
    semaphore = asyncio.Semaphore(5)
    
    # Results tracking
    results = {
        "success": 0,
        "failure": 0,
        "contexts_created": 0
    }
    
    async def concurrent_operation(operation_id: int):
        """Simulate a concurrent operation using the browser pool."""
        async with semaphore:
            try:
                # Get a browser
                browser, browser_index = await pool.get_browser()
                if browser is None or browser_index is None:
                    print(f"  Operation {operation_id}: Failed to get browser")
                    results["failure"] += 1
                    return
                
                print(f"  Operation {operation_id}: Got browser {browser_index}")
                
                # Create a context
                context = await pool.create_context(browser_index)
                if context is None:
                    print(f"  Operation {operation_id}: Failed to create context")
                    await pool.release_browser(browser_index)
                    results["failure"] += 1
                    return
                
                results["contexts_created"] += 1
                
                # Simulate work
                await asyncio.sleep(random.uniform(0.1, 0.5))
                
                # Release context
                await pool.release_context(browser_index, context)
                
                # Release browser
                await pool.release_browser(browser_index)
                
                results["success"] += 1
                print(f"  Operation {operation_id}: Completed successfully")
            except Exception as e:
                print(f"  Operation {operation_id}: Error - {e}")
                results["failure"] += 1
    
    # Create tasks for concurrent execution
    print(f"Running {num_concurrent} concurrent operations...")
    tasks = [asyncio.create_task(concurrent_operation(i)) for i in range(num_concurrent)]
    
    # Wait for all tasks to complete
    await asyncio.gather(*tasks)
    
    # Print results
    print("\nResults:")
    print(f"  Success: {results['success']}")
    print(f"  Failure: {results['failure']}")
    print(f"  Contexts created: {results['contexts_created']}")
    
    # Check pool stats
    stats = pool.get_stats()
    print(f"\nFinal pool stats: {stats}")
    
    # Clean up
    await pool.shutdown()
    
    return results["success"] > 0 and results["failure"] < num_concurrent


async def test_browser_pool_with_retry_system():
    """Test browser pool integration with retry system."""
    print("\n=== Testing Browser Pool with Retry System ===\n")
    
    # Create pool
    pool = BrowserPool(min_size=2, max_size=3)
    await pool.initialize()
    
    # Create retry configuration
    retry_config = RetryConfig(
        max_retries=3,
        base_delay=0.2,
        max_delay=1.0,
        jitter=0.1
    )
    
    # Create retry manager
    retry_manager = RetryManager(
        retry_config=retry_config,
        name="test_browser_pool_with_retry"
    )
    
    # Test operation that simulates browser pool operations
    async def browser_operation():
        # Get a browser
        browser, browser_index = await pool.get_browser()
        if browser is None or browser_index is None:
            raise RuntimeError("Failed to get browser from pool")
        
        try:
            # Create a context
            context = await pool.create_context(browser_index)
            if context is None:
                raise RuntimeError("Failed to create browser context")
            
            try:
                # Create a page
                page = await context.new_page()
                
                # Navigate to a test page
                await page.goto("https://example.com", timeout=5000)
                
                # Get the title
                title = await page.title()
                return title
            finally:
                # Release context
                await pool.release_context(browser_index, context)
        finally:
            # Release browser
            await pool.release_browser(browser_index)
    
    # Execute with retry
    print("Executing browser operation with retry...")
    try:
        start_time = time.time()
        result = await retry_manager.execute(browser_operation)
        elapsed = time.time() - start_time
        print(f"  Result: {result} (after {elapsed:.2f} seconds)")
        print(f"  Retry stats: {retry_manager.get_stats()}")
        success = True
    except Exception as e:
        print(f"  Error: {e}")
        success = False
    
    # Check pool stats
    stats = pool.get_stats()
    print(f"\nFinal pool stats: {stats}")
    
    # Clean up
    await pool.shutdown()
    
    return success


async def test_browser_pool_resource_cleanup():
    """Test browser pool resource cleanup."""
    print("\n=== Testing Browser Pool Resource Cleanup ===\n")
    
    # Create pool with short idle timeout for testing
    pool = BrowserPool(
        min_size=2,
        max_size=5,
        idle_timeout=2,  # 2 seconds idle timeout for testing
        cleanup_interval=1  # 1 second cleanup interval
    )
    await pool.initialize()
    
    # Get initial stats
    initial_stats = pool.get_stats()
    print(f"Initial pool stats: {initial_stats}")
    
    # Test 1: Scale up by requesting more browsers
    print("\nTest 1: Scale up by requesting more browsers")
    browsers = []
    indices = []
    
    # Get browsers until we reach max_size
    for i in range(pool._max_size):
        browser, browser_index = await pool.get_browser()
        if browser is not None and browser_index is not None:
            browsers.append(browser)
            indices.append(browser_index)
            print(f"  Got browser {browser_index}")
    
    # Release all browsers
    for browser_index in indices:
        await pool.release_browser(browser_index)
        print(f"  Released browser {browser_index}")
    
    # Check stats after release
    stats_after_release = pool.get_stats()
    print(f"Stats after release: {stats_after_release}")
    
    # Test 2: Wait for idle timeout and cleanup
    print("\nTest 2: Wait for idle timeout and cleanup")
    print("  Waiting for idle timeout (3 seconds)...")
    await asyncio.sleep(3)  # Wait for idle timeout + cleanup interval
    
    # Force cleanup
    await pool.cleanup()
    
    # Check stats after cleanup
    stats_after_cleanup = pool.get_stats()
    print(f"Stats after cleanup: {stats_after_cleanup}")
    
    # Verify that idle browsers were cleaned up
    assert stats_after_cleanup["size"] <= pool._min_size, "Excess browsers should be cleaned up"
    
    # Clean up
    await pool.shutdown()
    
    return True


async def test_browser_pool_stress_test():
    """Stress test the browser pool with rapid get/release cycles."""
    print("\n=== Stress Testing Browser Pool ===\n")
    
    # Create pool
    pool = BrowserPool(min_size=2, max_size=5)
    await pool.initialize()
    
    # Test parameters
    num_cycles = 20
    max_concurrent = 3
    
    # Create a semaphore to limit concurrency
    semaphore = asyncio.Semaphore(max_concurrent)
    
    # Results tracking
    results = {
        "success": 0,
        "failure": 0
    }
    
    async def stress_cycle(cycle_id: int):
        """Perform a rapid get/release cycle."""
        async with semaphore:
            try:
                # Get a browser
                browser, browser_index = await pool.get_browser()
                if browser is None or browser_index is None:
                    print(f"  Cycle {cycle_id}: Failed to get browser")
                    results["failure"] += 1
                    return
                
                # Create a context
                context = await pool.create_context(browser_index)
                if context is None:
                    print(f"  Cycle {cycle_id}: Failed to create context")
                    await pool.release_browser(browser_index)
                    results["failure"] += 1
                    return
                
                # Minimal work
                await asyncio.sleep(random.uniform(0.05, 0.2))
                
                # Release context
                await pool.release_context(browser_index, context)
                
                # Release browser
                await pool.release_browser(browser_index)
                
                results["success"] += 1
            except Exception as e:
                print(f"  Cycle {cycle_id}: Error - {e}")
                results["failure"] += 1
    
    # Create tasks for stress test
    print(f"Running {num_cycles} rapid get/release cycles...")
    tasks = [asyncio.create_task(stress_cycle(i)) for i in range(num_cycles)]
    
    # Wait for all tasks to complete
    await asyncio.gather(*tasks)
    
    # Print results
    print("\nResults:")
    print(f"  Success: {results['success']}")
    print(f"  Failure: {results['failure']}")
    print(f"  Success rate: {results['success'] / num_cycles * 100:.1f}%")
    
    # Check pool stats
    stats = pool.get_stats()
    print(f"\nFinal pool stats: {stats}")
    
    # Clean up
    await pool.shutdown()
    
    return results["success"] >= num_cycles * 0.8  # At least 80% success rate


async def main():
    """Run all tests."""
    parser = argparse.ArgumentParser(description="Test browser pool management")
    parser.add_argument("--test", type=str, help="Run a specific test")
    args = parser.parse_args()
    
    print("Starting browser pool management tests...")
    
    # Define all tests
    all_tests = {
        "initialization": ("Browser Pool Initialization", test_browser_pool_initialization),
        "get_release": ("Browser Pool Get/Release", test_browser_pool_get_release),
        "context": ("Browser Context Management", test_browser_pool_context_management),
        "scaling": ("Browser Pool Scaling", test_browser_pool_scaling),
        "error": ("Browser Pool Error Handling", test_browser_pool_error_handling),
        "concurrent": ("Browser Pool Concurrent Access", test_browser_pool_concurrent_access),
        "retry": ("Browser Pool with Retry System", test_browser_pool_with_retry_system),
        "cleanup": ("Browser Pool Resource Cleanup", test_browser_pool_resource_cleanup),
        "stress": ("Browser Pool Stress Test", test_browser_pool_stress_test)
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
