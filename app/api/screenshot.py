import os
from typing import Any

from fastapi import APIRouter, HTTPException, status

from app.schemas.screenshot import ScreenshotRequest, ScreenshotResponse
from app.services.screenshot import screenshot_service
from app.services.storage import storage_service
from app.services.imgproxy import imgproxy_service

# Create a router for screenshot endpoints
router = APIRouter(tags=["screenshots"])


@router.post(
    "/screenshot",
    response_model=ScreenshotResponse,
    status_code=status.HTTP_200_OK,
    summary="Capture website screenshot",
    description="""
    Capture a screenshot of a website, upload it to R2, and return a signed imgproxy URL.
    
    ## Process Flow
    1. Captures a screenshot of the provided URL using Playwright
    2. Uploads the screenshot to Cloudflare R2 storage
    3. Generates a signed imgproxy URL for the image with the specified transformations
    4. Returns the URL to the processed image
    
    ## Notes
    - The URL must be a valid HTTP or HTTPS URL
    - Supported formats: png, jpeg, webp
    - Width and height must be between 1 and 5000 pixels
    - The returned URL will be valid indefinitely
    """,
    responses={
        200: {
            "description": "Successfully captured screenshot and generated imgproxy URL",
            "content": {
                "application/json": {
                    "example": {
                        "url": "https://cdn-proxy.viding.org/signed_path/resize:fit:1280:720/format:png/base64_encoded_url"
                    }
                }
            }
        },
        400: {
            "description": "Invalid input parameters",
            "content": {
                "application/json": {
                    "example": {
                        "detail": "Invalid URL format"
                    }
                }
            }
        },
        500: {
            "description": "Server error",
            "content": {
                "application/json": {
                    "example": {
                        "detail": "Failed to process screenshot: Error message"
                    }
                }
            }
        }
    },
)
async def capture_screenshot(request: ScreenshotRequest) -> Any:
    """Capture a screenshot of a website.
    
    Args:
        request: Screenshot request parameters
        
    Returns:
        URL to the processed image
        
    Raises:
        HTTPException: If screenshot capture or upload fails
    """
    screenshot_path = None
    try:
        # Capture the screenshot
        screenshot_path = await screenshot_service.capture_screenshot(
            url=str(request.url),
            width=request.width,
            height=request.height,
            format=request.format,
        )
        
        # Upload to R2
        r2_url = await storage_service.upload_file(
            file_path=screenshot_path,
            content_type=f"image/{request.format}",
        )
        
        # Generate imgproxy URL
        imgproxy_url = imgproxy_service.generate_url(
            image_url=r2_url,
            width=request.width,
            height=request.height,
            format=request.format,
        )
        
        # Return the response
        return ScreenshotResponse(url=imgproxy_url)
    except Exception as e:
        # Handle errors
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process screenshot: {str(e)}",
        )
    finally:
        # Clean up the temporary file
        if screenshot_path and os.path.exists(screenshot_path):
            os.unlink(screenshot_path)
