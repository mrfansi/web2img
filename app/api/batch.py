from typing import Dict, Any

from fastapi import APIRouter, HTTPException, Path, Query, BackgroundTasks
from pydantic import ValidationError

from app.schemas.batch import BatchScreenshotRequest, BatchScreenshotResponse, BatchJobStatusResponse
from app.services.batch import batch_service
from app.core.errors import (
    WebToImgError, 
    get_error_response, 
    HTTP_200_OK,
    HTTP_400_BAD_REQUEST,
    HTTP_404_NOT_FOUND,
    HTTP_202_ACCEPTED,
    HTTP_500_INTERNAL_SERVER_ERROR
)

router = APIRouter(tags=["batch"])


@router.post(
    "/batch/screenshots",
    response_model=BatchJobStatusResponse,
    status_code=HTTP_202_ACCEPTED,
    summary="Create a batch screenshot job",
    description="Submit multiple screenshot requests to be processed as a batch"
)
async def create_batch_job(request: BatchScreenshotRequest) -> Dict[str, Any]:
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
        # Create a batch job
        items = [item.model_dump() for item in request.items]
        config = request.config.model_dump() if request.config else {}
        
        job = await batch_service.create_batch_job(items, config)
        
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
