import asyncio
import time
import uuid
from typing import Dict, List, Any, Optional, Tuple, Set, AsyncGenerator
import httpx
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from app.models.job import job_store, BatchJob, JobItem, RecurrencePattern
from app.services.screenshot import capture_screenshot_with_options
from app.services.cache import cache_service
from app.core.logging import get_logger
from app.core.config import settings

logger = get_logger("batch_service")





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
        # Resource tracking for HTTP clients
        self._active_clients = set()
        self._client_lock = asyncio.Lock()

        # Job scheduler
        self.scheduler_task = None
        self.scheduler_running = False

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



    async def create_batch_job(self, items: List[Dict[str, Any]], config: Optional[Dict[str, Any]] = None, user_id: Optional[str] = None) -> BatchJob:
        """Create a new batch job and start processing it."""
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

    async def _initialize_job(self, job: BatchJob) -> Tuple[int, int, bool, bool, asyncio.Semaphore]:
        """Initialize a batch job for processing.

        Args:
            job: The batch job to initialize

        Returns:
            A tuple of (parallel, timeout, fail_fast, use_cache, semaphore)
        """
        # Mark job as processing
        job.start_processing()

        # Get configuration
        parallel = job.config.get("parallel", 3)
        timeout = job.config.get("timeout", 30)
        fail_fast = job.config.get("fail_fast", False)
        use_cache = job.config.get("cache", True)

        # Create a semaphore to limit concurrency
        semaphore = asyncio.Semaphore(parallel)

        return parallel, timeout, fail_fast, use_cache, semaphore

    async def _create_item_tasks(self, job: BatchJob, semaphore: asyncio.Semaphore,
                               timeout: int, use_cache: bool) -> List[asyncio.Task]:
        """Create tasks for all items in a batch job.

        Args:
            job: The batch job containing items
            semaphore: Semaphore to limit concurrency
            timeout: Timeout for screenshot capture in seconds
            use_cache: Whether to use caching

        Returns:
            A list of tasks for processing items
        """
        tasks = []
        for item_id, item in job.items.items():
            task = asyncio.create_task(
                self._process_item(job, item, semaphore, timeout, use_cache)
            )
            tasks.append(task)
        return tasks

    async def _process_tasks_fail_fast(self, tasks: List[asyncio.Task]) -> None:
        """Process tasks with fail-fast behavior.

        Args:
            tasks: The tasks to process
        """
        for future in asyncio.as_completed(tasks):
            item_id, success, error = await future
            if not success:
                # Cancel all remaining tasks
                for t in tasks:
                    if not t.done():
                        t.cancel()
                break

    async def _handle_job_cancellation(self, job: BatchJob) -> None:
        """Handle job cancellation.

        Args:
            job: The batch job that was cancelled
        """
        logger.info(f"Batch job {job.job_id} was cancelled")
        # Mark all pending items as failed
        for item_id, item in job.items.items():
            if item.status == "pending" or item.status == "processing":
                item.fail("Job cancelled")
        # Update job status
        job.status = "cancelled"
        job.update()

    async def _handle_job_error(self, job: BatchJob, error: Exception) -> None:
        """Handle job error.

        Args:
            job: The batch job that encountered an error
            error: The exception that occurred
        """
        logger.exception(f"Error processing batch job {job.job_id}: {str(error)}", {
            "job_id": job.job_id,
            "error": str(error),
            "error_type": type(error).__name__
        })
        # Mark all pending items as failed
        for item_id, item in job.items.items():
            if item.status == "pending" or item.status == "processing":
                item.fail(f"Job failed: {str(error)}")
        # Update job status
        job.update()

    async def _cleanup_job_resources(self, job: BatchJob) -> None:
        """Clean up resources for a batch job.

        Args:
            job: The batch job to clean up resources for
        """
        # Remove job from processing jobs
        if job.job_id in self.processing_jobs:
            del self.processing_jobs[job.job_id]

        # Remove user from active users if this was their job
        user_id = job.config.get("user_id")
        if user_id and user_id in self.active_users:
            self.active_users.remove(user_id)

    async def _process_batch_job(self, job: BatchJob) -> None:
        """Process a batch job.

        This method coordinates the processing of all items in a batch job,
        handling configuration, concurrency, error cases, and cleanup.

        Args:
            job: The batch job to process
        """
        try:
            # Initialize job
            parallel, timeout, fail_fast, use_cache, semaphore = await self._initialize_job(job)

            # Create tasks for all items
            tasks = await self._create_item_tasks(job, semaphore, timeout, use_cache)

            # Process all items
            if fail_fast:
                # If fail_fast is enabled, we need to stop on first failure
                await self._process_tasks_fail_fast(tasks)
            else:
                # Otherwise, wait for all tasks to complete
                await asyncio.gather(*tasks)

            # Update job status
            job.update()

            # Send webhook notification if configured
            await self._send_webhook_notification(job)

        except asyncio.CancelledError:
            await self._handle_job_cancellation(job)

        except Exception as e:
            await self._handle_job_error(job, e)

        finally:
            await self._cleanup_job_resources(job)

    async def _check_cache(self, item: JobItem) -> Optional[str]:
        """Check if a screenshot is available in the cache.

        Args:
            item: The job item to check cache for

        Returns:
            The cached URL if available, None otherwise
        """
        try:
            return await cache_service.get(
                url=str(item.request_data.get("url")),
                width=item.request_data.get("width", 1280),
                height=item.request_data.get("height", 720),
                format=item.request_data.get("format", "png")
            )
        except Exception as e:
            logger.warning(f"Cache lookup failed for item {item.id}: {str(e)}", {
                "item_id": item.id,
                "error": str(e),
                "error_type": type(e).__name__
            })
            return None

    async def _cache_result(self, item: JobItem, result: Dict[str, Any]) -> None:
        """Cache a screenshot result.

        Args:
            item: The job item to cache result for
            result: The screenshot result to cache
        """
        if "url" not in result or result["url"] is None:
            return

        try:
            await cache_service.set(
                url=item.request_data.get("url", ""),
                width=item.request_data.get("width", 1280),
                height=item.request_data.get("height", 720),
                format=item.request_data.get("format", "png"),
                imgproxy_url=str(result["url"])
            )
        except Exception as e:
            logger.warning(f"Failed to cache result for item {item.id}: {str(e)}", {
                "item_id": item.id,
                "error": str(e),
                "error_type": type(e).__name__
            })

    async def _capture_screenshot_with_retry(self, item: JobItem, timeout: int) -> Tuple[bool, Dict[str, Any], str]:
        """Capture a screenshot with retry logic.

        Args:
            item: The job item to capture screenshot for
            timeout: The timeout for the screenshot capture in seconds

        Returns:
            A tuple of (success, result, error_message)
        """
        max_retries = 3
        retry_count = 0
        retry_delay = 1.0  # Initial delay in seconds
        last_error = "Unknown error occurred"

        while retry_count < max_retries:
            try:
                # Use request queue for load management if enabled
                if settings.enable_request_queue:
                    try:
                        from app.services.request_queue import queue_manager, QueueStatus

                        # Generate unique request ID for this batch item
                        request_id = f"batch-{item.id}-{str(uuid.uuid4())[:8]}"

                        # Define the screenshot processing function
                        async def process_batch_screenshot():
                            return await asyncio.wait_for(
                                capture_screenshot_with_options(
                                    url=str(item.request_data.get("url")),
                                    width=item.request_data.get("width", 1280),
                                    height=item.request_data.get("height", 720),
                                    format=item.request_data.get("format", "png")
                                ),
                                timeout=timeout
                            )

                        # Submit to queue with batch priority (higher than normal requests)
                        status = await queue_manager.submit_request(
                            request_id=request_id,
                            handler=process_batch_screenshot,
                            priority=1,  # Higher priority for batch requests
                            timeout=settings.queue_timeout
                        )

                        # Handle queue response
                        if status == QueueStatus.REJECTED:
                            last_error = "Request rejected due to system overload"
                            logger.warning(f"Batch item {item.id} rejected by queue (attempt {retry_count+1}/{max_retries})")
                        elif status == QueueStatus.TIMEOUT:
                            last_error = "Request timed out in queue"
                            logger.warning(f"Batch item {item.id} timed out in queue (attempt {retry_count+1}/{max_retries})")
                        elif status in [QueueStatus.PROCESSED, QueueStatus.QUEUED]:
                            # Request was processed successfully
                            result = await process_batch_screenshot()
                            return True, result, ""
                        else:
                            # Fallback to direct processing
                            result = await process_batch_screenshot()
                            return True, result, ""

                    except ImportError:
                        # Queue manager not available, process directly
                        logger.debug(f"Request queue not available for batch item {item.id}, processing directly")
                        result = await asyncio.wait_for(
                            capture_screenshot_with_options(
                                url=str(item.request_data.get("url")),
                                width=item.request_data.get("width", 1280),
                                height=item.request_data.get("height", 720),
                                format=item.request_data.get("format", "png")
                            ),
                            timeout=timeout
                        )
                        return True, result, ""
                    except Exception as e:
                        logger.error(f"Error with request queue for batch item {item.id}: {e}")
                        # Fall back to direct processing
                        result = await asyncio.wait_for(
                            capture_screenshot_with_options(
                                url=str(item.request_data.get("url")),
                                width=item.request_data.get("width", 1280),
                                height=item.request_data.get("height", 720),
                                format=item.request_data.get("format", "png")
                            ),
                            timeout=timeout
                        )
                        return True, result, ""
                else:
                    # Queue disabled, process directly
                    result = await asyncio.wait_for(
                        capture_screenshot_with_options(
                            url=str(item.request_data.get("url")),
                            width=item.request_data.get("width", 1280),
                            height=item.request_data.get("height", 720),
                            format=item.request_data.get("format", "png")
                        ),
                        timeout=timeout
                    )
                    return True, result, ""

            except asyncio.TimeoutError:
                last_error = f"Screenshot capture timed out after {timeout} seconds"
                logger.warning(f"Timeout for batch item {item.id} (attempt {retry_count+1}/{max_retries}): {last_error}")

            except Exception as e:
                # Check if this is a browser context error that we should retry
                error_str = str(e)
                if "has been closed" in error_str or "Target page, context or browser has been closed" in error_str:
                    last_error = f"Browser context error: {error_str}"
                    logger.warning(f"Browser context error for item {item.id} (attempt {retry_count+1}/{max_retries}): {error_str}")
                else:
                    # Non-retryable error
                    last_error = f"Error processing item: {error_str}"
                    logger.exception(f"Error processing batch item {item.id}: {last_error}")
                    return False, {}, last_error

            # Increment retry count and apply backoff
            retry_count += 1
            if retry_count >= max_retries:
                break

            await asyncio.sleep(retry_delay)
            retry_delay *= 2  # Exponential backoff

        # If we've exhausted retries
        return False, {}, last_error

    async def _process_item(self, job: BatchJob, item: JobItem, semaphore: asyncio.Semaphore,
                            timeout: int, use_cache: bool) -> Tuple[str, bool, Optional[str]]:
        """Process a single item in a batch job.

        Args:
            job: The batch job containing the item
            item: The job item to process
            semaphore: Semaphore to limit concurrency
            timeout: Timeout for screenshot capture in seconds
            use_cache: Whether to use caching

        Returns:
            A tuple of (item_id, success, error_message)
        """
        async with semaphore:
            try:
                # Mark item as processing
                item.start_processing()
                job.update()

                # Check cache first if enabled
                if use_cache:
                    cached_url = await self._check_cache(item)
                    if cached_url:
                        # Use cached result
                        item.complete({"url": cached_url}, cached=True)
                        return item.id, True, None

                # Capture screenshot with retry logic
                success, result, error = await self._capture_screenshot_with_retry(item, timeout)

                if success:
                    # Cache the result if caching is enabled
                    if use_cache:
                        await self._cache_result(item, result)

                    # Mark item as completed
                    item.complete(result)
                    return item.id, True, None
                else:
                    # Mark item as failed
                    item.fail(error)
                    return item.id, False, error

            except Exception as e:
                error = f"Error processing item: {str(e)}"
                logger.exception(f"Error processing batch item {item.id}: {error}")
                item.fail(error)
                return item.id, False, error
            finally:
                # Update job status
                job.update()

    def _prepare_webhook_headers(self, webhook_auth: Optional[str] = None) -> Dict[str, str]:
        """Prepare headers for webhook notification.

        Args:
            webhook_auth: Optional authorization header value

        Returns:
            Dictionary of HTTP headers
        """
        headers = {
            "Content-Type": "application/json"
        }

        if webhook_auth:
            headers["Authorization"] = webhook_auth

        return headers

    def _log_webhook_attempt(self, job_id: str, webhook_url: str, payload: Dict[str, Any], has_auth: bool) -> None:
        """Log a webhook notification attempt.

        Args:
            job_id: The ID of the job
            webhook_url: The webhook URL
            payload: The payload to send
            has_auth: Whether authentication is being used
        """
        logger.info(f"Sending webhook notification for job {job_id}", {
            "job_id": job_id,
            "webhook_url": webhook_url,
            "payload_size": len(str(payload)),
            "has_auth": has_auth
        })

    def _log_webhook_response(self, job_id: str, webhook_url: str, response: httpx.Response) -> None:
        """Log a webhook notification response.

        Args:
            job_id: The ID of the job
            webhook_url: The webhook URL
            response: The HTTP response
        """
        # Log response with appropriate level based on status code
        if response.status_code >= 500:
            logger.error(f"Webhook notification failed for job {job_id} with server error", {
                "job_id": job_id,
                "webhook_url": webhook_url,
                "status_code": response.status_code,
                "response": response.text[:500]  # Limit response text to avoid huge logs
            })
        elif response.status_code >= 400:
            logger.warning(f"Webhook notification failed for job {job_id} with client error", {
                "job_id": job_id,
                "webhook_url": webhook_url,
                "status_code": response.status_code,
                "response": response.text[:500]  # Limit response text to avoid huge logs
            })
        else:
            logger.info(f"Webhook notification sent successfully for job {job_id}", {
                "job_id": job_id,
                "webhook_url": webhook_url,
                "status_code": response.status_code
            })

    def _log_webhook_error(self, job_id: str, webhook_url: str, error: Exception, error_type: str) -> None:
        """Log a webhook notification error.

        Args:
            job_id: The ID of the job
            webhook_url: The webhook URL
            error: The exception that occurred
            error_type: The type of error
        """
        if error_type == "TimeoutError":
            logger.error(f"Webhook notification timed out for job {job_id}", {
                "job_id": job_id,
                "webhook_url": webhook_url,
                "timeout": 15.0
            })
        elif error_type == "ConnectError":
            logger.error(f"Connection error sending webhook for job {job_id}", {
                "job_id": job_id,
                "webhook_url": webhook_url,
                "error": str(error),
                "error_type": error_type
            })
        elif error_type == "RequestError":
            logger.error(f"Request error sending webhook for job {job_id}", {
                "job_id": job_id,
                "webhook_url": webhook_url,
                "error": str(error),
                "error_type": error_type
            })
        else:
            logger.exception(f"Unexpected error sending webhook for job {job_id}", {
                "job_id": job_id,
                "webhook_url": webhook_url,
                "error": str(error),
                "error_type": error_type
            })

    async def _send_webhook_request(self, job_id: str, webhook_url: str, payload: Dict[str, Any],
                                  headers: Dict[str, str]) -> None:
        """Send a webhook notification request.

        Args:
            job_id: The ID of the job
            webhook_url: The webhook URL
            payload: The payload to send
            headers: The HTTP headers to use
        """
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

                    self._log_webhook_response(job_id, webhook_url, response)

                except asyncio.TimeoutError as e:
                    self._log_webhook_error(job_id, webhook_url, e, "TimeoutError")

        except httpx.ConnectError as e:
            self._log_webhook_error(job_id, webhook_url, e, "ConnectError")

        except httpx.RequestError as e:
            self._log_webhook_error(job_id, webhook_url, e, "RequestError")

        except Exception as e:
            self._log_webhook_error(job_id, webhook_url, e, type(e).__name__)

    async def _send_webhook_notification(self, job: BatchJob) -> None:
        """Send webhook notification if configured.

        Args:
            job: The batch job to send notification for
        """
        webhook_url = job.config.get("webhook")
        if not webhook_url:
            logger.debug(f"No webhook configured for job {job.job_id}")
            return

        webhook_auth = job.config.get("webhook_auth")

        # Prepare the payload and headers
        payload = job.get_results()
        headers = self._prepare_webhook_headers(webhook_auth)

        # Log webhook attempt
        self._log_webhook_attempt(job.job_id, webhook_url, payload, webhook_auth is not None)

        # Send the webhook notification
        await self._send_webhook_request(job.job_id, webhook_url, payload, headers)


# Create a singleton instance
batch_service = BatchService()

# Note: The scheduler will be started in the FastAPI startup event handler
# Do not start it here as there may not be an active event loop during module import
