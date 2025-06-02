import asyncio
import random
import time
import inspect
from typing import Dict, Any, Optional, Callable

from app.core.logging import get_logger

# Import Playwright errors for proper error handling
try:
    from playwright._impl._errors import TargetClosedError
except ImportError:
    # Fallback if Playwright is not available or structure changes
    TargetClosedError = None


class RetryConfig:
    """Configuration for retry behavior with exponential backoff and jitter."""

    def __init__(
        self,
        max_retries: int,
        base_delay: float,
        max_delay: float,
        jitter: float
    ):
        """Initialize retry configuration.

        Args:
            max_retries: Maximum number of retry attempts
            base_delay: Base delay in seconds between retries
            max_delay: Maximum delay in seconds between retries
            jitter: Jitter factor (0-1) to add randomness to delay
        """
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay
        self.jitter = jitter

    def get_delay(self, retry_count: int, error_type: str = None) -> float:
        """Calculate delay with exponential backoff and jitter.

        Args:
            retry_count: Current retry attempt (0-based)
            error_type: Type of error that occurred (for adaptive delays)

        Returns:
            Delay in seconds before next retry
        """
        # Calculate exponential backoff
        delay = min(self.max_delay, self.base_delay * (2 ** retry_count))

        # Apply adaptive delays based on error type
        if error_type:
            if "timeout" in error_type.lower():
                # For timeout errors, use longer delays to allow system recovery
                delay *= 1.5
            elif "memory" in error_type.lower() or "resource" in error_type.lower():
                # For resource exhaustion, use even longer delays
                delay *= 2.0
            elif "connection" in error_type.lower() or "network" in error_type.lower():
                # For network errors, use moderate delays
                delay *= 1.2

        # Ensure we don't exceed max_delay after multipliers
        delay = min(self.max_delay, delay)

        # Add jitter to prevent thundering herd
        jitter_amount = delay * self.jitter
        delay = delay + (random.random() * 2 - 1) * jitter_amount

        return max(0, delay)  # Ensure non-negative delay

    def get_config(self) -> Dict[str, Any]:
        """Get configuration as dictionary."""
        return {
            "max_retries": self.max_retries,
            "base_delay": self.base_delay,
            "max_delay": self.max_delay,
            "jitter": self.jitter
        }


class CircuitBreaker:
    """Circuit breaker pattern implementation to prevent cascading failures."""

    def __init__(self, threshold: int, reset_time: int, name: str = "default"):
        """Initialize circuit breaker.

        Args:
            threshold: Number of failures before opening the circuit
            reset_time: Time in seconds before attempting to close the circuit
            name: Name for this circuit breaker (for logging and metrics)
        """
        self.threshold = threshold
        self.reset_time = reset_time
        self.name = name
        self.failure_count = 0
        self.last_failure_time = 0
        self.state = "closed"  # closed, open, half-open
        self._lock = asyncio.Lock()
        self._stats = {
            "trips": 0,
            "successes": 0,
            "failures": 0,
            "resets": 0
        }
        # Create a logger for this circuit breaker
        self.logger = get_logger(f"circuit_breaker.{name}")

    async def record_success(self):
        """Record a successful operation."""
        async with self._lock:
            previous_state = self.state
            if self.state == "half-open":
                self.state = "closed"
                self._stats["resets"] += 1

                # Log state transition
                self.logger.info(
                    f"Circuit breaker {self.name} state changed: {previous_state} -> {self.state}",
                    {
                        "previous_state": previous_state,
                        "new_state": self.state,
                        "threshold": self.threshold,
                        "reset_time": self.reset_time,
                        "failure_count": self.failure_count
                    }
                )

            self.failure_count = 0
            self._stats["successes"] += 1

            # Log success
            self.logger.debug(
                f"Circuit breaker {self.name} recorded success",
                {
                    "state": self.state,
                    "stats": self._stats.copy()
                }
            )

    async def record_failure(self):
        """Record a failed operation."""
        async with self._lock:
            current_time = time.time()
            previous_state = self.state
            self._stats["failures"] += 1

            # Check if circuit breaker should reset due to time
            if self.state == "open" and current_time - self.last_failure_time > self.reset_time:
                self.state = "half-open"
                self.failure_count = 0

                # Log state transition due to timeout
                self.logger.info(
                    f"Circuit breaker {self.name} state changed: {previous_state} -> {self.state} (timeout)",
                    {
                        "previous_state": previous_state,
                        "new_state": self.state,
                        "reason": "timeout",
                        "elapsed_time": current_time - self.last_failure_time,
                        "reset_time": self.reset_time
                    }
                )

            # Increment failure count
            previous_failure_count = self.failure_count
            self.failure_count += 1
            self.last_failure_time = current_time

            # Log failure
            self.logger.debug(
                f"Circuit breaker {self.name} recorded failure ({self.failure_count}/{self.threshold})",
                {
                    "state": self.state,
                    "failure_count": self.failure_count,
                    "threshold": self.threshold,
                    "stats": self._stats.copy()
                }
            )

            # Check if threshold is reached
            if self.state == "closed" and self.failure_count >= self.threshold:
                self.state = "open"
                self._stats["trips"] += 1

                # Log state transition due to threshold
                self.logger.warning(
                    f"Circuit breaker {self.name} tripped: {previous_state} -> {self.state}",
                    {
                        "previous_state": previous_state,
                        "new_state": self.state,
                        "reason": "threshold_reached",
                        "failure_count": self.failure_count,
                        "threshold": self.threshold,
                        "trips": self._stats["trips"]
                    }
                )

    async def can_execute(self) -> bool:
        """Check if operation can be executed based on circuit breaker state.

        Returns:
            True if operation can be executed, False otherwise
        """
        async with self._lock:
            current_time = time.time()

            # If circuit is closed, allow execution
            if self.state == "closed":
                return True

            # If circuit is open, check if reset timeout has elapsed
            if self.state == "open":
                time_since_failure = current_time - self.last_failure_time

                # Implement progressive recovery - allow some requests through even before full reset
                # This helps prevent all-or-nothing behavior during high load
                if time_since_failure >= self.reset_time:
                    # Transition to half-open state
                    previous_state = self.state
                    self.state = "half-open"

                    # Log state transition
                    self.logger.info(
                        f"Circuit breaker {self.name} state changed: {previous_state} -> {self.state}",
                        {
                            "previous_state": previous_state,
                            "new_state": self.state,
                            "time_since_last_failure": time_since_failure,
                            "reset_time": self.reset_time
                        }
                    )

                    return True
                elif time_since_failure >= (self.reset_time * 0.5):
                    # Progressive recovery: Allow some requests through with probability
                    # that increases as we get closer to reset_time
                    recovery_progress = (time_since_failure - (self.reset_time * 0.5)) / (self.reset_time * 0.5)
                    allow_request = random.random() < recovery_progress

                    if allow_request:
                        self.logger.debug(
                            f"Circuit breaker {self.name} allowing request during progressive recovery",
                            {
                                "state": self.state,
                                "time_since_last_failure": time_since_failure,
                                "reset_time": self.reset_time,
                                "recovery_progress": recovery_progress
                            }
                        )
                        return True

                # Circuit is still fully open
                self.logger.debug(
                    f"Circuit breaker {self.name} blocking execution (state: {self.state})",
                    {
                        "state": self.state,
                        "time_since_last_failure": time_since_failure,
                        "reset_time": self.reset_time,
                        "remaining_time": self.reset_time - time_since_failure
                    }
                )

                return False

            # If circuit is half-open, allow execution (test if system has recovered)
            # But limit the rate of requests in half-open state to prevent overwhelming the system
            if self.state == "half-open":
                # Allow only a percentage of requests through in half-open state
                # This prevents overwhelming the system during recovery
                allow_request = random.random() < 0.3  # 30% of requests allowed through

                if not allow_request:
                    self.logger.debug(
                        f"Circuit breaker {self.name} limiting requests in half-open state",
                        {
                            "state": self.state,
                            "time_since_last_failure": current_time - self.last_failure_time
                        }
                    )

                return allow_request
                
            # Default fallback - should never reach here as all states are covered
            # But adding explicit return to satisfy type checker
            return False

    def get_state(self) -> Dict[str, Any]:
        """Get current circuit breaker state.

        Returns:
            Dictionary with current state information
        """
        return {
            "state": self.state,
            "failure_count": self.failure_count,
            "last_failure_time": self.last_failure_time,
            "threshold": self.threshold,
            "reset_time": self.reset_time,
            "stats": self._stats
        }


class RetryManager:
    """Manager for retry operations with circuit breaker integration."""

    def __init__(
        self,
        retry_config: RetryConfig,
        circuit_breaker: Optional[CircuitBreaker] = None,
        name: str = "default"
    ):
        """Initialize retry manager.

        Args:
            retry_config: Configuration for retry behavior
            circuit_breaker: Optional circuit breaker for preventing cascading failures
            name: Name for this retry manager (for logging and metrics)
        """
        self.retry_config = retry_config
        self.circuit_breaker = circuit_breaker
        self.name = name
        self._stats = {
            "attempts": 0,
            "successes": 0,
            "failures": 0,
            "retries": 0,
            "circuit_breaker_rejections": 0
        }
        # Create a logger for this retry manager
        self.logger = get_logger(f"retry.{name}")

    def _should_retry_error(self, error: Exception, retry_count: int) -> bool:
        """Determine if an error should be retried based on its type and context.

        Args:
            error: The exception that occurred
            retry_count: Current retry count

        Returns:
            True if the error should be retried, False otherwise
        """
        error_type = type(error).__name__
        error_message = str(error).lower()

        # Check for specific Playwright TargetClosedError
        if TargetClosedError and isinstance(error, TargetClosedError):
            self.logger.debug(f"Retrying TargetClosedError: {error_type}")
            return True

        # Never retry these errors (permanent failures)
        permanent_errors = [
            "permissionerror",
            "filenotfounderror",
            "valueerror",
            "typeerror"
        ]

        if error_type.lower() in permanent_errors:
            self.logger.debug(f"Not retrying permanent error: {error_type}")
            return False

        # Always retry these errors (transient failures)
        transient_errors = [
            "timeouterror",
            "connectionerror",
            "browsertimeouterror",
            "navigationerror",
            "playwrighttimeouterror",
            "targetclosederror"  # Add TargetClosedError to transient errors
        ]

        if error_type.lower() in transient_errors:
            return True

        # Check error message for specific patterns
        retry_patterns = [
            "timeout",
            "connection refused",
            "connection reset",
            "temporary failure",
            "resource temporarily unavailable",
            "browser context",
            "page closed",
            "target closed"  # Add pattern for target closed errors
        ]

        for pattern in retry_patterns:
            if pattern in error_message:
                return True

        # For unknown errors, retry if we haven't exceeded a conservative limit
        if retry_count < 3:
            self.logger.debug(f"Retrying unknown error type: {error_type}")
            return True

        return False

    async def execute(self, operation, *args, operation_name=None, **kwargs):
        """Execute an operation with retry logic and circuit breaker.

        Args:
            operation: Async function to execute
            *args: Arguments to pass to operation
            operation_name: Optional name for the operation (useful for lambda functions)
            **kwargs: Keyword arguments to pass to operation

        Returns:
            Result of the operation

        Raises:
            Exception: If operation fails after all retries or circuit breaker is open
        """
        retry_count = 0
        last_error = None
        self._stats["attempts"] += 1

        # Get operation name for logging
        if operation_name is None:
            # Try to get a meaningful name from the function
            operation_name = getattr(operation, "__name__", "unknown")

            # If it's a lambda, try to get a better name from the function's source
            if operation_name == "<lambda>":
                try:
                    import inspect
                    # Get the source code of the lambda function
                    source = inspect.getsource(operation)
                    # Extract the calling context from the source
                    # This will show something like 'retry_manager.execute(lambda: func(), ...'
                    operation_name = f"lambda_in_{source.split('(')[0].strip()}"
                except Exception:
                    # If we can't get source, use the module and line number if available
                    try:
                        module = inspect.getmodule(operation)
                        if module:
                            module_name = module.__name__
                            line_no = inspect.getsourcelines(operation)[1]
                            operation_name = f"lambda_at_{module_name}:{line_no}"
                    except Exception:
                        # Fall back to the original name
                        pass

        # Create context for logging
        context = {
            "operation": operation_name,
            "manager": self.name,
            "max_retries": self.retry_config.max_retries,
            "base_delay": self.retry_config.base_delay,
            "circuit_breaker": self.circuit_breaker is not None
        }

        self.logger.debug(f"Executing operation: {operation_name}", context)

        start_time = time.time()

        while retry_count <= self.retry_config.max_retries:
            # Check circuit breaker
            if self.circuit_breaker and not await self.circuit_breaker.can_execute():
                self._stats["circuit_breaker_rejections"] += 1
                circuit_state = self.circuit_breaker.get_state()

                # Check if this is a navigation operation (which tends to be problematic under load)
                is_navigation = operation_name and ("navigate" in operation_name.lower())

                # For navigation operations, we'll fail fast to prevent cascading failures
                if is_navigation:
                    self.logger.warning(
                        f"Circuit breaker is open for {self.name} - operation: {operation_name}",
                        {
                            "operation": operation_name,
                            "manager": self.name,
                            "circuit_state": circuit_state["state"],
                            "failure_count": circuit_state["failure_count"],
                            "threshold": circuit_state["threshold"]
                        }
                    )

                    # Use our custom error class for better error messages
                    from app.core.errors import CircuitBreakerOpenError
                    raise CircuitBreakerOpenError(
                        name=self.name,
                        context={**context, "circuit_state": circuit_state}
                    )
                else:
                    # For other operations, we'll try with limited retries
                    self.logger.warning(
                        f"Circuit breaker is open for {self.name}, but attempting operation: {operation_name} with limited retries",
                        {
                            "operation": operation_name,
                            "manager": self.name,
                            "circuit_state": circuit_state["state"],
                            "failure_count": circuit_state["failure_count"],
                            "threshold": circuit_state["threshold"]
                        }
                    )

                    # Limit max retries to 1 when circuit is open
                    original_max_retries = self.retry_config.max_retries
                    self.retry_config.max_retries = min(1, original_max_retries)

            attempt_start = time.time()
            attempt_number = retry_count + 1  # 1-based for logging

            try:
                # Log attempt
                if retry_count > 0:
                    self.logger.info(
                        f"Retry attempt {attempt_number}/{self.retry_config.max_retries + 1} for {operation_name}",
                        {**context, "attempt": attempt_number, "retry_count": retry_count}
                    )

                # Execute operation
                result = await operation(*args, **kwargs)

                # Record success
                if self.circuit_breaker:
                    await self.circuit_breaker.record_success()
                self._stats["successes"] += 1

                # Restore original max retries if it was modified due to circuit breaker
                if self.circuit_breaker and not await self.circuit_breaker.can_execute() and "original_max_retries" in locals():
                    self.retry_config.max_retries = original_max_retries

                # Log success
                duration = time.time() - attempt_start
                total_duration = time.time() - start_time

                log_level = "info" if retry_count > 0 else "debug"
                getattr(self.logger, log_level)(
                    f"Operation {operation_name} succeeded after {attempt_number} attempt(s)",
                    {
                        **context,
                        "attempt": attempt_number,
                        "duration": duration,
                        "total_duration": total_duration,
                        "retries": retry_count
                    }
                )

                return result
            except Exception as e:
                # Record failure
                if self.circuit_breaker:
                    await self.circuit_breaker.record_failure()

                # Restore original max retries if it was modified due to circuit breaker
                if "original_max_retries" in locals():
                    self.retry_config.max_retries = original_max_retries

                last_error = e
                duration = time.time() - attempt_start

                # Log failure
                error_context = {
                    **context,
                    "attempt": attempt_number,
                    "duration": duration,
                    "error_type": type(e).__name__,
                    "error": str(e)
                }

                # Check if we should retry based on error type and retry count
                should_retry = self._should_retry_error(e, retry_count)

                if retry_count >= self.retry_config.max_retries or not should_retry:
                    reason = "max retries reached" if retry_count >= self.retry_config.max_retries else "error not retryable"
                    self.logger.warning(
                        f"Final attempt {attempt_number} failed for {operation_name}, no more retries ({reason})",
                        {**error_context, "retry_reason": reason, "should_retry": should_retry}
                    )
                    break

                # Calculate delay before retry with adaptive strategy
                error_type = type(e).__name__
                delay = self.retry_config.get_delay(retry_count, error_type)

                self.logger.warning(
                    f"Attempt {attempt_number} failed for {operation_name}, retrying in {delay:.2f}s",
                    {**error_context, "next_delay": delay, "adaptive_error_type": error_type}
                )

                # Increment retry count and stats
                retry_count += 1
                self._stats["retries"] += 1

                # Wait before retry
                await asyncio.sleep(delay)

        # If we get here, all retries failed
        self._stats["failures"] += 1
        total_duration = time.time() - start_time

        self.logger.error(
            f"Operation {operation_name} failed after {retry_count} retries (total duration: {total_duration:.2f}s)",
            {
                **context,
                "total_duration": total_duration,
                "retries": retry_count,
                "error_type": type(last_error).__name__,
                "error": str(last_error)
            }
        )

        # Use our custom error class for better error messages
        from app.core.errors import MaxRetriesExceededError

        # Add more detailed context for debugging
        error_context = {
            **context,
            "total_duration": total_duration,
            "retries": retry_count,
            "last_error_type": type(last_error).__name__ if last_error else "Unknown",
            "last_error_message": str(last_error) if last_error else "No error details",
            "retry_config": self.retry_config.get_config(),
            "stats": self.get_stats()
        }

        # Log additional troubleshooting information
        self.logger.error(
            f"All retry attempts exhausted for {operation_name}. "
            f"Consider increasing max_retries (current: {self.retry_config.max_retries}) "
            f"or checking for underlying issues.",
            error_context
        )

        raise MaxRetriesExceededError(
            operation=operation_name,
            retries=retry_count,
            context=error_context,
            original_exception=last_error
        )

    def get_stats(self) -> Dict[str, Any]:
        """Get retry statistics.

        Returns:
            Dictionary with retry statistics
        """
        stats = self._stats.copy()

        # Add circuit breaker stats if available
        if self.circuit_breaker:
            stats["circuit_breaker"] = self.circuit_breaker.get_state()

        return stats
