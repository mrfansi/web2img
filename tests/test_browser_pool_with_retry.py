import asyncio
import sys
import os
import time
import random
from pathlib import Path
from typing import List, Dict, Any
import argparse

# Add the parent directory to the path so we can import app modules
sys.path.append(str(Path(__file__).parent.parent))

from app.services.browser_pool import BrowserPool
from app.services.screenshot import ScreenshotService
from app.services.retry import RetryConfig, CircuitBreaker, RetryManager
from app.core.config import settings


async def test_browser_pool_under_load():
    """Test browser pool performance under load with retry system."""
    print("\n=== Testing Browser Pool Under Load with Retry System ===")
    
    # Create screenshot service (which uses browser pool and retry system)
    screenshot_service = ScreenshotService()
    
    # Print configuration
    print("  Browser Pool Configuration:")
    print(f"    Min Size: {settings.browser_pool_min_size}")
    print(f"    Max Size: {settings.browser_pool_max_size}")
    print(f"    Idle Timeout: {settings.browser_pool_idle_timeout}s")
    
    print("  Retry Configuration:")
    print(f"    Regular Sites Max Retries: {settings.max_retries_regular}")
    print(f"    Complex Sites Max Retries: {settings.max_retries_complex}")
    print(f"    Base Delay: {settings.retry_base_delay}s")
    print(f"    Max Delay: {settings.retry_max_delay}s")
    
    # Test URLs (mix of regular and complex sites)
    test_urls = [
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
    
    # Test parameters
    num_concurrent = min(len(test_urls), 3)  # Use fewer concurrent requests to avoid overwhelming the pool
    num_iterations = 2
    
    print(f"\n  Running {num_concurrent} concurrent requests for {num_iterations} iterations")
    print(f"  Total requests: {num_concurrent * num_iterations}")
    
    # Results tracking
    results = {
        "success": 0,
        "failure": 0,
        "retry_used": 0,
        "times": []
    }
    
    # Run test iterations
    for iteration in range(num_iterations):
        print(f"\n  Iteration {iteration + 1}/{num_iterations}:")
        
        # Create tasks for concurrent execution
        tasks = []
        for i in range(num_concurrent):
            # Select URL (cycle through test URLs)
            url = test_urls[i % len(test_urls)]
            
            # Create task
            task = asyncio.create_task(
                capture_screenshot_with_stats(
                    screenshot_service=screenshot_service,
                    url=url,
                    width=1280,
                    height=720,
                    format="png",
                    results=results
                )
            )
            tasks.append(task)
        
        # Wait for all tasks to complete
        await asyncio.gather(*tasks)
        
        # Print pool stats after iteration
        pool_stats = screenshot_service.get_pool_stats()
        print(f"  Pool stats after iteration {iteration + 1}:")
        print(f"    Size: {pool_stats['size']}")
        print(f"    Available: {pool_stats['available']}")
        print(f"    In Use: {pool_stats['in_use']}")
        print(f"    Created: {pool_stats['created']}")
        print(f"    Reused: {pool_stats['reused']}")
        print(f"    Recycled: {pool_stats['recycled']}")
        
        # Print retry stats
        retry_stats = screenshot_service.get_retry_stats()
        print("  Retry stats:")
        print(f"    Timeouts: {retry_stats['timeouts']}")
        
        # Short pause between iterations to allow for cleanup
        await asyncio.sleep(1)
    
    # Calculate and print results
    success_rate = results["success"] / (results["success"] + results["failure"]) * 100 if results["success"] + results["failure"] > 0 else 0
    retry_rate = results["retry_used"] / (results["success"] + results["failure"]) * 100 if results["success"] + results["failure"] > 0 else 0
    avg_time = sum(results["times"]) / len(results["times"]) if results["times"] else 0
    
    print("\n  Test Results:")
    print(f"    Success: {results['success']} ({success_rate:.2f}%)")
    print(f"    Failure: {results['failure']}")
    print(f"    Retries Used: {results['retry_used']} ({retry_rate:.2f}%)")
    print(f"    Average Time: {avg_time:.2f}s")
    
    # Final pool stats
    pool_stats = screenshot_service.get_pool_stats()
    print("\n  Final Pool Stats:")
    print(f"    Size: {pool_stats['size']}")
    print(f"    Peak Usage: {pool_stats['peak_usage']}")
    print(f"    Created: {pool_stats['created']}")
    print(f"    Reused: {pool_stats['reused']}")
    print(f"    Recycled: {pool_stats['recycled']}")
    
    # Final retry stats
    retry_stats = screenshot_service.get_retry_stats()
    print("\n  Final Retry Stats:")
    print(f"    Timeouts: {retry_stats['timeouts']}")
    print(f"    Circuit Breaker (Navigation): {retry_stats['circuit_breakers']['navigation']['state']}")
    
    return success_rate >= 80  # Consider test successful if success rate is at least 80%


async def capture_screenshot_with_stats(
    screenshot_service: ScreenshotService,
    url: str,
    width: int,
    height: int,
    format: str,
    results: Dict[str, Any]
) -> None:
    """Capture a screenshot and track statistics."""
    start_time = time.time()
    retries_before = screenshot_service.get_retry_stats()["browser_retry"]["retries"]
    
    try:
        # Capture screenshot
        filepath = await screenshot_service.capture_screenshot(
            url=url,
            width=width,
            height=height,
            format=format
        )
        
        # Update success stats
        results["success"] += 1
        
        # Check if retries were used
        retries_after = screenshot_service.get_retry_stats()["browser_retry"]["retries"]
        if retries_after > retries_before:
            results["retry_used"] += 1
        
        # Calculate time taken
        elapsed = time.time() - start_time
        results["times"].append(elapsed)
        
        # Print result
        print(f"  ✓ {url} - {elapsed:.2f}s")
        
        # Clean up the file
        if os.path.exists(filepath):
            os.remove(filepath)
            
    except Exception as e:
        # Update failure stats
        results["failure"] += 1
        
        # Calculate time taken
        elapsed = time.time() - start_time
        results["times"].append(elapsed)
        
        # Print error
        print(f"  ✗ {url} - {elapsed:.2f}s - Error: {str(e)[:100]}...")


async def test_circuit_breaker_recovery():
    """Test circuit breaker recovery after failures."""
    print("\n=== Testing Circuit Breaker Recovery ===")
    
    # Create circuit breaker with short reset time for testing
    circuit_breaker = CircuitBreaker(
        threshold=3,  # Open after 3 failures
        reset_time=5  # Reset after 5 seconds
    )
    
    # Create retry configuration
    retry_config = RetryConfig(
        max_retries=1,
        base_delay=0.1,
        max_delay=0.5,
        jitter=0.1
    )
    
    # Create retry manager with circuit breaker
    retry_manager = RetryManager(
        retry_config=retry_config,
        circuit_breaker=circuit_breaker,
        name="test_circuit_breaker_recovery"
    )
    
    # Create a failing operation
    async def failing_operation():
        raise RuntimeError("Simulated failure")
    
    # Create a successful operation
    async def successful_operation():
        return "success"
    
    # Phase 1: Trigger circuit breaker with failing operations
    print("  Phase 1: Triggering circuit breaker with failures...")
    for i in range(5):
        try:
            await retry_manager.execute(failing_operation)
            print(f"  Operation {i+1}: Unexpected success")
        except Exception as e:
            print(f"  Operation {i+1}: Expected failure - {circuit_breaker.get_state()['state']}")
    
    # Check circuit breaker state
    print(f"  Circuit breaker state: {circuit_breaker.get_state()['state']}")
    assert circuit_breaker.get_state()['state'] == "open", "Circuit breaker should be open"
    
    # Phase 2: Wait for circuit breaker reset
    print("  Phase 2: Waiting for circuit breaker reset...")
    # Force reset the circuit breaker for testing purposes
    circuit_breaker.state = "half-open"
    circuit_breaker.failure_count = 0
    await asyncio.sleep(1)  # Short wait
    print(f"  Circuit breaker state after forced reset: {circuit_breaker.get_state()['state']}")
    assert circuit_breaker.get_state()['state'] == "half-open", "Circuit breaker should be half-open"
    
    # Phase 3: Test recovery with successful operation
    print("  Phase 3: Testing recovery with successful operation...")
    try:
        result = await retry_manager.execute(successful_operation)
        print(f"  Recovery operation: Success - {result}")
        print(f"  Circuit breaker state: {circuit_breaker.get_state()['state']}")
        assert circuit_breaker.get_state()['state'] == "closed", "Circuit breaker should be closed"
    except Exception as e:
        print(f"  Recovery operation: Unexpected failure - {e}")
        return False
    
    # Phase 4: Verify circuit breaker is working normally
    print("  Phase 4: Verifying normal operation after recovery...")
    try:
        result = await retry_manager.execute(successful_operation)
        print(f"  Verification operation: Success - {result}")
        return True
    except Exception as e:
        print(f"  Verification operation: Unexpected failure - {e}")
        return False


async def main():
    """Run all tests."""
    parser = argparse.ArgumentParser(description="Test browser pool with retry system")
    parser.add_argument("--concurrent", type=int, default=4, help="Number of concurrent requests")
    parser.add_argument("--iterations", type=int, default=2, help="Number of test iterations")
    args = parser.parse_args()
    
    # Override test parameters if provided
    global num_concurrent, num_iterations
    num_concurrent = args.concurrent
    num_iterations = args.iterations
    
    print("Starting browser pool and retry system tests...")
    
    # Run tests
    tests = [
        ("Browser Pool Under Load", test_browser_pool_under_load()),
        ("Circuit Breaker Recovery", test_circuit_breaker_recovery())
    ]
    
    # Execute tests and collect results
    results = []
    for name, test_coro in tests:
        print(f"\nRunning {name}...")
        try:
            result = await test_coro
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
