import os
from contextlib import asynccontextmanager
from typing import List

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.screenshot import router as screenshot_router
from app.api.health import router as health_router
from app.core.config import settings
from app.services.screenshot import screenshot_service
from app.services.storage import storage_service


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager for the FastAPI application.
    
    Handles startup and shutdown events.
    """
    # Startup: Ensure screenshot directory exists
    os.makedirs(settings.screenshot_dir, exist_ok=True)
    
    yield
    
    # Shutdown: Clean up resources
    await screenshot_service.cleanup()
    await storage_service.cleanup()


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
                "name": "health",
                "description": "Operations for checking the health and status of the service"
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
    
    # Add exception handler for better error messages
    @app.exception_handler(Exception)
    async def generic_exception_handler(request: Request, exc: Exception):
        return JSONResponse(
            status_code=500,
            content={"detail": f"Internal server error: {str(exc)}"},
        )
    
    # Include API routers
    app.include_router(screenshot_router, prefix=settings.api_prefix)
    app.include_router(health_router, prefix=settings.api_prefix)
    
    return app


app = create_app()
