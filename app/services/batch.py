import asyncio
import logging
import time
from typing import Dict, List, Any, Optional, Tuple
import httpx

from app.models.job import job_store, BatchJob, JobItem
from app.services.screenshot import capture_screenshot_with_options
from app.services.cache import cache_service

logger = logging.getLogger(__name__)


class BatchService:
    """Service for batch processing of screenshot requests."""
    
    def __init__(self):
        self.processing_jobs: Dict[str, asyncio.Task] = {}
    
    async def create_batch_job(self, items: List[Dict[str, Any]], config: Optional[Dict[str, Any]] = None) -> BatchJob:
        """Create a new batch job and start processing it."""
        # Create the job
        job = job_store.create_job(items, config)
        
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
    
    async def get_job_results(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get the results of a batch job."""
        job = job_store.get_job(job_id)
        if job:
            return job.get_results()
        return None
    
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
                for task in asyncio.as_completed(tasks):
                    item_id, success, error = await task
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
    
    async def _process_item(self, job: BatchJob, item: JobItem, semaphore: asyncio.Semaphore, 
                           timeout: int, use_cache: bool) -> Tuple[str, bool, Optional[str]]:
        """Process a single item in a batch job."""
        async with semaphore:
            try:
                # Mark item as processing
                item.start_processing()
                
                # Update job status
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
                
                # Capture screenshot with timeout
                try:
                    result = await asyncio.wait_for(
                        capture_screenshot_with_options(
                            url=str(item.request_data.get("url")),
                            width=item.request_data.get("width", 1280),
                            height=item.request_data.get("height", 720),
                            format=item.request_data.get("format", "png")
                        ),
                        timeout=timeout
                    )
                    
                    # Store in cache if enabled
                    if use_cache:
                        await cache_service.set(
                            url=str(item.request_data.get("url")),
                            width=item.request_data.get("width", 1280),
                            height=item.request_data.get("height", 720),
                            format=item.request_data.get("format", "png"),
                            imgproxy_url=result.get("url")
                        )
                    
                    # Mark item as completed
                    item.complete(result)
                    return item.id, True, None
                    
                except asyncio.TimeoutError:
                    error = f"Screenshot capture timed out after {timeout} seconds"
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
    
    async def _send_webhook_notification(self, job: BatchJob) -> None:
        """Send webhook notification if configured."""
        webhook_url = job.config.get("webhook")
        if not webhook_url:
            return
        
        webhook_auth = job.config.get("webhook_auth")
        
        try:
            # Prepare the payload
            payload = job.get_results()
            
            # Prepare headers
            headers = {
                "Content-Type": "application/json"
            }
            
            if webhook_auth:
                headers["Authorization"] = webhook_auth
            
            # Send the webhook notification
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    webhook_url,
                    json=payload,
                    headers=headers,
                    timeout=10.0
                )
                
                if response.status_code >= 400:
                    logger.error(
                        f"Webhook notification failed for job {job.job_id}: "
                        f"Status code {response.status_code}, Response: {response.text}"
                    )
                else:
                    logger.info(f"Webhook notification sent for job {job.job_id}")
                    
        except Exception as e:
            logger.exception(f"Error sending webhook notification for job {job.job_id}: {str(e)}")


# Create a singleton instance
batch_service = BatchService()
