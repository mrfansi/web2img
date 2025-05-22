from typing import Literal, Optional

from pydantic import BaseModel, Field, HttpUrl, validator


class ScreenshotRequest(BaseModel):
    """Request model for screenshot endpoint."""
    url: HttpUrl = Field(
        ..., 
        description="URL to capture screenshot of",
        example="https://example.com"
    )
    format: Literal["png", "jpeg", "webp"] = Field(
        default="png", 
        description="Image format (png, jpeg, webp)",
        example="png"
    )
    width: int = Field(
        default=1280, 
        description="Screenshot width in pixels", 
        ge=1, 
        le=5000,
        example=1280
    )
    height: int = Field(
        default=720, 
        description="Screenshot height in pixels", 
        ge=1, 
        le=5000,
        example=720
    )
    
    class Config:
        schema_extra = {
            "example": {
                "url": "https://example.com",
                "format": "png",
                "width": 1280,
                "height": 720
            }
        }

    @validator("format")
    def validate_format(cls, v):
        """Validate image format."""
        if v not in ["png", "jpeg", "webp"]:
            raise ValueError(f"Unsupported format: {v}. Must be one of: png, jpeg, webp")
        return v


class ScreenshotResponse(BaseModel):
    """Response model for screenshot endpoint."""
    url: str = Field(
        ..., 
        description="URL to the processed image",
        example="https://cdn-proxy.viding.org/signed_path/resize:fit:1280:720/format:png/base64_encoded_url"
    )
    
    class Config:
        schema_extra = {
            "example": {
                "url": "https://cdn-proxy.viding.org/signed_path/resize:fit:1280:720/format:png/base64_encoded_url"
            }
        }
