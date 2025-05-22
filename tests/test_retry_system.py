import asyncio
import sys
import os
import time
import random
from pathlib import Path
from typing import List, Dict, Any

# Add the parent directory to the path so we can import app modules
sys.path.append(str(Path(__file__).parent.parent))

from app.services.retry import RetryConfig, CircuitBreaker, RetryManager


async def test_retry_with_exponential_backoff():
    """Test retry with exponential backoff and jitter."""
    print("\n=== Testing Retry with Exponential Backoff and Jitter ===")
    
    # Create retry configuration
    retry_config = RetryConfig(
        max_retries=3,
        base_delay=0.1,  # Short delay for testing
        max_delay=1.0,
        jitter=0.2
    )
    
    # Create retry manager
    retry_manager = RetryManager(
        retry_config=retry_config,
        name="test_exponential_backoff"
    )
    
    # Counter for tracking attempts
    attempt_counter = 0
    delay_times = []
    
    # For tracking attempt times
    last_attempt_time = time.time()
    
    # Test operation that fails until the last attempt
    async def test_operation():
        nonlocal attempt_counter, last_attempt_time
        attempt_counter += 1
        start_time = time.time()
        
        if attempt_counter == 1:
            # First attempt - record start time
            print(f"  Attempt {attempt_counter} at {start_time:.2f}s - Will fail")
            last_attempt_time = start_time
            raise RuntimeError(f"Simulated failure on attempt {attempt_counter}")
        else:
            # Subsequent attempts - calculate delay from last attempt
            delay = start_time - last_attempt_time
            delay_times.append(delay)
            last_attempt_time = start_time
            
            if attempt_counter <= retry_config.max_retries:
                print(f"  Attempt {attempt_counter} at {start_time:.2f}s (delay: {delay:.2f}s) - Will fail")
                raise RuntimeError(f"Simulated failure on attempt {attempt_counter}")
            else:
                print(f"  Attempt {attempt_counter} at {start_time:.2f}s (delay: {delay:.2f}s) - Will succeed")
                return "success"
    
    # Execute with retry
    start_time = time.time()
    try:
        result = await retry_manager.execute(test_operation)
        elapsed = time.time() - start_time
        print(f"  Result: {result} (after {elapsed:.2f} seconds)")
        
        # Analyze delays
        if len(delay_times) >= 2:
            print("  Delay Analysis:")
            for i, delay in enumerate(delay_times):
                expected_base = retry_config.base_delay * (2 ** i)
                expected_min = expected_base * (1 - retry_config.jitter)
                expected_max = expected_base * (1 + retry_config.jitter)
                within_range = expected_min <= delay <= expected_max
                print(f"    Retry {i+1}: Delay={delay:.3f}s, Expected range: {expected_min:.3f}s-{expected_max:.3f}s - {'✓' if within_range else '✗'}")
                
            # Check if delays are increasing (exponential backoff)
            is_increasing = all(delay_times[i] <= delay_times[i+1] for i in range(len(delay_times)-1))
            print(f"    Exponential backoff pattern: {'✓' if is_increasing else '✗'}")
        
        return True
    except Exception as e:
        print(f"  Error: {e}")
        return False


async def test_circuit_breaker_pattern():
    """Test circuit breaker pattern with state transitions."""
    print("\n=== Testing Circuit Breaker Pattern ===")
    
    # Create circuit breaker
    circuit_breaker = CircuitBreaker(
        threshold=3,  # Open after 3 failures
        reset_time=2  # Reset after 2 seconds
    )
    
    # Test state transitions
    print("  Initial state: closed")
    assert circuit_breaker.state == "closed"
    
    # Record failures to trigger open state
    print("  Recording failures to trigger open state...")
    for i in range(circuit_breaker.threshold):
        await circuit_breaker.record_failure()
        print(f"    Failure {i+1}/{circuit_breaker.threshold} - State: {circuit_breaker.state}")
    
    # Verify circuit is open
    assert circuit_breaker.state == "open"
    can_execute = await circuit_breaker.can_execute()
    print(f"  Circuit is open, can_execute: {can_execute}")
    assert not can_execute
    
    # Force transition to half-open for testing
    print("  Forcing transition to half-open state...")
    circuit_breaker.state = "half-open"
    circuit_breaker.failure_count = 0
    
    # Verify circuit is half-open
    assert circuit_breaker.state == "half-open"
    can_execute = await circuit_breaker.can_execute()
    print(f"  Circuit is half-open, can_execute: {can_execute}")
    assert can_execute
    
    # Test successful operation to close the circuit
    print("  Recording success to close the circuit...")
    await circuit_breaker.record_success()
    assert circuit_breaker.state == "closed"
    print(f"  Circuit is closed after success")
    
    # Verify circuit breaker stats
    stats = circuit_breaker.get_state()
    print("  Circuit breaker stats:")
    print(f"    State: {stats['state']}")
    print(f"    Failure count: {stats['failure_count']}")
    print(f"    Threshold: {stats['threshold']}")
    print(f"    Reset time: {stats['reset_time']}")
    print(f"    Trips: {stats['stats']['trips']}")
    print(f"    Resets: {stats['stats']['resets']}")
    
    return True


async def test_retry_with_circuit_breaker():
    """Test retry manager with circuit breaker integration."""
    print("\n=== Testing Retry Manager with Circuit Breaker ===")
    
    # Create circuit breaker
    circuit_breaker = CircuitBreaker(
        threshold=2,  # Open after 2 failures
        reset_time=2  # Reset after 2 seconds
    )
    
    # Create retry configuration
    retry_config = RetryConfig(
        max_retries=5,
        base_delay=0.1,
        max_delay=0.5,
        jitter=0.1
    )
    
    # Create retry manager with circuit breaker
    retry_manager = RetryManager(
        retry_config=retry_config,
        circuit_breaker=circuit_breaker,
        name="test_retry_with_circuit_breaker"
    )
    
    # Test operation that always fails
    async def failing_operation():
        print("  Operation failed")
        raise RuntimeError("Simulated failure")
    
    # Phase 1: Execute operations until circuit breaker opens
    print("  Phase 1: Executing operations until circuit breaker opens...")
    operations_executed = 0
    circuit_breaker_opened = False
    
    for i in range(5):  # Try up to 5 operations
        try:
            await retry_manager.execute(failing_operation)
            print(f"  Operation {i+1}: Unexpected success")
        except Exception as e:
            operations_executed += 1
            if "Circuit breaker is open" in str(e):
                circuit_breaker_opened = True
                print(f"  Operation {i+1}: Circuit breaker opened - {e}")
                break
            else:
                print(f"  Operation {i+1}: Expected failure - {e}")
    
    # Verify circuit breaker opened
    assert circuit_breaker_opened, "Circuit breaker should have opened"
    print(f"  Circuit breaker state: {circuit_breaker.get_state()['state']}")
    
    # Phase 2: Force reset the circuit breaker
    print("  Phase 2: Forcing circuit breaker reset...")
    circuit_breaker.state = "half-open"
    circuit_breaker.failure_count = 0
    
    # Phase 3: Test successful operation to close the circuit
    print("  Phase 3: Testing with successful operation...")
    
    # Create a successful operation
    async def successful_operation():
        print("  Operation succeeded")
        return "success"
    
    try:
        result = await retry_manager.execute(successful_operation)
        print(f"  Result: {result}")
        print(f"  Circuit breaker state: {circuit_breaker.get_state()['state']}")
        assert circuit_breaker.state == "closed", "Circuit breaker should be closed"
    except Exception as e:
        print(f"  Unexpected error: {e}")
        return False
    
    # Get retry manager stats
    stats = retry_manager.get_stats()
    print("  Retry manager stats:")
    print(f"    Attempts: {stats['attempts']}")
    print(f"    Successes: {stats['successes']}")
    print(f"    Failures: {stats['failures']}")
    print(f"    Retries: {stats['retries']}")
    print(f"    Circuit breaker rejections: {stats['circuit_breaker_rejections']}")
    
    return True


async def main():
    """Run all tests."""
    print("Starting retry system tests...")
    
    # Run tests
    tests = [
        ("Retry with Exponential Backoff", test_retry_with_exponential_backoff()),
        ("Circuit Breaker Pattern", test_circuit_breaker_pattern()),
        ("Retry with Circuit Breaker", test_retry_with_circuit_breaker())
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
