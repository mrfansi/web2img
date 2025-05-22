import asyncio
import sys
import os
import time
from pathlib import Path

# Add the parent directory to the path so we can import app modules
sys.path.append(str(Path(__file__).parent.parent))

from app.services.retry import RetryConfig, CircuitBreaker, RetryManager
from app.services.screenshot import ScreenshotService
from app.core.config import settings


async def test_retry_success():
    """Test successful retry after temporary failures."""
    print("\n=== Testing retry with eventual success ===")
    
    # Create retry configuration
    retry_config = RetryConfig(
        max_retries=3,
        base_delay=0.2,  # Short delay for testing
        max_delay=1.0,
        jitter=0.1
    )
    
    # Create retry manager
    retry_manager = RetryManager(
        retry_config=retry_config,
        name="test_retry_success"
    )
    
    # Counter for tracking attempts
    attempt_counter = 0
    
    # Test operation that fails twice then succeeds
    async def test_operation():
        nonlocal attempt_counter
        attempt_counter += 1
        print(f"  Attempt {attempt_counter}...")
        
        if attempt_counter < 3:
            print(f"  Attempt {attempt_counter} failed, will retry")
            raise RuntimeError(f"Simulated failure on attempt {attempt_counter}")
        
        print(f"  Attempt {attempt_counter} succeeded!")
        return "success"
    
    # Execute with retry
    start_time = time.time()
    try:
        result = await retry_manager.execute(test_operation)
        elapsed = time.time() - start_time
        print(f"  Result: {result} (after {elapsed:.2f} seconds)")
        print(f"  Stats: {retry_manager.get_stats()}")
        return True
    except Exception as e:
        print(f"  Error: {e}")
        return False


async def test_retry_failure():
    """Test retry exhaustion."""
    print("\n=== Testing retry exhaustion ===")
    
    # Create retry configuration
    retry_config = RetryConfig(
        max_retries=2,  # Only allow 2 retries
        base_delay=0.1,  # Short delay for testing
        max_delay=0.5,
        jitter=0.1
    )
    
    # Create retry manager
    retry_manager = RetryManager(
        retry_config=retry_config,
        name="test_retry_failure"
    )
    
    # Test operation that always fails
    async def test_operation():
        print("  Attempt failed, will retry if possible")
        raise RuntimeError("Simulated persistent failure")
    
    # Execute with retry
    start_time = time.time()
    try:
        result = await retry_manager.execute(test_operation)
        print(f"  Result: {result}")
        return False  # Should not reach here
    except Exception as e:
        elapsed = time.time() - start_time
        print(f"  Error: {e} (after {elapsed:.2f} seconds)")
        print(f"  Stats: {retry_manager.get_stats()}")
        return True


async def test_circuit_breaker():
    """Test circuit breaker pattern."""
    print("\n=== Testing circuit breaker ===")
    
    # Create circuit breaker
    circuit_breaker = CircuitBreaker(
        threshold=3,  # Open after 3 failures
        reset_time=2  # Reset after 2 seconds
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
        name="test_circuit_breaker"
    )
    
    # Test operation that always fails
    async def test_operation():
        print("  Attempt failed")
        raise RuntimeError("Simulated failure for circuit breaker")
    
    # Execute multiple times to trigger circuit breaker
    print("  Executing multiple operations to trigger circuit breaker...")
    for i in range(5):
        try:
            await retry_manager.execute(test_operation)
        except Exception as e:
            print(f"  Operation {i+1} error: {str(e)[:50]}...")
    
    # Check circuit breaker state
    print(f"  Circuit breaker state: {circuit_breaker.get_state()['state']}")
    
    # Wait for circuit breaker to reset
    print("  Waiting for circuit breaker reset...")
    await asyncio.sleep(2.5)
    
    # Try again after reset
    print("  Trying again after reset...")
    try:
        await retry_manager.execute(test_operation)
    except Exception as e:
        print(f"  Error after reset: {str(e)[:50]}...")
    
    # Check circuit breaker state again
    print(f"  Circuit breaker state after reset attempt: {circuit_breaker.get_state()['state']}")
    return True


async def test_screenshot_service_retry():
    """Test retry logic in the screenshot service."""
    print("\n=== Testing screenshot service retry logic ===")
    
    # Create screenshot service
    screenshot_service = ScreenshotService()
    
    # Print retry configuration
    print("  Retry configuration:")
    print(f"    Regular sites: max_retries={settings.max_retries_regular}, ")
    print(f"    Complex sites: max_retries={settings.max_retries_complex}")
    
    # Get retry stats
    retry_stats = screenshot_service.get_retry_stats()
    print("  Initial retry stats:")
    print(f"    {retry_stats}")
    
    # Try to capture a screenshot of a non-existent site (should fail and retry)
    print("  Testing screenshot capture with retries (will fail)...")
    try:
        start_time = time.time()
        filepath = await screenshot_service.capture_screenshot(
            url="https://nonexistent-site-that-will-fail-12345.com",
            width=800,
            height=600,
            format="png"
        )
        print(f"  Screenshot captured: {filepath}")
    except Exception as e:
        elapsed = time.time() - start_time
        print(f"  Screenshot failed as expected: {str(e)[:100]}... (after {elapsed:.2f} seconds)")
    
    # Get updated retry stats
    retry_stats = screenshot_service.get_retry_stats()
    print("  Updated retry stats:")
    print(f"    Timeouts: {retry_stats['timeouts']}")
    print(f"    Browser retry: {retry_stats['browser_retry']}")
    
    return True


async def main():
    """Run all tests."""
    print("Starting retry system tests...")
    
    # Run tests
    tests = [
        ("Retry Success Test", test_retry_success()),
        ("Retry Failure Test", test_retry_failure()),
        ("Circuit Breaker Test", test_circuit_breaker()),
        ("Screenshot Service Test", test_screenshot_service_retry())
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
