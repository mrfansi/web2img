import asyncio
import random
import time
from typing import Dict, Any, Optional, Callable

from app.core.logging import get_logger


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
    
    def get_delay(self, retry_count: int) -> float:
        """Calculate delay with exponential backoff and jitter.
        
        Args:
            retry_count: Current retry attempt (0-based)
            
        Returns:
            Delay in seconds before next retry
        """
        # Calculate exponential backoff
        delay = min(self.max_delay, self.base_delay * (2 ** retry_count))
        
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
            previous_state = self.state
            current_time = time.time()
            
            if self.state == "closed":
                self.logger.debug(
                    f"Circuit breaker {self.name} allowing execution (state: closed)",
                    {"state": self.state}
                )
                return True
            elif self.state == "half-open":
                self.logger.debug(
                    f"Circuit breaker {self.name} allowing execution (state: half-open)",
                    {"state": self.state}
                )
                return True
            else:  # open
                elapsed = current_time - self.last_failure_time
                
                if elapsed > self.reset_time:
                    self.state = "half-open"
                    
                    # Log state transition
                    self.logger.info(
                        f"Circuit breaker {self.name} state changed: {previous_state} -> {self.state} (reset time elapsed)",
                        {
                            "previous_state": previous_state,
                            "new_state": self.state,
                            "reason": "reset_time_elapsed",
                            "elapsed_time": elapsed,
                            "reset_time": self.reset_time
                        }
                    )
                    return True
                
                # Still open, log rejection
                self.logger.debug(
                    f"Circuit breaker {self.name} blocking execution (state: open)",
                    {
                        "state": self.state,
                        "elapsed_time": elapsed,
                        "reset_time": self.reset_time,
                        "remaining_time": self.reset_time - elapsed
                    }
                )
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
    
    async def execute(self, operation, *args, **kwargs):
        """Execute an operation with retry logic and circuit breaker.
        
        Args:
            operation: Async function to execute
            *args: Arguments to pass to operation
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
        operation_name = getattr(operation, "__name__", "unknown")
        
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
                
                self.logger.warning(
                    f"Circuit breaker is open for {self.name}", 
                    {**context, "circuit_state": circuit_state}
                )
                
                raise RuntimeError(f"Circuit breaker is open for {self.name}")
            
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
                
                # Check if we should retry
                if retry_count >= self.retry_config.max_retries:
                    self.logger.warning(
                        f"Final attempt {attempt_number} failed for {operation_name}, no more retries",
                        error_context
                    )
                    break
                
                # Calculate delay before retry
                delay = self.retry_config.get_delay(retry_count)
                
                self.logger.warning(
                    f"Attempt {attempt_number} failed for {operation_name}, retrying in {delay:.2f}s",
                    {**error_context, "next_delay": delay}
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
        
        raise RuntimeError(f"Operation failed after {retry_count} retries: {str(last_error)}") from last_error
    
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
