import os
from contextlib import asynccontextmanager
from typing import List

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.endpoints import router as api_router
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
        description="API for capturing website screenshots and processing them with imgproxy",
        version="1.0.0",
        lifespan=lifespan,
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
    
    # Include API router
    app.include_router(api_router, prefix=settings.api_prefix)
    
    return app


app = create_app()
