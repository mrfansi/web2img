import os
import platform
import time
from typing import Dict, Any

from fastapi import APIRouter, status

from app.schemas.health import HealthResponse
from app.services.screenshot import screenshot_service
from app.services.storage import storage_service
from app.services.cache import cache_service
from app.services.health_checker import health_check_service
from app.models.job import job_store
from app.core.config import settings
from app.core.monitoring import metrics_collector

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
                            "imgproxy": "ok",
                            "batch": {
                                "status": "ok",
                                "active_jobs": 2,
                                "processing_jobs": 1
                            },
                            "cache": {
                                "status": "ok",
                                "enabled": True,
                                "size": 42,
                                "hit_rate": 0.87
                            }
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
    
    # Check batch processing service
    try:
        active_jobs = len(job_store.jobs)
        processing_jobs = sum(1 for job in job_store.jobs.values() if job.status == "processing")
        services["batch"] = {
            "status": "ok",
            "active_jobs": active_jobs,
            "processing_jobs": processing_jobs
        }
    except Exception:
        services["batch"] = {"status": "error"}
        overall_status = "degraded"
    
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
        # Check if the screenshot directory exists
        if os.path.exists(settings.screenshot_dir):
            # Get browser pool and retry stats if available
            browser_pool_stats = None
            retry_stats = None
            if hasattr(screenshot_service, "get_pool_stats") and hasattr(screenshot_service, "get_retry_stats"):
                browser_pool_stats = screenshot_service.get_pool_stats()
                retry_stats = screenshot_service.get_retry_stats()
            services["screenshot"] = {
                "status": "ok",
                "browser_pool": browser_pool_stats if browser_pool_stats else {},
                "retry_stats": retry_stats if retry_stats else {}
            }
        else:
            services["screenshot"] = {
                "status": "error",
                "message": "Screenshot directory does not exist"
            }
            overall_status = "degraded"
    except Exception as e:
        services["screenshot"] = {
            "status": "error",
            "message": str(e)
        }
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
        "platform": platform.platform(),
        "uptime": time.time() - metrics_collector.get_metrics()["system"]["start_time"]
    }
    
    # Add monitoring metrics
    try:
        metrics = metrics_collector.get_metrics()
        services["monitoring"] = {
            "status": "ok",
            "requests": {
                "total": metrics["requests"]["total"],
                "success": metrics["requests"]["success"],
                "error": metrics["requests"]["error"],
                "error_rate": metrics["requests"]["error"] / max(1, metrics["requests"]["total"])
            },
            "response_times": {
                "avg_ms": metrics["response_times"]["avg"],
                "p95_ms": metrics["response_times"]["p95"],
                "p99_ms": metrics["response_times"]["p99"]
            },
            "errors": {
                "total": metrics["errors"]["total"],
                "by_type": dict(sorted(metrics["errors"]["by_type"].items(), 
                                  key=lambda x: x[1], reverse=True)[:5])  # Top 5 error types
            },
            "browser_pool": {
                "size": metrics["browser_pool"]["size"],
                "available": metrics["browser_pool"]["available"],
                "in_use": metrics["browser_pool"]["in_use"],
                "utilization": metrics["browser_pool"]["in_use"] / max(1, metrics["browser_pool"]["size"])
            },
            "cache": {
                "hit_rate": metrics["cache"]["hit_rate"],
                "size": metrics["cache"]["size"]
            }
        }
    except Exception as e:
        services["monitoring"] = {
            "status": "error",
            "message": str(e)
        }

    # Check health check service
    try:
        health_check_stats = health_check_service.get_stats()
        services["health_check"] = {
            "status": "ok" if health_check_stats["enabled"] and health_check_stats["running"] else "disabled",
            "enabled": health_check_stats["enabled"],
            "running": health_check_stats["running"],
            "last_check_success": health_check_stats["last_check_success"],
            "success_rate": health_check_stats["success_rate"],
            "check_count": health_check_stats["check_count"],
            "interval": health_check_stats["interval"]
        }
    except Exception as e:
        services["health_check"] = {
            "status": "error",
            "message": str(e)
        }

    # Return health status
    return HealthResponse(
        status=overall_status,
        version="1.0.0",
        services=services
    )
