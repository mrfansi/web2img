from pydantic import BaseModel, Field
from typing import Dict, Any


class HealthResponse(BaseModel):
    """Response model for health check endpoint."""
    status: str = Field(
        ..., 
        description="Service status",
        example="ok"
    )
    version: str = Field(
        ..., 
        description="API version",
        example="1.0.0"
    )
    services: Dict[str, Any] = Field(
        ..., 
        description="Status of individual services",
        example={
            "screenshot": "ok",
            "storage": "ok",
            "imgproxy": "ok"
        }
    )
    
    model_config = {
        "json_schema_extra": {
            "example": {
                "status": "ok",
                "version": "1.0.0",
                "services": {
                    "screenshot": "ok",
                    "storage": "ok",
                    "imgproxy": "ok"
                }
            }
        }
    }
