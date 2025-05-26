from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field, HttpUrl, root_validator, field_validator
from datetime import datetime, timezone

from app.schemas.screenshot import ScreenshotRequest
from app.models.job import JobPriority, RecurrencePattern


class BatchItemRequest(ScreenshotRequest):
    """Request model for a single item in a batch screenshot request."""
    id: str = Field(
        ..., 
        description="Unique identifier for this item within the batch"
    )


class BatchConfig(BaseModel):
    """Configuration for a batch screenshot request."""
    parallel: int = Field(
        default=3,
        description="Maximum number of screenshots to process in parallel",
        ge=1,
        le=10
    )
    timeout: int = Field(
        default=30,
        description="Timeout in seconds for each screenshot",
        ge=5,
        le=60
    )
    webhook: Optional[HttpUrl] = Field(
        default=None,
        description="Webhook URL to call when batch processing is complete"
    )
    webhook_auth: Optional[str] = Field(
        default=None,
        description="Authorization header value for webhook"
    )
    fail_fast: bool = Field(
        default=False,
        description="Whether to stop processing on first failure"
    )
    cache: bool = Field(
        default=True,
        description="Whether to use cache for screenshots"
    )
    priority: str = Field(
        default="normal",
        description="Priority of the batch job (high, normal, low)"
    )
    scheduled_time: Optional[str] = Field(
        default=None,
        description="ISO 8601 datetime string for when to execute the job"
    )
    recurrence: Optional[str] = Field(
        default=None,
        description="Recurrence pattern for the job (none, hourly, daily, weekly, monthly, custom)"
    )
    recurrence_interval: Optional[int] = Field(
        default=1,
        description="Interval for recurrence (e.g., every 2 days)",
        ge=1
    )
    recurrence_count: Optional[int] = Field(
        default=0,
        description="Number of times to recur (0 means infinite)",
        ge=0
    )
    recurrence_cron: Optional[str] = Field(
        default=None,
        description="Custom cron expression for recurrence (only used with recurrence=custom)"
    )
    rate_limit: Optional[int] = Field(
        default=None,
        description="Maximum number of requests per minute"
    )
    
    @field_validator('priority')
    def validate_priority(cls, v):
        if v not in [p.value for p in JobPriority]:
            raise ValueError(f"Priority must be one of: {', '.join([p.value for p in JobPriority])}")
        return v
        
    @field_validator('recurrence')
    def validate_recurrence(cls, v):
        if v is not None and v not in [r.value for r in RecurrencePattern]:
            raise ValueError(f"Recurrence must be one of: {', '.join([r.value for r in RecurrencePattern])}")
        return v


class BatchScreenshotRequest(BaseModel):
    """Request model for batch screenshot processing."""
    items: List[BatchItemRequest] = Field(
        ...,
        description="List of screenshot requests to process",
        min_length=1,
        max_length=50
    )
    config: Optional[BatchConfig] = Field(
        default=None,
        description="Batch processing configuration"
    )
    
    model_config = {
        "json_schema_extra": {
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
                    "cache": True,
                    "priority": "high",
                    "scheduled_time": "2025-06-01T12:00:00Z",
                    "recurrence": "daily",
                    "recurrence_interval": 1,
                    "recurrence_count": 7,
                    "rate_limit": 10
                }
            }
        }
    }


class BatchItemResponse(BaseModel):
    """Response model for a single item in a batch screenshot response."""
    id: str = Field(
        ...,
        description="Unique identifier for this item within the batch"
    )
    status: str = Field(
        ...,
        description="Status of the screenshot request"
    )
    url: Optional[str] = Field(
        default=None,
        description="URL to the processed image (only present if status is success)"
    )
    error: Optional[str] = Field(
        default=None,
        description="Error message (only present if status is error)"
    )
    cached: Optional[bool] = Field(
        default=None,
        description="Whether the result was served from cache"
    )


class BatchScreenshotResponse(BaseModel):
    """Response model for batch screenshot processing."""
    job_id: str = Field(
        ...,
        description="Unique identifier for the batch job",
    )
    status: str = Field(
        ...,
        description="Status of the batch job (completed, processing, failed)"
    )
    total: int = Field(
        ...,
        description="Total number of items in the batch",
    )
    succeeded: int = Field(
        ...,
        description="Number of successfully processed items",
    )
    failed: int = Field(
        ...,
        description="Number of failed items",
    )
    processing_time: float = Field(
        ...,
        description="Total processing time in seconds",
    )
    results: List[BatchItemResponse] = Field(
        ...,
        description="List of results for each item in the batch"
    )
    
    model_config = {
        "json_schema_extra": {
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
                        "url": "https://your-imgproxy-url.example.com/signed_path/resize:fit:1280:720/format:png/base64_encoded_url",
                        "cached": True
                    },
                    {
                        "id": "example-about",
                        "status": "success",
                        "url": "https://your-imgproxy-url.example.com/signed_path/resize:fit:1280:720/format:png/base64_encoded_url",
                        "cached": False
                    }
                ]
            }
        }
    }


class ScheduleJobRequest(BaseModel):
    """Request model for scheduling a batch job."""
    scheduled_time: str = Field(
        ...,
        description="ISO 8601 datetime string for when to execute the job",
    )
    
    @field_validator('scheduled_time')
    def validate_scheduled_time(cls, v):
        try:
            # Validate that it's a valid ISO format datetime string
            dt = datetime.fromisoformat(v.replace('Z', '+00:00'))
            # Ensure it's in the future using timezone-aware comparison
            if dt < datetime.now(timezone.utc):
                raise ValueError("Scheduled time must be in the future")
            return v
        except ValueError as e:
            raise ValueError(f"Invalid datetime format: {str(e)}")


class RecurrenceRequest(BaseModel):
    """Request model for setting job recurrence."""
    pattern: str = Field(
        ...,
        description="Recurrence pattern (none, hourly, daily, weekly, monthly, custom)",
    )
    interval: int = Field(
        default=1,
        description="Interval for recurrence (e.g., every 2 days)",
        ge=1
    )
    count: int = Field(
        default=0,
        description="Number of times to recur (0 means infinite)",
        ge=0
    )
    cron: Optional[str] = Field(
        default=None,
        description="Custom cron expression (only used with pattern=custom)",
    )
    
    @field_validator('pattern')
    def validate_pattern(cls, v):
        if v not in [r.value for r in RecurrencePattern]:
            raise ValueError(f"Pattern must be one of: {', '.join([r.value for r in RecurrencePattern])}")
        return v


class BatchJobStatusResponse(BaseModel):
    """Response model for batch job status."""
    job_id: str = Field(
        ...,
        description="Unique identifier for the batch job",
    )
    status: str = Field(
        ...,
        description="Status of the batch job (pending, processing, completed, failed, scheduled, cancelled)",
    )
    priority: str = Field(
        ...,
        description="Priority of the batch job (high, normal, low)",
    )
    total: int = Field(
        ...,
        description="Total number of items in the batch",
    )
    completed: int = Field(
        ...,
        description="Number of completed items (succeeded or failed)",
    )
    failed: int = Field(
        ...,
        description="Number of failed items",
    )
    created_at: str = Field(
        ...,
        description="Timestamp when the job was created",
    )
    updated_at: str = Field(
        ...,
        description="Timestamp when the job was last updated",
    )
    scheduled_time: Optional[str] = Field(
        default=None,
        description="Scheduled timestamp for job execution",
    )
    recurrence: Optional[str] = Field(
        default=None,
        description="Recurrence pattern for the job",
    )
    next_scheduled_time: Optional[str] = Field(
        default=None,
        description="Next scheduled timestamp for recurring jobs",
    )
    estimated_completion: Optional[str] = Field(
        default=None,
        description="Estimated timestamp for job completion",
    )
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "job_id": "batch-123456",
                "status": "processing",
                "priority": "high",
                "total": 2,
                "completed": 1,
                "failed": 0,
                "created_at": "2025-05-23T00:30:00Z",
                "updated_at": "2025-05-23T00:30:02Z",
                "scheduled_time": None,
                "recurrence": None,
                "next_scheduled_time": None,
                "estimated_completion": "2025-05-23T00:30:05Z"
            }
        }
    }


class BatchJobListResponse(BaseModel):
    """Response model for a list of batch jobs."""
    jobs: List[BatchJobStatusResponse] = Field(
        ...,
        description="List of batch jobs",
    )
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "jobs": [
                    {
                        "job_id": "batch-123456",
                        "status": "processing",
                        "priority": "high",
                        "total": 2,
                        "completed": 1,
                        "failed": 0,
                        "created_at": "2025-05-23T00:30:00Z",
                        "updated_at": "2025-05-23T00:30:02Z",
                        "scheduled_time": None,
                        "recurrence": None,
                        "next_scheduled_time": None,
                        "estimated_completion": "2025-05-23T00:30:05Z"
                    },
                    {
                        "job_id": "batch-789012",
                        "status": "scheduled",
                        "priority": "normal",
                        "total": 3,
                        "completed": 0,
                        "failed": 0,
                        "created_at": "2025-05-23T00:35:00Z",
                        "updated_at": "2025-05-23T00:35:00Z",
                        "scheduled_time": "2025-06-01T12:00:00Z",
                        "recurrence": "daily",
                        "next_scheduled_time": "2025-06-02T12:00:00Z",
                        "estimated_completion": None
                    }
                ]
            }
        }
    }
