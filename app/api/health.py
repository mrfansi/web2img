import os
import platform
from typing import Dict, Any

from fastapi import APIRouter, status

from app.schemas.health import HealthResponse
from app.services.screenshot import screenshot_service
from app.services.storage import storage_service
from app.services.imgproxy import imgproxy_service
from app.services.cache import cache_service
from app.core.config import settings

# Create a router for health check endpoints
router = APIRouter(tags=["health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    status_code=status.HTTP_200_OK,
    summary="Health check",
    description="""
    Check the health status of the service and its dependencies.
    
    ## Checks
    - Overall service status
    - API version
    - Status of individual services (screenshot, storage, imgproxy)
    
    ## Response
    - status: Overall service status (ok, degraded, error)
    - version: API version
    - services: Status of individual services
    """,
    responses={
        200: {
            "description": "Service is healthy",
            "content": {
                "application/json": {
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
        },
        500: {
            "description": "Service is unhealthy",
            "content": {
                "application/json": {
                    "example": {
                        "status": "error",
                        "version": "1.0.0",
                        "services": {
                            "screenshot": "error",
                            "storage": "ok",
                            "imgproxy": "ok"
                        }
                    }
                }
            }
        }
    },
)
async def health_check() -> HealthResponse:
    """Check the health status of the service and its dependencies.
    
    Returns:
        Health status information
    """
    # Check individual services
    services: Dict[str, Any] = {}
    overall_status = "ok"
    
    # Check cache service
    try:
        cache_stats = cache_service.get_stats()
        services["cache"] = {
            "status": "ok",
            "enabled": cache_stats["enabled"],
            "size": cache_stats["size"],
            "hit_rate": cache_stats["hit_rate"]
        }
    except Exception:
        services["cache"] = {"status": "error"}
        overall_status = "degraded"
    
    # Check screenshot service
    try:
        # Simple check if the screenshot directory exists
        if os.path.exists(settings.screenshot_dir):
            services["screenshot"] = "ok"
        else:
            services["screenshot"] = "error"
            overall_status = "degraded"
    except Exception:
        services["screenshot"] = "error"
        overall_status = "degraded"
    
    # Check storage service
    try:
        # Simple check if the storage client can be initialized
        if storage_service.client:
            services["storage"] = "ok"
        else:
            services["storage"] = "error"
            overall_status = "degraded"
    except Exception:
        services["storage"] = "error"
        overall_status = "degraded"
    
    # Check imgproxy service
    try:
        # Simple check if the imgproxy key and salt are set
        if settings.imgproxy_key and settings.imgproxy_salt:
            services["imgproxy"] = "ok"
        else:
            services["imgproxy"] = "error"
            overall_status = "degraded"
    except Exception:
        services["imgproxy"] = "error"
        overall_status = "degraded"
    
    # Add system info
    services["system"] = {
        "python": platform.python_version(),
        "platform": platform.platform()
    }
    
    # Return health status
    return HealthResponse(
        status=overall_status,
        version="1.0.0",
        services=services
    )
