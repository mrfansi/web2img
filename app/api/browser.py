"""
Browser Management API Endpoints

Provides endpoints for managing and querying browser engines.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, List

from app.core.config import settings
from app.services.browser_manager import browser_manager
from app.core.logging import get_logger

router = APIRouter()
logger = get_logger("browser_api")


class BrowserEngineRequest(BaseModel):
    """Request model for changing browser engine."""
    engine: str


class BrowserInfoResponse(BaseModel):
    """Response model for browser information."""
    current_engine: str
    available_engines: List[str]
    engine_info: Dict[str, Any]


class BrowserCapabilitiesResponse(BaseModel):
    """Response model for browser capabilities."""
    engines: Dict[str, Dict[str, Any]]


@router.get("/info", response_model=BrowserInfoResponse)
async def get_browser_info():
    """Get current browser configuration and available engines."""
    try:
        current_engine = settings.validate_browser_engine()
        available_engines = ["chromium", "firefox", "webkit"]
        
        # Get detailed info about current engine
        engine_info = await browser_manager.get_browser_info(current_engine)
        
        return BrowserInfoResponse(
            current_engine=current_engine,
            available_engines=available_engines,
            engine_info=engine_info
        )
        
    except Exception as e:
        logger.error(f"Error getting browser info: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get browser info: {str(e)}")


@router.get("/capabilities", response_model=BrowserCapabilitiesResponse)
async def get_browser_capabilities():
    """Get capabilities for all available browser engines."""
    try:
        engines = {}
        available_engines = ["chromium", "firefox", "webkit"]
        
        for engine in available_engines:
            engines[engine] = await browser_manager.get_browser_info(engine)
        
        return BrowserCapabilitiesResponse(engines=engines)
        
    except Exception as e:
        logger.error(f"Error getting browser capabilities: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get browser capabilities: {str(e)}")


@router.post("/engine")
async def set_browser_engine(request: BrowserEngineRequest):
    """Set the browser engine for new browser instances."""
    try:
        engine = request.engine.lower()
        valid_engines = ["chromium", "firefox", "webkit"]
        
        if engine not in valid_engines:
            raise HTTPException(
                status_code=400, 
                detail=f"Invalid browser engine: {engine}. Must be one of: {', '.join(valid_engines)}"
            )
        
        # Update the settings (this affects new browser instances)
        settings.browser_engine = engine
        
        logger.info(f"Browser engine changed to: {engine}")
        
        return {
            "message": f"Browser engine set to {engine}",
            "engine": engine,
            "user_agent": settings.get_user_agent(),
            "note": "This affects new browser instances. Existing browsers will continue using their original engine."
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error setting browser engine: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to set browser engine: {str(e)}")


@router.get("/user-agent")
async def get_user_agent():
    """Get the current user agent string."""
    try:
        current_engine = settings.validate_browser_engine()
        user_agent = settings.get_user_agent()
        
        return {
            "engine": current_engine,
            "user_agent": user_agent,
            "custom": bool(settings.user_agent)  # True if custom user agent is set
        }
        
    except Exception as e:
        logger.error(f"Error getting user agent: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get user agent: {str(e)}")


@router.get("/recommend/{url:path}")
async def recommend_browser_engine(url: str):
    """Get recommended browser engine for a specific URL."""
    try:
        if not url.startswith(('http://', 'https://')):
            url = f"https://{url}"
        
        recommended_engine = browser_manager.get_recommended_engine_for_url(url)
        current_engine = settings.validate_browser_engine()
        
        return {
            "url": url,
            "recommended_engine": recommended_engine,
            "current_engine": current_engine,
            "should_switch": recommended_engine != current_engine,
            "reason": f"Recommended {recommended_engine} for better compatibility with this URL"
        }
        
    except Exception as e:
        logger.error(f"Error getting browser recommendation: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get browser recommendation: {str(e)}")


@router.get("/health")
async def browser_health_check():
    """Check if browser manager is healthy and can launch browsers."""
    try:
        current_engine = settings.validate_browser_engine()
        
        # Try to get browser info to verify the engine is working
        engine_info = await browser_manager.get_browser_info(current_engine)
        
        if engine_info.get("available", False):
            return {
                "status": "healthy",
                "engine": current_engine,
                "message": f"{current_engine} browser engine is available and ready"
            }
        else:
            return {
                "status": "unhealthy",
                "engine": current_engine,
                "message": f"{current_engine} browser engine is not available",
                "error": engine_info.get("error", "Unknown error")
            }
            
    except Exception as e:
        logger.error(f"Browser health check failed: {str(e)}")
        return {
            "status": "unhealthy",
            "message": f"Browser health check failed: {str(e)}"
        }
