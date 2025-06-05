"""
Request Queue Manager for handling extreme load scenarios.
Implements queuing, load shedding, and emergency management.
"""

import asyncio
import time
import logging
from typing import Optional, Dict, Any, Callable, Awaitable
from dataclasses import dataclass
from enum import Enum

from app.core.config import settings


class QueueStatus(Enum):
    """Queue status enumeration."""
    ACCEPTED = "accepted"
    QUEUED = "queued"
    REJECTED = "rejected"
    TIMEOUT = "timeout"
    PROCESSED = "processed"


@dataclass
class QueuedRequest:
    """Represents a queued request."""
    request_id: str
    handler: Callable[[], Awaitable[Any]]
    queued_at: float
    priority: int = 0
    timeout: float = 60.0


class RequestQueueManager:
    """Manages request queuing and load shedding for extreme load scenarios."""
    
    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=settings.max_queue_size)
        self.processing_semaphore = asyncio.Semaphore(settings.max_concurrent_screenshots)
        self.stats = {
            "total_requests": 0,
            "queued_requests": 0,
            "rejected_requests": 0,
            "timeout_requests": 0,
            "processed_requests": 0,
            "current_queue_size": 0,
            "max_queue_size_reached": 0,
            "average_queue_time": 0.0
        }
        self.queue_times = []
        self.max_queue_time_samples = 100
        self._cleanup_task: Optional[asyncio.Task] = None
        self._processing_task: Optional[asyncio.Task] = None
        
    async def initialize(self):
        """Initialize the queue manager."""
        if settings.enable_request_queue:
            self.logger.info("Initializing request queue manager", {
                "max_queue_size": settings.max_queue_size,
                "queue_timeout": settings.queue_timeout,
                "max_concurrent": settings.max_concurrent_screenshots,
                "load_shedding_enabled": settings.enable_load_shedding,
                "load_shedding_threshold": settings.load_shedding_threshold
            })
            
            # Start background tasks
            self._cleanup_task = asyncio.create_task(self._cleanup_expired_requests())
            self._processing_task = asyncio.create_task(self._process_queue())
        else:
            self.logger.info("Request queue manager disabled")
    
    async def shutdown(self):
        """Shutdown the queue manager."""
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
        
        if self._processing_task:
            self._processing_task.cancel()
            try:
                await self._processing_task
            except asyncio.CancelledError:
                pass
        
        self.logger.info("Request queue manager shutdown completed")
    
    async def submit_request(self, request_id: str, handler: Callable[[], Awaitable[Any]], 
                           priority: int = 0, timeout: float = None) -> QueueStatus:
        """Submit a request for processing."""
        if not settings.enable_request_queue:
            # Queue disabled - process directly
            try:
                async with self.processing_semaphore:
                    await handler()
                return QueueStatus.PROCESSED
            except Exception:
                return QueueStatus.REJECTED
        
        self.stats["total_requests"] += 1
        
        # Check if we should shed load
        if settings.enable_load_shedding and self._should_shed_load():
            self.stats["rejected_requests"] += 1
            self.logger.warning(f"Load shedding: Rejecting request {request_id}")
            return QueueStatus.REJECTED
        
        # Try to add to queue
        timeout = timeout or settings.queue_timeout
        queued_request = QueuedRequest(
            request_id=request_id,
            handler=handler,
            queued_at=time.time(),
            priority=priority,
            timeout=timeout
        )
        
        try:
            self.queue.put_nowait(queued_request)
            self.stats["queued_requests"] += 1
            self.stats["current_queue_size"] = self.queue.qsize()
            
            if self.queue.qsize() > self.stats["max_queue_size_reached"]:
                self.stats["max_queue_size_reached"] = self.queue.qsize()
            
            self.logger.debug(f"Request {request_id} queued", {
                "queue_size": self.queue.qsize(),
                "priority": priority
            })
            
            return QueueStatus.QUEUED
            
        except asyncio.QueueFull:
            self.stats["rejected_requests"] += 1
            self.logger.warning(f"Queue full: Rejecting request {request_id}", {
                "queue_size": self.queue.qsize(),
                "max_queue_size": settings.max_queue_size
            })
            return QueueStatus.REJECTED
    
    def _should_shed_load(self) -> bool:
        """Determine if we should shed load based on current conditions."""
        # Check queue utilization
        queue_utilization = self.queue.qsize() / settings.max_queue_size
        
        if queue_utilization >= settings.load_shedding_threshold:
            return True
        
        # Check processing capacity
        available_slots = self.processing_semaphore._value
        total_slots = settings.max_concurrent_screenshots
        processing_utilization = (total_slots - available_slots) / total_slots
        
        if processing_utilization >= settings.load_shedding_threshold:
            return True
        
        return False
    
    async def _process_queue(self):
        """Background task to process queued requests."""
        while True:
            try:
                # Get request from queue
                queued_request = await self.queue.get()
                self.stats["current_queue_size"] = self.queue.qsize()
                
                # Check if request has expired
                current_time = time.time()
                queue_time = current_time - queued_request.queued_at
                
                if queue_time > queued_request.timeout:
                    self.stats["timeout_requests"] += 1
                    self.logger.warning(f"Request {queued_request.request_id} timed out in queue", {
                        "queue_time": queue_time,
                        "timeout": queued_request.timeout
                    })
                    self.queue.task_done()
                    continue
                
                # Process the request
                try:
                    async with self.processing_semaphore:
                        await queued_request.handler()
                    
                    self.stats["processed_requests"] += 1
                    
                    # Update queue time statistics
                    self.queue_times.append(queue_time)
                    if len(self.queue_times) > self.max_queue_time_samples:
                        self.queue_times = self.queue_times[-self.max_queue_time_samples:]
                    
                    self.stats["average_queue_time"] = sum(self.queue_times) / len(self.queue_times)
                    
                    self.logger.debug(f"Request {queued_request.request_id} processed", {
                        "queue_time": queue_time,
                        "queue_size": self.queue.qsize()
                    })
                    
                except Exception as e:
                    self.logger.error(f"Error processing request {queued_request.request_id}: {str(e)}")
                
                self.queue.task_done()
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error(f"Error in queue processing: {str(e)}")
                await asyncio.sleep(1)
    
    async def _cleanup_expired_requests(self):
        """Background task to clean up expired requests."""
        while True:
            try:
                await asyncio.sleep(settings.emergency_cleanup_interval)
                
                # Log current stats
                if self.queue.qsize() > 0:
                    self.logger.info("Queue status", {
                        "current_queue_size": self.queue.qsize(),
                        "total_requests": self.stats["total_requests"],
                        "processed_requests": self.stats["processed_requests"],
                        "rejected_requests": self.stats["rejected_requests"],
                        "timeout_requests": self.stats["timeout_requests"],
                        "average_queue_time": round(self.stats["average_queue_time"], 2),
                        "processing_slots_available": self.processing_semaphore._value
                    })
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error(f"Error in cleanup task: {str(e)}")
    
    def get_stats(self) -> Dict[str, Any]:
        """Get current queue statistics."""
        return {
            **self.stats,
            "current_queue_size": self.queue.qsize(),
            "processing_slots_available": self.processing_semaphore._value,
            "processing_slots_total": settings.max_concurrent_screenshots,
            "load_shedding_active": self._should_shed_load()
        }


# Global queue manager instance
queue_manager = RequestQueueManager()
