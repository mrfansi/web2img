import asyncio
import time
from typing import Dict, Any, Optional, List, Callable, Awaitable, TypeVar, Union

from app.core.logging import get_logger


class RequestThrottle:
    """Request throttling mechanism to prevent overwhelming the system."""
    
    def __init__(self, max_concurrent: int = 10, queue_size: int = 50, name: str = "default"):
        """Initialize request throttle.
        
        Args:
            max_concurrent: Maximum number of concurrent requests allowed
            queue_size: Maximum size of the request queue
            name: Name for this throttle (for logging and metrics)
        """
        self.max_concurrent = max_concurrent
        self.queue_size = queue_size
        self.name = name
        self._active_count = 0
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._queue = asyncio.Queue(maxsize=queue_size)
        self._stats = {
            "total_requests": 0,
            "active_requests": 0,
            "queued_requests": 0,
            "rejected_requests": 0,
            "completed_requests": 0,
            "peak_active": 0,
            "peak_queued": 0
        }
        self.logger = get_logger(f"throttle.{name}")
    
    async def execute(self, operation: Callable[..., Awaitable[Any]], *args, **kwargs) -> Any:
        """Execute an operation with throttling.
        
        Args:
            operation: Async function to execute
            *args: Arguments to pass to operation
            **kwargs: Keyword arguments to pass to operation
            
        Returns:
            Result of the operation
            
        Raises:
            asyncio.QueueFull: If the queue is full and the request can't be queued
        """
        # Update stats
        self._stats["total_requests"] += 1
        
        # Check if we can acquire the semaphore immediately
        if self._semaphore.locked() and self._active_count >= self.max_concurrent:
            # Semaphore is fully locked, need to queue
            try:
                # Try to put a placeholder in the queue
                queue_start = time.time()
                self._stats["queued_requests"] += 1
                self._stats["peak_queued"] = max(self._stats["peak_queued"], self._stats["queued_requests"])
                
                self.logger.debug(f"Throttle {self.name} queueing request", {
                    "active_requests": self._active_count,
                    "queued_requests": self._stats["queued_requests"],
                    "max_concurrent": self.max_concurrent
                })
                
                # Wait for our turn (this will raise QueueFull if the queue is full)
                await self._queue.put(None)
                
                # Got through the queue, now wait for semaphore
                queue_time = time.time() - queue_start
                self._stats["queued_requests"] -= 1
                
                self.logger.debug(f"Throttle {self.name} request leaving queue after {queue_time:.2f}s", {
                    "queue_time": queue_time,
                    "active_requests": self._active_count,
                    "queued_requests": self._stats["queued_requests"]
                })
            except asyncio.QueueFull:
                # Queue is full, reject the request
                self._stats["rejected_requests"] += 1
                
                self.logger.warning(f"Throttle {self.name} rejecting request, queue full", {
                    "active_requests": self._active_count,
                    "queued_requests": self._stats["queued_requests"],
                    "queue_size": self.queue_size,
                    "max_concurrent": self.max_concurrent
                })
                
                raise
        
        # Acquire semaphore (this will wait if we're at max_concurrent)
        await self._semaphore.acquire()
        
        # Update active count and stats
        self._active_count += 1
        self._stats["active_requests"] = self._active_count
        self._stats["peak_active"] = max(self._stats["peak_active"], self._active_count)
        
        start_time = time.time()
        
        try:
            # Execute the operation
            result = await operation(*args, **kwargs)
            return result
        finally:
            # Always release the semaphore and update stats
            self._active_count -= 1
            self._stats["active_requests"] = self._active_count
            self._stats["completed_requests"] += 1
            self._semaphore.release()
            
            # If there are queued requests, let one through
            if not self._queue.empty():
                await self._queue.get()
                self._queue.task_done()
            
            # Log completion
            duration = time.time() - start_time
            self.logger.debug(f"Throttle {self.name} completed request in {duration:.2f}s", {
                "duration": duration,
                "active_requests": self._active_count,
                "queued_requests": self._stats["queued_requests"]
            })
    
    def get_stats(self) -> Dict[str, Any]:
        """Get throttle statistics.
        
        Returns:
            Dictionary with throttle statistics
        """
        return {
            "name": self.name,
            "max_concurrent": self.max_concurrent,
            "queue_size": self.queue_size,
            "active_requests": self._stats["active_requests"],
            "queued_requests": self._stats["queued_requests"],
            "total_requests": self._stats["total_requests"],
            "completed_requests": self._stats["completed_requests"],
            "rejected_requests": self._stats["rejected_requests"],
            "peak_active": self._stats["peak_active"],
            "peak_queued": self._stats["peak_queued"]
        }


# Import settings to access browser pool configuration
from app.core.config import settings

# Calculate throttle parameters based on browser pool size
# Use a percentage of the min_size for max_concurrent to ensure we don't overwhelm the pool
# but still utilize most of the capacity
MAX_CONCURRENT_RATIO = 0.8  # Use 80% of min_size for concurrent requests
QUEUE_SIZE_RATIO = 1.5     # Queue size is 1.5x the max_concurrent

# Create a singleton instance for screenshot requests with dynamic sizing
# Ensure throttle doesn't exceed browser pool capacity
calculated_max_concurrent = max(1, int(settings.browser_pool_min_size * MAX_CONCURRENT_RATIO))
if calculated_max_concurrent > settings.browser_pool_min_size:
    logger = get_logger("throttle.config")
    logger.warning(f"Throttle max_concurrent ({calculated_max_concurrent}) exceeds browser_pool_min_size ({settings.browser_pool_min_size})")

screenshot_throttle = RequestThrottle(
    max_concurrent=calculated_max_concurrent,
    queue_size=max(1, int(settings.browser_pool_min_size * MAX_CONCURRENT_RATIO * QUEUE_SIZE_RATIO)),
    name="screenshot"
)
