from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field, HttpUrl

from app.schemas.screenshot import ScreenshotRequest


class BatchItemRequest(ScreenshotRequest):
    """Request model for a single item in a batch screenshot request."""
    id: str = Field(
        ..., 
        description="Unique identifier for this item within the batch",
        example="example-home"
    )


class BatchConfig(BaseModel):
    """Configuration for a batch screenshot request."""
    parallel: int = Field(
        default=3,
        description="Maximum number of screenshots to process in parallel",
        ge=1,
        le=10,
        example=3
    )
    timeout: int = Field(
        default=30,
        description="Timeout in seconds for each screenshot",
        ge=5,
        le=60,
        example=30
    )
    webhook: Optional[HttpUrl] = Field(
        default=None,
        description="Webhook URL to call when batch processing is complete",
        example="https://api.example.com/callbacks/screenshots"
    )
    webhook_auth: Optional[str] = Field(
        default=None,
        description="Authorization header value for webhook",
        example="Bearer token123"
    )
    fail_fast: bool = Field(
        default=False,
        description="Whether to stop processing on first failure",
        example=False
    )
    cache: bool = Field(
        default=True,
        description="Whether to use cache for screenshots",
        example=True
    )


class BatchScreenshotRequest(BaseModel):
    """Request model for batch screenshot processing."""
    items: List[BatchItemRequest] = Field(
        ...,
        description="List of screenshot requests to process",
        min_items=1,
        max_items=50
    )
    config: Optional[BatchConfig] = Field(
        default=None,
        description="Batch processing configuration"
    )
    
    class Config:
        json_schema_extra = {
            "example": {
                "items": [
                    {
                        "url": "https://example.com",
                        "width": 1280,
                        "height": 720,
                        "format": "png",
                        "id": "example-home"
                    },
                    {
                        "url": "https://example.com/about",
                        "width": 1280,
                        "height": 720,
                        "format": "png",
                        "id": "example-about"
                    }
                ],
                "config": {
                    "parallel": 3,
                    "timeout": 30,
                    "webhook": "https://api.example.com/callbacks/screenshots",
                    "webhook_auth": "Bearer token123",
                    "fail_fast": False,
                    "cache": True
                }
            }
        }


class BatchItemResponse(BaseModel):
    """Response model for a single item in a batch screenshot response."""
    id: str = Field(
        ...,
        description="Unique identifier for this item within the batch",
        example="example-home"
    )
    status: str = Field(
        ...,
        description="Status of the screenshot request",
        example="success"
    )
    url: Optional[str] = Field(
        default=None,
        description="URL to the processed image (only present if status is success)",
        example="https://imgproxy.example.com/signed_path/resize:fit:1280:720/format:png/base64_encoded_url"
    )
    error: Optional[str] = Field(
        default=None,
        description="Error message (only present if status is error)",
        example="Failed to capture screenshot: Error message"
    )
    cached: Optional[bool] = Field(
        default=None,
        description="Whether the result was served from cache",
        example=True
    )


class BatchScreenshotResponse(BaseModel):
    """Response model for batch screenshot processing."""
    job_id: str = Field(
        ...,
        description="Unique identifier for the batch job",
        example="batch-123456"
    )
    status: str = Field(
        ...,
        description="Status of the batch job (completed, processing, failed)",
        example="completed"
    )
    total: int = Field(
        ...,
        description="Total number of items in the batch",
        example=2
    )
    succeeded: int = Field(
        ...,
        description="Number of successfully processed items",
        example=2
    )
    failed: int = Field(
        ...,
        description="Number of failed items",
        example=0
    )
    processing_time: float = Field(
        ...,
        description="Total processing time in seconds",
        example=3.45
    )
    results: List[BatchItemResponse] = Field(
        ...,
        description="List of results for each item in the batch"
    )
    
    class Config:
        json_schema_extra = {
            "example": {
                "job_id": "batch-123456",
                "status": "completed",
                "total": 2,
                "succeeded": 2,
                "failed": 0,
                "processing_time": 3.45,
                "results": [
                    {
                        "id": "example-home",
                        "status": "success",
                        "url": "https://imgproxy.example.com/signed_path/resize:fit:1280:720/format:png/base64_encoded_url",
                        "cached": True
                    },
                    {
                        "id": "example-about",
                        "status": "success",
                        "url": "https://imgproxy.example.com/signed_path/resize:fit:1280:720/format:png/base64_encoded_url",
                        "cached": False
                    }
                ]
            }
        }


class BatchJobStatusResponse(BaseModel):
    """Response model for batch job status."""
    job_id: str = Field(
        ...,
        description="Unique identifier for the batch job",
        example="batch-123456"
    )
    status: str = Field(
        ...,
        description="Status of the batch job (completed, processing, failed)",
        example="processing"
    )
    total: int = Field(
        ...,
        description="Total number of items in the batch",
        example=2
    )
    completed: int = Field(
        ...,
        description="Number of completed items (succeeded or failed)",
        example=1
    )
    failed: int = Field(
        ...,
        description="Number of failed items",
        example=0
    )
    created_at: str = Field(
        ...,
        description="Timestamp when the job was created",
        example="2025-05-23T00:30:00Z"
    )
    updated_at: str = Field(
        ...,
        description="Timestamp when the job was last updated",
        example="2025-05-23T00:30:02Z"
    )
    estimated_completion: Optional[str] = Field(
        default=None,
        description="Estimated timestamp for job completion",
        example="2025-05-23T00:30:05Z"
    )
    
    class Config:
        json_schema_extra = {
            "example": {
                "job_id": "batch-123456",
                "status": "processing",
                "total": 2,
                "completed": 1,
                "failed": 0,
                "created_at": "2025-05-23T00:30:00Z",
                "updated_at": "2025-05-23T00:30:02Z",
                "estimated_completion": "2025-05-23T00:30:05Z"
            }
        }
