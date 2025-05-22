import os
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from app.schemas.screenshot import ScreenshotRequest, ScreenshotResponse
from app.services.screenshot import screenshot_service
from app.services.storage import storage_service
from app.services.imgproxy import imgproxy_service


router = APIRouter()


@router.post(
    "/screenshot",
    response_model=ScreenshotResponse,
    status_code=status.HTTP_200_OK,
    summary="Capture website screenshot",
    description="Capture a screenshot of a website, upload it to R2, and return a signed imgproxy URL",
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
