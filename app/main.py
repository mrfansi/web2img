import os
import logging
from contextlib import asynccontextmanager
from typing import List

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
import pathlib

from app.core.logging import logger
from app.core.middleware import RequestLoggingMiddleware

from app.api.screenshot import router as screenshot_router
from app.api.health import router as health_router
from app.api.cache import router as cache_router
from app.api.batch import router as batch_router
from app.api.monitoring import router as monitoring_router
from app.core.config import settings
from app.core.monitoring import metrics_collector, start_monitoring, stop_monitoring
from app.services.screenshot import screenshot_service
from app.services.storage import storage_service
from app.services.cache import cache_service
from app.services.batch import batch_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager for the FastAPI application.
    
    Handles startup and shutdown events.
    """
    # Log application startup
    logger.info("Starting web2img service", {
        "settings": {
            "cache_enabled": settings.cache_enabled,
            "browser_pool_min_size": settings.browser_pool_min_size,
            "browser_pool_max_size": settings.browser_pool_max_size,
            "log_level": settings.log_level
        }
    })
    
    # Startup: Ensure screenshot directory exists
    os.makedirs(settings.screenshot_dir, exist_ok=True)
    logger.info(f"Screenshot directory created: {settings.screenshot_dir}")
    
    # Initialize browser pool
    await screenshot_service.startup()
    logger.info("Browser pool initialized")
    
    # Start monitoring system
    await start_monitoring()
    logger.info("Monitoring system initialized")
    
    # Start batch job scheduler
    await batch_service.start_scheduler()
    logger.info("Batch job scheduler started")
    
    yield
    
    # Shutdown: Clean up resources
    logger.info("Shutting down web2img service")
    await screenshot_service.cleanup()
    await storage_service.cleanup()
    await cache_service.cleanup()
    
    # Stop batch job scheduler
    await batch_service.stop_scheduler()
    logger.info("Batch job scheduler stopped")
    
    # Stop monitoring system
    await stop_monitoring()
    logger.info("Monitoring system stopped")
    
    logger.info("All resources cleaned up, service stopped")


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="web2img API",
        description="""
        # web2img API
        
        A high-performance API for capturing website screenshots, uploading them to Cloudflare R2, 
        and generating signed imgproxy URLs for image transformations.
        
        ## Features
        
        * **Screenshot Capture**: Capture screenshots of websites using Playwright
        * **Cloud Storage**: Upload screenshots to Cloudflare R2 storage
        * **Image Transformations**: Generate signed imgproxy URLs for image processing
        * **High Performance**: Handle concurrent requests with async processing
        
        ## Authentication
        
        This API does not currently require authentication.
        """,
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        openapi_tags=[
            {
                "name": "screenshots",
                "description": "Operations for capturing and processing website screenshots"
            },
            {
                "name": "batch",
                "description": "Operations for batch processing of multiple screenshot requests"
            },
            {
                "name": "health",
                "description": "Operations for checking the health and status of the service"
            },
            {
                "name": "cache",
                "description": "Operations for managing the screenshot cache"
            },
            {
                "name": "monitoring",
                "description": "Operations for monitoring service performance and health"
            }
        ],
        swagger_ui_parameters={"defaultModelsExpandDepth": -1}
    )
    
    # Configure CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    
    # Add request logging middleware
    app.add_middleware(RequestLoggingMiddleware)
    
    # Import our custom error handling system
    from app.core.errors import WebToImgError, get_error_response, classify_exception
    
    # Add exception handler for WebToImgError
    @app.exception_handler(WebToImgError)
    async def web2img_error_handler(request: Request, exc: WebToImgError):
        # Get request ID if available
        request_id = getattr(request.state, 'request_id', 'unknown')
        
        # Add request context to error
        exc.context.update({
            "request_id": request_id,
            "method": request.method,
            "url": str(request.url),
            "client": request.client.host if request.client else None
        })
        
        # Log the exception with structured data
        logger.error(f"WebToImgError: {exc.message}", exc.context)
        
        # Record error in monitoring system
        metrics_collector.record_error(
            error_type=exc.error_code,
            endpoint=request.url.path,
            error_details={
                "message": exc.message,
                "context": exc.context,
                "request_id": request_id
            }
        )
        
        # Create response
        error_response = exc.to_dict()
        error_response["request_id"] = request_id
        
        return JSONResponse(
            status_code=exc.http_status,
            content=error_response,
            headers={"X-Request-ID": request_id}
        )
    
    # Add exception handler for generic exceptions
    @app.exception_handler(Exception)
    async def generic_exception_handler(request: Request, exc: Exception):
        # Get request ID if available
        request_id = getattr(request.state, 'request_id', 'unknown')
        
        # Log the exception with structured data
        error_details = {
            "request_id": request_id,
            "method": request.method,
            "url": str(request.url),
            "client": request.client.host if request.client else None,
            "error_type": type(exc).__name__,
            "error_details": str(exc)
        }
        logger.exception(f"Unhandled exception in request handler", error_details)
        
        # Record error in monitoring system
        metrics_collector.record_error(
            error_type=type(exc).__name__,
            endpoint=request.url.path,
            error_details=error_details
        )
        
        # Try to classify the exception
        error_class = classify_exception(exc)
        if error_class is not WebToImgError:
            # Convert to a more specific error type
            converted_error = error_class(
                message="An error occurred while processing your request",
                context={
                    "request_id": request_id,
                    "method": request.method,
                    "path": str(request.url.path)
                },
                original_exception=exc
            )
            error_response = converted_error.to_dict()
            status_code = converted_error.http_status
        else:
            # Use generic error response
            error_response = get_error_response(exc)
            status_code = 500
        
        # Add request ID
        error_response["request_id"] = request_id
        
        return JSONResponse(
            status_code=status_code,
            content=error_response,
            headers={"X-Request-ID": request_id}
        )
    
    # Include API routers
    app.include_router(screenshot_router, prefix=settings.api_prefix)
    app.include_router(batch_router, prefix=settings.api_prefix)
    app.include_router(health_router, prefix=settings.api_prefix)
    app.include_router(cache_router, prefix=settings.api_prefix)
    app.include_router(monitoring_router, prefix=settings.api_prefix)
    
    # Mount static files directory
    static_dir = pathlib.Path(__file__).parent / "static"
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")
    
    # Add route for dashboard
    @app.get("/dashboard", response_class=HTMLResponse)
    async def get_dashboard():
        with open(static_dir / "dashboard.html", "r") as f:
            return f.read()

    @app.get("/")
    async def get_root():
        return RedirectResponse(url="/dashboard")
    
    return app


app = create_app()
