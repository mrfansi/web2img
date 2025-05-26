import asyncio
import time
import uuid
from typing import Dict, List, Any, Optional, Tuple, Set, AsyncGenerator, ContextManager
import httpx
from datetime import datetime, timezone
from collections import defaultdict
from contextlib import asynccontextmanager

from app.models.job import job_store, BatchJob, JobItem, RecurrencePattern
from app.services.screenshot import capture_screenshot_with_options
from app.services.cache import cache_service
from app.core.logging import get_logger

logger = get_logger("batch_service")


class RateLimiter:
    """Rate limiter using token bucket algorithm."""
    
    def __init__(self, rate: float, per: float, burst: int = 1):
        """
        Initialize a rate limiter.
        
        Args:
            rate: Number of tokens to add per time period
            per: Time period in seconds
            burst: Maximum number of tokens that can be accumulated
        """
        self.rate = rate  # tokens per second
        self.per = per  # time period in seconds
        self.burst = burst  # maximum number of tokens
        self.tokens: float = float(burst)  # current number of tokens (as float for fractional tokens)
        self.last_update = time.time()  # last time tokens were added
    
    def update_tokens(self) -> None:
        """Update the number of tokens based on elapsed time."""
        now = time.time()
        elapsed = now - self.last_update
        self.last_update = now
        
        # Calculate tokens to add based on elapsed time
        tokens_to_add = elapsed * (self.rate / self.per)
        self.tokens = min(self.burst, self.tokens + tokens_to_add)
    
    async def acquire(self, tokens: float = 1.0) -> bool:
        """
        Acquire tokens from the bucket.
        
        Args:
            tokens: Number of tokens to acquire
            
        Returns:
            True if tokens were acquired, False otherwise
        """
        self.update_tokens()
        
        if self.tokens >= tokens:
            self.tokens -= tokens
            return True
        
        # Calculate how long to wait to get the required tokens
        wait_time = (tokens - self.tokens) * self.per / self.rate
        
        # If wait time is reasonable, wait and then acquire
        if wait_time <= 5.0:  # Max wait time of 5 seconds
            await asyncio.sleep(wait_time)
            self.tokens = 0  # Reset tokens after waiting
            return True
            
        return False


class BatchService:
    """Service for batch processing of screenshot requests."""
    
    def __init__(self):
        """Initialize the batch service."""
        # Dictionary to store active jobs
        self.active_jobs = {}
        # Dictionary to store processing jobs
        self.processing_jobs: Dict[str, asyncio.Task] = {}
        # Set to store active users
        self.active_users: Set[str] = set()
        # Lock for job operations
        self._lock = asyncio.Lock()
        # Rate limiter for job scheduling
        self._rate_limiter = RateLimiter(
            rate=10,  # 10 jobs
            per=60,   # per minute
            burst=20  # allow burst of up to 20 jobs
        )
        # Resource tracking for HTTP clients
        self._active_clients = set()
        self._client_lock = asyncio.Lock()
        
    @asynccontextmanager
    async def _http_client(self, timeout: float = 10.0) -> AsyncGenerator[httpx.AsyncClient, None]:
        """Context manager for HTTP clients to ensure proper resource management.
        
        This ensures that HTTP clients are properly closed even in case of exceptions,
        preventing resource leaks.
        
        Args:
            timeout: The timeout for HTTP requests in seconds
            
        Yields:
            An HTTP client that will be automatically closed
        """
        client = httpx.AsyncClient(timeout=timeout)
        
        # Track the client for cleanup
        async with self._client_lock:
            self._active_clients.add(client)
            
        try:
            yield client
        finally:
            # Always close the client, even if an exception occurs
            try:
                await client.aclose()
            except Exception as e:
                logger.warning(f"Error closing HTTP client: {str(e)}", {
                    "error": str(e),
                    "error_type": type(e).__name__
                })
            
            # Remove the client from tracking
            async with self._client_lock:
                self._active_clients.discard(client)
        
        # Rate limiting
        self.rate_limiters: Dict[str, RateLimiter] = {}
        self.default_rate_limiter = RateLimiter(rate=10, per=60, burst=20)  # 10 requests per minute, burst of 20
        
        # User rate limit tiers
        self.rate_limit_tiers = {
            "free": RateLimiter(rate=10, per=60, burst=20),      # 10 requests per minute
            "basic": RateLimiter(rate=30, per=60, burst=50),     # 30 requests per minute
            "premium": RateLimiter(rate=60, per=60, burst=100),   # 60 requests per minute
            "enterprise": RateLimiter(rate=120, per=60, burst=200)  # 120 requests per minute
        }
        
        # Job scheduler
        self.scheduler_task = None
        self.scheduler_running = False
        self.active_users: Set[str] = set()  # Track active users for rate limiting
    
    async def start_scheduler(self) -> None:
        """Start the job scheduler."""
        if self.scheduler_running:
            return
            
        self.scheduler_running = True
        self.scheduler_task = asyncio.create_task(self._run_scheduler())
        logger.info("Job scheduler started")
    
    async def stop_scheduler(self) -> None:
        """Stop the job scheduler."""
        if not self.scheduler_running:
            return
            
        self.scheduler_running = False
        if self.scheduler_task:
            self.scheduler_task.cancel()
            try:
                await self.scheduler_task
            except asyncio.CancelledError:
                pass
        logger.info("Job scheduler stopped")
    
    async def _run_scheduler(self) -> None:
        """Run the job scheduler."""
        try:
            while self.scheduler_running:
                # Check for scheduled jobs that are due
                due_jobs = job_store.get_due_scheduled_jobs()
                
                # Process each due job
                for job in due_jobs:
                    # Check if the job has a recurrence pattern
                    if job.recurrence_pattern != RecurrencePattern.NONE:
                        # Create a new job for the next recurrence
                        next_job = job.create_recurrence()
                        if next_job:
                            # Store the new job
                            job_store.jobs[next_job.job_id] = next_job
                            
                            # Add to scheduled queue
                            if next_job.scheduled_time:
                                logger.info(f"Scheduled recurring job {next_job.job_id} for {datetime.fromtimestamp(next_job.scheduled_time, tz=timezone.utc).isoformat()}")
                    
                    # Start processing the job
                    logger.info(f"Starting scheduled job {job.job_id}")
                    job.status = "pending"  # Change from scheduled to pending
                    task = asyncio.create_task(self._process_batch_job(job))
                    self.processing_jobs[job.job_id] = task
                
                # Sleep for a short time before checking again
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            logger.info("Job scheduler cancelled")
        except Exception as e:
            logger.exception(f"Error in job scheduler: {str(e)}")
            # Restart the scheduler after a delay
            await asyncio.sleep(5)
            self.scheduler_task = asyncio.create_task(self._run_scheduler())
    
    def get_rate_limiter(self, user_id: str) -> RateLimiter:
        """Get the rate limiter for a user."""
        # If user doesn't have a rate limiter, create one based on their tier
        if user_id not in self.rate_limiters:
            # In a real implementation, we would look up the user's tier
            # For now, we'll use the default rate limiter
            self.rate_limiters[user_id] = self.default_rate_limiter
            
        return self.rate_limiters[user_id]
    
    async def create_batch_job(self, items: List[Dict[str, Any]], config: Optional[Dict[str, Any]] = None, user_id: Optional[str] = None) -> BatchJob:
        """Create a new batch job and start processing it."""
        # Apply rate limiting if user_id is provided
        if user_id:
            rate_limiter = self.get_rate_limiter(user_id)
            
            # Try to acquire tokens for the batch job (1 token per item)
            tokens_needed = len(items)
            if not await rate_limiter.acquire(tokens_needed):
                raise Exception(f"Rate limit exceeded for user {user_id}")
            
            # Add user to active users
            self.active_users.add(user_id)
        
        # Create the job
        job = job_store.create_job(items, config)
        
        # If the job is scheduled for the future, don't start processing it now
        if job.status == "scheduled" and job.scheduled_time is not None:
            scheduled_time = datetime.fromtimestamp(float(job.scheduled_time), tz=timezone.utc).isoformat()
            logger.info(f"Job {job.job_id} scheduled for {scheduled_time}")
            
            # Make sure the scheduler is running
            if not self.scheduler_running:
                await self.start_scheduler()
                
            return job
        
        # Start processing the job asynchronously
        task = asyncio.create_task(self._process_batch_job(job))
        self.processing_jobs[job.job_id] = task
        
        # Return the job
        return job
    
    async def get_job_status(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get the status of a batch job."""
        job = job_store.get_job(job_id)
        if job:
            return job.get_status()
        return None
        
    async def schedule_job(self, job_id: str, scheduled_time: str) -> Optional[Dict[str, Any]]:
        """Schedule a job for future execution."""
        job = job_store.get_job(job_id)
        if not job:
            return None
            
        try:
            # Parse ISO format datetime string
            dt = datetime.fromisoformat(scheduled_time.replace('Z', '+00:00'))
            timestamp = float(dt.timestamp())  # Explicitly convert to float
            
            # Schedule the job
            success = job_store.schedule_job(job, timestamp)
            if success:
                # Make sure the scheduler is running
                if not self.scheduler_running:
                    await self.start_scheduler()
                    
                return job.get_status()
        except ValueError:
            # If parsing fails, return None
            logger.error(f"Failed to parse scheduled_time: {scheduled_time}")
            pass
            
        return None
        
    async def set_job_recurrence(self, job_id: str, pattern: str, interval: int = 1, count: int = 0, cron: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Set a job to recur with the specified pattern.
        
        Args:
            job_id: ID of the job to set recurrence for
            pattern: Recurrence pattern (none, hourly, daily, weekly, monthly, custom)
            interval: Interval for recurrence (e.g., every 2 days)
            count: Number of times to recur (0 means infinite)
            cron: Custom cron expression (only used with pattern=custom)
            
        Returns:
            Updated job status or None if job not found or pattern is invalid
        """
        job = job_store.get_job(job_id)
        if not job:
            return None
            
        try:
            # Set recurrence pattern
            if pattern is None:
                job.recurrence_pattern = None
            else:
                job.recurrence_pattern = RecurrencePattern(pattern)
            job.recurrence_interval = interval
            job.recurrence_count = count
            
            # Set custom cron expression if provided and pattern is custom
            if pattern == RecurrencePattern.CUSTOM.value and cron:
                job.recurrence_cron = cron
            
            # Calculate next scheduled time if the job is already scheduled
            if job.scheduled_time:
                job._calculate_next_scheduled_time()
                
            # Make sure the scheduler is running
            if not self.scheduler_running:
                await self.start_scheduler()
                
            return job.get_status()
        except ValueError as e:
            # If invalid pattern, log the error and return None
            logger.error(f"Invalid recurrence pattern for job {job_id}: {str(e)}")
            pass
            
        return None
    
    async def get_job_results(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get the results of a batch job."""
        job = job_store.get_job(job_id)
        if job:
            return job.get_results()
        return None
    
    async def cancel_job(self, job_id: str) -> bool:
        """Cancel a job that is processing or scheduled."""
        job = job_store.get_job(job_id)
        if not job:
            return False
            
        # If the job is processing, cancel the task
        if job.job_id in self.processing_jobs:
            self.processing_jobs[job.job_id].cancel()
            del self.processing_jobs[job.job_id]
            
        # If the job is scheduled, remove it from the scheduled queue
        if job.status == "scheduled":
            job_store.delete_job(job_id)
            return True
            
        # Mark all pending items as failed
        for item_id, item in job.items.items():
            if item.status == "pending" or item.status == "processing":
                item.fail("Job cancelled")
                
        # Update job status
        job.status = "cancelled"
        job.update()
        
        return True
    
    async def get_active_jobs(self) -> Dict[str, Any]:
        """Get all active jobs."""
        return {
            job_id: {
                "status": job.status,
                "progress": job.get_progress(),
                "created_at": job.created_at,
                "updated_at": job.updated_at,
                "scheduled_time": job.scheduled_time,
                "recurrence": job.recurrence
            }
            for job_id, job in self.active_jobs.items()
        }
        
    async def _cleanup_resources(self) -> Dict[str, int]:
        """Clean up tracked resources that may have been leaked.
        
        Returns:
            Dictionary with counts of cleaned up resources
        """
        cleanup_stats = {
            "http_clients": 0
        }
        
        # Clean up HTTP clients
        async with self._client_lock:
            clients_to_close = list(self._active_clients)
            for client in clients_to_close:
                try:
                    await asyncio.wait_for(client.aclose(), timeout=3.0)
                    cleanup_stats["http_clients"] += 1
                except Exception as e:
                    logger.warning(f"Error closing HTTP client during cleanup: {str(e)}", {
                        "error": str(e),
                        "error_type": type(e).__name__
                    })
                self._active_clients.discard(client)
        
        if cleanup_stats["http_clients"] > 0:
            logger.info(f"Cleaned up {cleanup_stats["http_clients"]} HTTP clients")
            
        return cleanup_stats
    
    async def shutdown(self):
        """Shutdown the batch service."""
        logger.info("Shutting down batch service")
        
        # Cancel all processing jobs
        for job_id, task in list(self.processing_jobs.items()):
            if not task.done():
                task.cancel()
                try:
                    await asyncio.wait_for(task, timeout=5.0)
                except asyncio.CancelledError:
                    logger.info(f"Cancelled job {job_id} during shutdown")
                except asyncio.TimeoutError:
                    logger.warning(f"Timeout waiting for job {job_id} to cancel during shutdown")
                except Exception as e:
                    logger.error(f"Error cancelling job {job_id} during shutdown: {str(e)}", {
                        "error": str(e),
                        "error_type": type(e).__name__,
                        "job_id": job_id
                    })
        
        # Clean up resources
        cleanup_stats = await self._cleanup_resources()
        
        # Clear all active jobs
        self.active_jobs.clear()
        self.processing_jobs.clear()
        self.active_users.clear()
        
        logger.info("Batch service shutdown complete", {
            "cleanup_stats": cleanup_stats
        })
    
    async def _process_batch_job(self, job: BatchJob) -> None:
        """Process a batch job."""
        try:
            # Mark job as processing
            job.start_processing()
            
            # Get configuration
            parallel = job.config.get("parallel", 3)
            timeout = job.config.get("timeout", 30)
            fail_fast = job.config.get("fail_fast", False)
            use_cache = job.config.get("cache", True)
            
            # Create a semaphore to limit concurrency
            semaphore = asyncio.Semaphore(parallel)
            
            # Create tasks for all items
            tasks = []
            for item_id, item in job.items.items():
                task = asyncio.create_task(
                    self._process_item(job, item, semaphore, timeout, use_cache)
                )
                tasks.append(task)
            
            # Process all items
            if fail_fast:
                # If fail_fast is enabled, we need to stop on first failure
                for future in asyncio.as_completed(tasks):
                    item_id, success, error = await future  # Use 'future' instead of 'task' to avoid type confusion
                    if not success:
                        # Cancel all remaining tasks
                        for t in tasks:
                            if not t.done():
                                t.cancel()
                        break
            else:
                # Otherwise, wait for all tasks to complete
                await asyncio.gather(*tasks)
            
            # Update job status
            job.update()
            
            # Send webhook notification if configured
            await self._send_webhook_notification(job)
            
        except asyncio.CancelledError:
            logger.info(f"Batch job {job.job_id} was cancelled")
            # Mark all pending items as failed
            for item_id, item in job.items.items():
                if item.status == "pending" or item.status == "processing":
                    item.fail("Job cancelled")
            # Update job status
            job.status = "cancelled"
            job.update()
            
        except Exception as e:
            logger.exception(f"Error processing batch job {job.job_id}: {str(e)}")
            # Mark all pending items as failed
            for item_id, item in job.items.items():
                if item.status == "pending" or item.status == "processing":
                    item.fail(f"Job failed: {str(e)}")
            # Update job status
            job.update()
        finally:
            # Remove job from processing jobs
            if job.job_id in self.processing_jobs:
                del self.processing_jobs[job.job_id]
                
            # Remove user from active users if this was their job
            user_id = job.config.get("user_id")
            if user_id and user_id in self.active_users:
                self.active_users.remove(user_id)
    
    async def _process_item(self, job: BatchJob, item: JobItem, semaphore: asyncio.Semaphore, 
                           timeout: int, use_cache: bool) -> Tuple[str, bool, Optional[str]]:
        """Process a single item in a batch job."""
        async with semaphore:
            try:
                # Mark item as processing
                item.start_processing()
                job.update()
                
                # Check cache first if enabled
                cached_url = None
                if use_cache:
                    cached_url = await cache_service.get(
                        url=str(item.request_data.get("url")),
                        width=item.request_data.get("width", 1280),
                        height=item.request_data.get("height", 720),
                        format=item.request_data.get("format", "png")
                    )
                
                if cached_url:
                    # Use cached result
                    item.complete({"url": cached_url}, cached=True)
                    return item.id, True, None
                
                # Capture screenshot with retry logic
                max_retries = 3
                retry_count = 0
                retry_delay = 1.0  # Initial delay in seconds
                last_error = "Unknown error occurred"
                
                while retry_count < max_retries:
                    try:
                        # Attempt to capture screenshot with timeout
                        result = await asyncio.wait_for(
                            capture_screenshot_with_options(
                                url=str(item.request_data.get("url")),
                                width=item.request_data.get("width", 1280),
                                height=item.request_data.get("height", 720),
                                format=item.request_data.get("format", "png")
                            ),
                            timeout=timeout
                        )
                        
                        # Cache the result if caching is enabled and URL is present
                        if use_cache and "url" in result and result["url"] is not None:
                            await cache_service.set(
                                url=item.request_data.get("url", ""),
                                width=item.request_data.get("width", 1280),
                                height=item.request_data.get("height", 720),
                                format=item.request_data.get("format", "png"),
                                imgproxy_url=str(result["url"])
                            )                      
                        # Mark item as completed
                        item.complete(result)
                        return item.id, True, None
                        
                    except asyncio.TimeoutError:
                        last_error = f"Screenshot capture timed out after {timeout} seconds"
                        logger.warning(f"Timeout for item {item.id} (attempt {retry_count+1}/{max_retries}): {last_error}")
                        retry_count += 1
                        if retry_count >= max_retries:
                            break
                        await asyncio.sleep(retry_delay)
                        retry_delay *= 2  # Exponential backoff
                        
                    except Exception as e:
                        # Check if this is a browser context error that we should retry
                        error_str = str(e)
                        if "has been closed" in error_str or "Target page, context or browser has been closed" in error_str:
                            last_error = f"Browser context error: {error_str}"
                            logger.warning(f"Browser context error for item {item.id} (attempt {retry_count+1}/{max_retries}): {error_str}")
                            retry_count += 1
                            if retry_count >= max_retries:
                                break
                            await asyncio.sleep(retry_delay)
                            retry_delay *= 2  # Exponential backoff
                        else:
                            # Non-retryable error
                            last_error = f"Error processing item: {error_str}"
                            logger.exception(f"Error processing batch item {item.id}: {last_error}")
                            item.fail(last_error)
                            return item.id, False, last_error
                
                # If we've exhausted retries, fail the item
                item.fail(last_error)
                return item.id, False, last_error
                
            except Exception as e:
                error = f"Error processing item: {str(e)}"
                logger.exception(f"Error processing batch item {item.id}: {error}")
                item.fail(error)
                return item.id, False, error
            finally:
                # Update job status
                job.update()
    
    async def _send_webhook_notification(self, job: BatchJob) -> None:
        """Send webhook notification if configured."""
        webhook_url = job.config.get("webhook")
        if not webhook_url:
            logger.debug(f"No webhook configured for job {job.job_id}")
            return
        
        webhook_auth = job.config.get("webhook_auth")
        
        # Prepare the payload
        payload = job.get_results()
        
        # Prepare headers with proper error handling
        headers = {
            "Content-Type": "application/json"
        }
        
        if webhook_auth:
            headers["Authorization"] = webhook_auth
        
        # Log webhook attempt with context
        logger.info(f"Sending webhook notification for job {job.job_id}", {
            "job_id": job.job_id,
            "webhook_url": webhook_url,
            "payload_size": len(str(payload)),
            "has_auth": webhook_auth is not None
        })
        
        try:
            # Send the webhook notification with proper timeout handling and resource management
            async with self._http_client(timeout=10.0) as client:
                try:
                    response = await asyncio.wait_for(
                        client.post(
                            webhook_url,
                            json=payload,
                            headers=headers
                        ),
                        timeout=15.0  # Overall timeout including connection time
                    )
                    
                    # Log response with appropriate level based on status code
                    if response.status_code >= 500:
                        logger.error(f"Webhook notification failed for job {job.job_id} with server error", {
                            "job_id": job.job_id,
                            "webhook_url": webhook_url,
                            "status_code": response.status_code,
                            "response": response.text[:500]  # Limit response text to avoid huge logs
                        })
                    elif response.status_code >= 400:
                        logger.warning(f"Webhook notification failed for job {job.job_id} with client error", {
                            "job_id": job.job_id,
                            "webhook_url": webhook_url,
                            "status_code": response.status_code,
                            "response": response.text[:500]  # Limit response text to avoid huge logs
                        })
                    else:
                        logger.info(f"Webhook notification sent successfully for job {job.job_id}", {
                            "job_id": job.job_id,
                            "webhook_url": webhook_url,
                            "status_code": response.status_code
                        })
                except asyncio.TimeoutError:
                    logger.error(f"Webhook notification timed out for job {job.job_id}", {
                        "job_id": job.job_id,
                        "webhook_url": webhook_url,
                        "timeout": 15.0
                    })
        except httpx.ConnectError as e:
            logger.error(f"Connection error sending webhook for job {job.job_id}", {
                "job_id": job.job_id,
                "webhook_url": webhook_url,
                "error": str(e),
                "error_type": "ConnectError"
            })
        except httpx.RequestError as e:
            logger.error(f"Request error sending webhook for job {job.job_id}", {
                "job_id": job.job_id,
                "webhook_url": webhook_url,
                "error": str(e),
                "error_type": "RequestError"
            })
        except Exception as e:
            logger.exception(f"Unexpected error sending webhook for job {job.job_id}", {
                "job_id": job.job_id,
                "webhook_url": webhook_url,
                "error": str(e),
                "error_type": type(e).__name__
            })


# Create a singleton instance
batch_service = BatchService()

# Note: The scheduler will be started in the FastAPI startup event handler
# Do not start it here as there may not be an active event loop during module import
