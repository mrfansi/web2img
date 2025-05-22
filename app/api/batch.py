from typing import Dict, List, Any, Optional

from fastapi import APIRouter, HTTPException, status, Path, Query, BackgroundTasks
from pydantic import ValidationError

from app.schemas.batch import BatchScreenshotRequest, BatchScreenshotResponse, BatchJobStatusResponse
from app.services.batch import batch_service

router = APIRouter(tags=["batch"])


@router.post(
    "/batch/screenshots",
    response_model=BatchJobStatusResponse,
    status_code=status.HTTP_202_ACCEPTED,
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
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid request: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create batch job: {str(e)}"
        )


@router.get(
    "/batch/screenshots/{job_id}",
    response_model=BatchJobStatusResponse,
    status_code=status.HTTP_200_OK,
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
        status = await batch_service.get_job_status(job_id)
        
        if not status:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Batch job not found: {job_id}"
            )
        
        return status
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get batch job status: {str(e)}"
        )


@router.get(
    "/batch/screenshots/{job_id}/results",
    response_model=BatchScreenshotResponse,
    status_code=status.HTTP_200_OK,
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
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Batch job not found: {job_id}"
            )
        
        # Check if the job is still processing
        if results["status"] == "processing":
            raise HTTPException(
                status_code=status.HTTP_202_ACCEPTED,
                detail=f"Batch job is still processing: {job_id}"
            )
        
        return results
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get batch job results: {str(e)}"
        )
