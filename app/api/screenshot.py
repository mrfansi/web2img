import os
import uuid
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.schemas.screenshot import ScreenshotRequest, ScreenshotResponse
from app.services.screenshot import screenshot_service
from app.services.storage import storage_service
from app.services.imgproxy import imgproxy_service
from app.services.cache import cache_service
from app.utils.url_transformer import transform_url
from app.core.errors import (
    WebToImgError,
    get_error_response,
    HTTP_200_OK,
    HTTP_500_INTERNAL_SERVER_ERROR,
    HTTP_503_SERVICE_UNAVAILABLE,
    HTTP_429_TOO_MANY_REQUESTS
)
from app.core.logging import get_logger
from app.core.config import settings

# Create a router for screenshot endpoints
router = APIRouter(tags=["screenshots"])

# Initialize logger
logger = get_logger("screenshot_api")


@router.post(
    "/screenshot",
    response_model=ScreenshotResponse,
    status_code=HTTP_200_OK,
    summary="Capture website screenshot",
    description="""
    Capture a screenshot of a website, save it to storage (R2 or local disk), and return a signed imgproxy URL.

    ## Process Flow
    1. Transforms the URL if it matches specific domain patterns (see URL Transformations below)
    2. Checks if the screenshot is already cached
    3. If cached, returns the cached URL immediately
    4. Otherwise, captures a screenshot of the (possibly transformed) URL using Playwright
    5. Saves the screenshot to configured storage (Cloudflare R2 or local disk)
    6. Generates a signed imgproxy URL for the image with the specified transformations
    7. Caches the result for future requests
    8. Returns the URL to the processed image

    ## URL Transformations
    The service automatically transforms certain URLs before capturing screenshots:
    - `viding.co` → `http://viding-co_website-revamp`
    - `viding.org` → `http://viding-org_website-revamp`

    Note: The original URL is used for caching purposes to maintain consistency.

    ## Cache Control
    - Use `cache=false` to bypass the cache and force a fresh screenshot
    - Cache TTL is configurable via the CACHE_TTL_SECONDS environment variable (default: 1 hour)

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
                        "url": "https://your-imgproxy-url.example.com/signed_path/resize:fit:1280:720/format:png/base64_encoded_url"
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
async def capture_screenshot(
    request: ScreenshotRequest,
    cache: bool = Query(True, description="Whether to use cache (if available)")
) -> Any:
    """Capture a screenshot of a website with intelligent request queuing.

    Args:
        request: Screenshot request parameters
        cache: Whether to use cache (if available)

    Returns:
        URL to the processed image

    Raises:
        HTTPException: If screenshot capture or upload fails
    """
    # Transform URL if needed (viding.co -> viding-co_website-revamp, etc.)
    original_url = str(request.url)
    transformed_url = transform_url(original_url)

    # Log URL transformation if it occurred
    if transformed_url != original_url:
        logger.info(f"URL transformed for screenshot: {original_url} -> {transformed_url}")

    # Try to get from cache if enabled (use original URL for cache key)
    if cache:
        cached_url = await cache_service.get(
            url=original_url,  # Use original URL for cache consistency
            width=request.width,
            height=request.height,
            format=request.format
        )

        if cached_url:
            # Return the cached URL
            return ScreenshotResponse(url=cached_url)

    # Use request queue for load management if enabled
    if settings.enable_request_queue:
        try:
            from app.services.request_queue import queue_manager, QueueStatus

            # Generate unique request ID
            request_id = str(uuid.uuid4())

            # Define the screenshot processing function
            async def process_screenshot():
                return await _process_screenshot_internal(
                    original_url=original_url,
                    transformed_url=transformed_url,
                    request=request,
                    cache=cache
                )

            # Submit to queue
            status = await queue_manager.submit_request(
                request_id=request_id,
                handler=process_screenshot,
                priority=0,  # Normal priority
                timeout=settings.queue_timeout
            )

            # Handle queue response
            if status == QueueStatus.REJECTED:
                raise HTTPException(
                    status_code=HTTP_503_SERVICE_UNAVAILABLE,
                    detail={
                        "error": "service_overloaded",
                        "message": "Service is currently overloaded. Please try again later.",
                        "retry_after": 30
                    }
                )
            elif status == QueueStatus.TIMEOUT:
                raise HTTPException(
                    status_code=HTTP_429_TOO_MANY_REQUESTS,
                    detail={
                        "error": "request_timeout",
                        "message": "Request timed out in queue. Please try again.",
                        "retry_after": 10
                    }
                )
            elif status == QueueStatus.PROCESSED:
                # Request was processed directly (queue disabled or low load)
                return await process_screenshot()
            else:
                # Request was queued - this shouldn't happen in sync API
                # but handle gracefully
                return await process_screenshot()

        except ImportError:
            # Queue manager not available, process directly
            logger.debug("Request queue not available, processing directly")
        except Exception as e:
            logger.error(f"Error with request queue: {e}")
            # Fall back to direct processing

    # Process directly (queue disabled or fallback)
    return await _process_screenshot_internal(
        original_url=original_url,
        transformed_url=transformed_url,
        request=request,
        cache=cache
    )


async def _process_screenshot_internal(
    original_url: str,
    transformed_url: str,
    request: ScreenshotRequest,
    cache: bool
) -> ScreenshotResponse:
    """Internal function to process screenshot without queue management."""

    # Not in cache or cache disabled, proceed with capture
    screenshot_path = None
    try:
        # Capture the screenshot using the transformed URL
        screenshot_path = await screenshot_service.capture_screenshot(
            url=transformed_url,  # Use transformed URL for actual screenshot
            width=request.width,
            height=request.height,
            format=request.format,
        )

        # Upload to storage (R2 or local)
        storage_url = await storage_service.upload_file(
            file_path=screenshot_path,
            content_type=f"image/{request.format}",
        )

        # Handle imgproxy usage based on storage mode and configuration
        if settings.storage_mode.lower() == "local" and not settings.use_imgproxy_for_local:
            # For local storage with imgproxy disabled, return direct URL
            final_url = storage_url
        else:
            # For R2 storage or local storage with imgproxy enabled, generate imgproxy URL
            # This provides consistent image processing capabilities
            final_url = imgproxy_service.generate_url(
                image_url=storage_url,
                width=request.width,
                height=request.height,
                format=request.format,
            )

        # Store in cache if enabled (use original URL for cache consistency)
        if cache:
            await cache_service.set(
                url=original_url,  # Use original URL for cache key
                width=request.width,
                height=request.height,
                format=request.format,
                imgproxy_url=final_url
            )

        # Return the response
        return ScreenshotResponse(url=final_url)
    except Exception as e:
        # If it's already one of our custom errors, just re-raise it
        # FastAPI will use our custom exception handler
        if isinstance(e, WebToImgError):
            raise

        # Otherwise, convert to an appropriate error response
        error_dict = get_error_response(e)

        # Raise HTTPException with the detailed error information
        raise HTTPException(
            status_code=error_dict.get("http_status", HTTP_500_INTERNAL_SERVER_ERROR),
            detail=error_dict,
        )
    finally:
        # Clean up the temporary file only if it still exists
        # (for local storage, the file may have been moved)
        if screenshot_path and os.path.exists(screenshot_path):
            os.unlink(screenshot_path)
