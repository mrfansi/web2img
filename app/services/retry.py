import asyncio
import random
import time
from typing import Dict, Any, Optional


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
    
    def __init__(self, threshold: int, reset_time: int):
        """Initialize circuit breaker.
        
        Args:
            threshold: Number of failures before opening the circuit
            reset_time: Time in seconds before attempting to close the circuit
        """
        self.threshold = threshold
        self.reset_time = reset_time
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
    
    async def record_success(self):
        """Record a successful operation."""
        async with self._lock:
            if self.state == "half-open":
                self.state = "closed"
                self._stats["resets"] += 1
            self.failure_count = 0
            self._stats["successes"] += 1
    
    async def record_failure(self):
        """Record a failed operation."""
        async with self._lock:
            current_time = time.time()
            self._stats["failures"] += 1
            
            # Check if circuit breaker should reset due to time
            if self.state == "open" and current_time - self.last_failure_time > self.reset_time:
                self.state = "half-open"
                self.failure_count = 0
            
            # Increment failure count
            self.failure_count += 1
            self.last_failure_time = current_time
            
            # Check if threshold is reached
            if self.state == "closed" and self.failure_count >= self.threshold:
                self.state = "open"
                self._stats["trips"] += 1
    
    async def can_execute(self) -> bool:
        """Check if operation can be executed based on circuit breaker state.
        
        Returns:
            True if operation can be executed, False otherwise
        """
        async with self._lock:
            if self.state == "closed":
                return True
            elif self.state == "half-open":
                return True
            else:  # open
                current_time = time.time()
                if current_time - self.last_failure_time > self.reset_time:
                    self.state = "half-open"
                    return True
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
        
        while retry_count <= self.retry_config.max_retries:
            # Check circuit breaker
            if self.circuit_breaker and not await self.circuit_breaker.can_execute():
                self._stats["circuit_breaker_rejections"] += 1
                raise RuntimeError(f"Circuit breaker is open for {self.name}")
            
            try:
                # Execute operation
                result = await operation(*args, **kwargs)
                
                # Record success
                if self.circuit_breaker:
                    await self.circuit_breaker.record_success()
                self._stats["successes"] += 1
                
                return result
            except Exception as e:
                # Record failure
                if self.circuit_breaker:
                    await self.circuit_breaker.record_failure()
                
                last_error = e
                
                # Check if we should retry
                if retry_count >= self.retry_config.max_retries:
                    break
                
                # Calculate delay before retry
                delay = self.retry_config.get_delay(retry_count)
                
                # Increment retry count and stats
                retry_count += 1
                self._stats["retries"] += 1
                
                # Wait before retry
                await asyncio.sleep(delay)
        
        # If we get here, all retries failed
        self._stats["failures"] += 1
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
