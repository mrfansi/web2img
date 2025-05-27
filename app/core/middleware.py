import time
import uuid
from typing import Callable, Dict, Any

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.core.config import settings
from app.core.logging import get_logger
from app.core.monitoring import metrics_collector


logger = get_logger("middleware")


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware for logging request and response details."""
    
    def __init__(self, app: ASGIApp):
        """Initialize the middleware.
        
        Args:
            app: The ASGI application
        """
        super().__init__(app)
    
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        """Process the request and log details.
        
        Args:
            request: The incoming request
            call_next: The next middleware or route handler
            
        Returns:
            The response
        """
        # Generate a unique request ID
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
        
        # Start timer for request duration
        start_time = time.time()
        
        # Prepare request logging info
        request_info = {
            "request_id": request_id,
            "method": request.method,
            "url": str(request.url),
            "client": request.client.host if request.client else None,
            "headers": dict(request.headers),
        }
        
        # Log request body if enabled and not a multipart form
        if settings.log_request_body and "multipart/form-data" not in request.headers.get("content-type", ""):
            try:
                body = await request.body()
                if body:
                    request_info["body"] = body.decode("utf-8")
            except Exception as e:
                logger.warning(f"Failed to log request body: {str(e)}")
        
        # Log the request
        logger.info(f"Request received: {request.method} {request.url.path}", {"request": request_info})
        
        try:
            # Process the request
            response = await call_next(request)
            
            # Calculate request duration
            duration = time.time() - start_time
            
            # Prepare response logging info
            response_info = {
                "request_id": request_id,
                "status_code": response.status_code,
                "duration": duration,
                "headers": dict(response.headers),
            }
            
            # Log response body if enabled
            if settings.log_response_body and response.status_code >= 400:
                # Only log response bodies for error responses
                try:
                    # Check if the response has a body attribute (not streaming)
                    if hasattr(response, 'body'):
                        response_body = response.body
                        if response_body:
                            try:
                                response_info["body"] = response_body.decode("utf-8")
                            except Exception as e:
                                logger.warning(f"Failed to decode response body: {str(e)}")
                    else:
                        # For streaming responses, we can't access the body directly
                        logger.debug("Skipping response body logging for streaming response")
                except Exception as e:
                    logger.warning(f"Failed to log response body: {str(e)}")
            
            # Log the response
            log_level = "error" if response.status_code >= 500 else \
                       "warning" if response.status_code >= 400 else "info"
            
            getattr(logger, log_level)(
                f"Response sent: {response.status_code} {request.method} {request.url.path} ({duration:.3f}s)",
                {"response": response_info}
            )
            
            # Record metrics
            metrics_collector.record_request(
                endpoint=request.url.path,
                status_code=response.status_code,
                duration_ms=duration * 1000  # Convert seconds to milliseconds
            )
            
            # Add request ID to response headers
            response.headers["X-Request-ID"] = request_id
            
            return response
        except Exception as e:
            # Log the exception
            duration = time.time() - start_time
            logger.exception(
                f"Request failed: {request.method} {request.url.path} ({duration:.3f}s)",
                {
                    "request": request_info,
                    "error": str(e),
                    "duration": duration,
                }
            )
            
            # Record error metrics
            error_type = type(e).__name__
            metrics_collector.record_error(
                error_type=error_type,
                endpoint=request.url.path,
                error_details={
                    "message": str(e),
                    "duration_ms": duration * 1000,
                }
            )
            
            # Record request metrics (as a failed request)
            metrics_collector.record_request(
                endpoint=request.url.path,
                status_code=500,  # Assume 500 for unhandled exceptions
                duration_ms=duration * 1000
            )
            
            raise
