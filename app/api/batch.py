from typing import Dict, Any, Optional

from fastapi import APIRouter, HTTPException, Path, Header, Depends
from pydantic import ValidationError

from app.schemas.batch import (
    BatchScreenshotRequest, 
    BatchScreenshotResponse, 
    BatchJobStatusResponse,
    ScheduleJobRequest,
    RecurrenceRequest,
    BatchJobListResponse
)
from app.services.batch import batch_service
from app.core.errors import (
    WebToImgError,
    get_error_response,
    HTTP_200_OK,
    HTTP_400_BAD_REQUEST,
    HTTP_404_NOT_FOUND,
    HTTP_202_ACCEPTED,
    HTTP_500_INTERNAL_SERVER_ERROR,
    HTTP_503_SERVICE_UNAVAILABLE,
    HTTP_429_TOO_MANY_REQUESTS
)
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("batch_api")

router = APIRouter(tags=["batch"])

# Simple user ID extraction from header for rate limiting
async def get_user_id(x_api_key: Optional[str] = Header(None)) -> Optional[str]:
    """Extract user ID from API key header."""
    if not x_api_key:
        return None
    # In a real implementation, we would validate the API key and look up the user
    # For now, we'll just use the API key as the user ID
    return x_api_key


@router.post(
    "/batch/screenshots",
    response_model=BatchJobStatusResponse,
    status_code=HTTP_202_ACCEPTED,
    summary="Create a batch screenshot job",
    description="Submit multiple screenshot requests to be processed as a batch"
)
async def create_batch_job(
    request: BatchScreenshotRequest, 
    user_id: Optional[str] = Depends(get_user_id)
) -> Dict[str, Any]:
    """Create a batch job for processing multiple screenshot requests.
    
    This endpoint allows you to submit multiple screenshot requests to be processed as a batch.
    The batch job will be processed asynchronously, and you can check the status of the job
    using the returned job ID.
    
    The batch job can be configured with the following options:
    - parallel: Maximum number of screenshots to process in parallel (default: 3, max: 10)
    - timeout: Timeout in seconds for each screenshot (default: 30, max: 60)
    - webhook: Webhook URL to call when batch processing is complete
    - webhook_auth: Authorization header value for webhook
    - fail_fast: Whether to stop processing on first failure (default: false)
    - cache: Whether to use cache for screenshots (default: true)
    
    Returns a job ID that can be used to check the status of the batch job.
    """
    try:
        # Check system load and apply load shedding if enabled
        if settings.enable_load_shedding:
            try:
                from app.services.request_queue import queue_manager

                # Check if system is overloaded
                if queue_manager._should_shed_load():
                    logger.warning(f"Rejecting batch job due to system overload (user: {user_id})")
                    raise HTTPException(
                        status_code=HTTP_503_SERVICE_UNAVAILABLE,
                        detail={
                            "error": "service_overloaded",
                            "message": "Service is currently overloaded. Please try again later.",
                            "retry_after": 60
                        }
                    )

                # Check batch size limits under high load
                queue_stats = queue_manager.get_stats()
                if queue_stats.get("load_shedding_active", False):
                    max_batch_size = 10  # Reduced batch size under load
                    if len(request.items) > max_batch_size:
                        logger.warning(f"Rejecting large batch job under load (size: {len(request.items)}, user: {user_id})")
                        raise HTTPException(
                            status_code=HTTP_429_TOO_MANY_REQUESTS,
                            detail={
                                "error": "batch_too_large",
                                "message": f"Batch size too large under current load. Maximum allowed: {max_batch_size}",
                                "max_batch_size": max_batch_size,
                                "retry_after": 30
                            }
                        )

            except ImportError:
                # Queue manager not available, proceed normally
                logger.debug("Request queue not available for batch load checking")
            except Exception as e:
                logger.error(f"Error checking system load for batch job: {e}")
                # Continue with batch creation on error

        # Create a batch job
        items = [item.model_dump() for item in request.items]
        config = request.config.model_dump() if request.config else {}

        # Add user_id to config for tracking
        if user_id:
            config["user_id"] = user_id

        # Log batch job creation
        logger.info(f"Creating batch job with {len(items)} items (user: {user_id})")

        job = await batch_service.create_batch_job(items, config, user_id)
        
        # Return the job status
        return job.get_status()
        
    except ValidationError as e:
        raise HTTPException(
            status_code=HTTP_400_BAD_REQUEST,
            detail=f"Invalid request: {str(e)}"
        )
    except Exception as e:
        # If it's already one of our custom errors, just re-raise it
        if isinstance(e, WebToImgError):
            raise
        
        # Otherwise, convert to an appropriate error response
        error_dict = get_error_response(e)
        
        # Raise HTTPException with the detailed error information
        raise HTTPException(
            status_code=error_dict.get("http_status", HTTP_500_INTERNAL_SERVER_ERROR),
            detail=error_dict
        )


@router.get(
    "/batch/screenshots/{job_id}",
    response_model=BatchJobStatusResponse,
    status_code=HTTP_200_OK,
    summary="Get batch job status",
    description="Get the status of a batch screenshot job"
)
async def get_batch_job_status(job_id: str = Path(..., description="Batch job ID")) -> Dict[str, Any]:
    """Get the status of a batch screenshot job.
    
    This endpoint allows you to check the status of a batch job that was previously submitted.
    The status includes information about the job's progress, such as the number of completed
    items and the estimated completion time.
    
    Returns the job status, including the job ID, status, total items, completed items,
    failed items, and timestamps.
    """
    try:
        # Get the job status
        job_status = await batch_service.get_job_status(job_id)
        
        if not job_status:
            raise HTTPException(
                status_code=HTTP_404_NOT_FOUND,
                detail=f"Batch job not found: {job_id}"
            )
        
        return job_status
        
    except HTTPException:
        raise
    except Exception as e:
        # If it's already one of our custom errors, just re-raise it
        if isinstance(e, WebToImgError):
            raise
        
        # Otherwise, convert to an appropriate error response
        error_dict = get_error_response(e)
        
        # Raise HTTPException with the detailed error information
        raise HTTPException(
            status_code=error_dict.get("http_status", HTTP_500_INTERNAL_SERVER_ERROR),
            detail=error_dict
        )


@router.post(
    "/batch/screenshots/{job_id}/schedule",
    response_model=BatchJobStatusResponse,
    status_code=HTTP_202_ACCEPTED,
    summary="Schedule a batch job",
    description="Schedule a batch job for future execution"
)
async def schedule_batch_job(
    request: ScheduleJobRequest,
    job_id: str = Path(..., description="Batch job ID")
) -> Dict[str, Any]:
    """Schedule a batch job for future execution.
    
    This endpoint allows you to schedule a batch job to be executed at a specific time in the future.
    The job must already exist and be in a pending state.
    
    Returns the updated job status, including the scheduled time.
    """
    try:
        # Schedule the job
        job_status = await batch_service.schedule_job(job_id, request.scheduled_time)
        
        if not job_status:
            raise HTTPException(
                status_code=HTTP_404_NOT_FOUND,
                detail=f"Batch job not found or could not be scheduled: {job_id}"
            )
        
        return job_status
        
    except HTTPException:
        raise
    except Exception as e:
        # If it's already one of our custom errors, just re-raise it
        if isinstance(e, WebToImgError):
            raise
        
        # Otherwise, convert to an appropriate error response
        error_dict = get_error_response(e)
        
        # Raise HTTPException with the detailed error information
        raise HTTPException(
            status_code=error_dict.get("http_status", HTTP_500_INTERNAL_SERVER_ERROR),
            detail=error_dict
        )


@router.post(
    "/batch/screenshots/{job_id}/recurrence",
    response_model=BatchJobStatusResponse,
    status_code=HTTP_202_ACCEPTED,
    summary="Set job recurrence",
    description="Set a job to recur with the specified pattern"
)
async def set_job_recurrence(
    request: RecurrenceRequest,
    job_id: str = Path(..., description="Batch job ID")
) -> Dict[str, Any]:
    """Set a job to recur with the specified pattern.
    
    This endpoint allows you to set a job to recur with a specified pattern, such as hourly, daily, weekly, or monthly.
    The job must already exist and be in a scheduled state.
    
    Returns the updated job status, including the recurrence pattern and next scheduled time.
    """
    try:
        # Set job recurrence
        job_status = await batch_service.set_job_recurrence(
            job_id, 
            request.pattern, 
            request.interval, 
            request.count,
            request.cron
        )
        
        if not job_status:
            raise HTTPException(
                status_code=HTTP_404_NOT_FOUND,
                detail=f"Batch job not found or could not set recurrence: {job_id}"
            )
        
        return job_status
        
    except HTTPException:
        raise
    except Exception as e:
        # If it's already one of our custom errors, just re-raise it
        if isinstance(e, WebToImgError):
            raise
        
        # Otherwise, convert to an appropriate error response
        error_dict = get_error_response(e)
        
        # Raise HTTPException with the detailed error information
        raise HTTPException(
            status_code=error_dict.get("http_status", HTTP_500_INTERNAL_SERVER_ERROR),
            detail=error_dict
        )


@router.post(
    "/batch/screenshots/{job_id}/cancel",
    response_model=BatchJobStatusResponse,
    status_code=HTTP_200_OK,
    summary="Cancel a batch job",
    description="Cancel a batch job that is processing or scheduled"
)
async def cancel_batch_job(
    job_id: str = Path(..., description="Batch job ID")
) -> Dict[str, Any]:
    """Cancel a batch job that is processing or scheduled.
    
    This endpoint allows you to cancel a batch job that is currently processing or scheduled for future execution.
    Any pending items in the job will be marked as failed with a cancellation message.
    
    Returns the updated job status.
    """
    try:
        # Cancel the job
        success = await batch_service.cancel_job(job_id)
        
        if not success:
            raise HTTPException(
                status_code=HTTP_404_NOT_FOUND,
                detail=f"Batch job not found or could not be cancelled: {job_id}"
            )
        
        # Get the updated job status
        job_status = await batch_service.get_job_status(job_id)
        
        if not job_status:
            raise HTTPException(
                status_code=HTTP_404_NOT_FOUND,
                detail=f"Batch job not found: {job_id}"
            )
        
        return job_status
        
    except HTTPException:
        raise
    except Exception as e:
        # If it's already one of our custom errors, just re-raise it
        if isinstance(e, WebToImgError):
            raise
        
        # Otherwise, convert to an appropriate error response
        error_dict = get_error_response(e)
        
        # Raise HTTPException with the detailed error information
        raise HTTPException(
            status_code=error_dict.get("http_status", HTTP_500_INTERNAL_SERVER_ERROR),
            detail=error_dict
        )


@router.get(
    "/batch/screenshots/active",
    response_model=BatchJobListResponse,
    status_code=HTTP_200_OK,
    summary="Get active batch jobs",
    description="Get all active batch jobs (processing or scheduled)"
)
async def get_active_batch_jobs() -> Dict[str, Any]:
    """Get all active batch jobs (processing or scheduled).
    
    This endpoint allows you to retrieve a list of all batch jobs that are currently processing or scheduled for future execution.
    
    Returns a list of job statuses.
    """
    try:
        # Get active jobs
        active_jobs = await batch_service.get_active_jobs()
        
        return {"jobs": active_jobs}
        
    except Exception as e:
        # If it's already one of our custom errors, just re-raise it
        if isinstance(e, WebToImgError):
            raise
        
        # Otherwise, convert to an appropriate error response
        error_dict = get_error_response(e)
        
        # Raise HTTPException with the detailed error information
        raise HTTPException(
            status_code=error_dict.get("http_status", HTTP_500_INTERNAL_SERVER_ERROR),
            detail=error_dict
        )


@router.get(
    "/batch/screenshots/{job_id}/results",
    response_model=BatchScreenshotResponse,
    status_code=HTTP_200_OK,
    summary="Get batch job results",
    description="Get the results of a batch screenshot job"
)
async def get_batch_job_results(job_id: str = Path(..., description="Batch job ID")) -> Dict[str, Any]:
    """Get the results of a batch screenshot job.
    
    This endpoint allows you to retrieve the results of a batch job that was previously submitted.
    The results include the status of each item in the batch, as well as the URLs to the
    processed images for successfully completed items.
    
    Returns the job results, including the job ID, status, total items, succeeded items,
    failed items, processing time, and results for each item.
    """
    try:
        # Get the job results
        results = await batch_service.get_job_results(job_id)
        
        if not results:
            raise HTTPException(
                status_code=HTTP_404_NOT_FOUND,
                detail=f"Batch job not found: {job_id}"
            )
        
        # Check if the job is still processing
        if results["status"] == "processing":
            raise HTTPException(
                status_code=HTTP_202_ACCEPTED,
                detail=f"Batch job is still processing: {job_id}"
            )
        
        return results
        
    except HTTPException:
        raise
    except Exception as e:
        # If it's already one of our custom errors, just re-raise it
        if isinstance(e, WebToImgError):
            raise
        
        # Otherwise, convert to an appropriate error response
        error_dict = get_error_response(e)
        
        # Raise HTTPException with the detailed error information
        raise HTTPException(
            status_code=error_dict.get("http_status", HTTP_500_INTERNAL_SERVER_ERROR),
            detail=error_dict
        )
