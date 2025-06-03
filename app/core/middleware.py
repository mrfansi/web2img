import time
import uuid
from typing import Callable, Optional

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.core.config import settings
from app.core.logging import get_logger
from app.core.monitoring import metrics_collector


logger = get_logger("middleware")


def get_real_client_ip(request: Request) -> Optional[str]:
    """Extract the real client IP from request headers.

    This function checks various headers commonly used by proxies and load balancers
    to forward the original client IP address.

    Args:
        request: The FastAPI request object

    Returns:
        The real client IP address or None if not found
    """
    # Check if proxy header trust is enabled
    if not settings.trust_proxy_headers:
        # If proxy headers are not trusted, return direct client IP only
        return request.client.host if request.client else None

    # Log proxy headers for debugging if enabled
    if settings.log_proxy_headers:
        proxy_headers = {
            key: value for key, value in request.headers.items()
            if any(header in key.lower() for header in ["forwarded", "x-real-ip", "x-client", "cf-connecting"])
        }
        if proxy_headers:
            logger.debug(f"Proxy headers detected: {proxy_headers}")

    # List of headers to check in order of preference
    # These are the most common headers used by proxies/load balancers
    headers_to_check = [
        "x-forwarded-for",      # Most common, can contain multiple IPs
        "x-real-ip",            # Nginx and other proxies
        "cf-connecting-ip",     # Cloudflare
        "x-client-ip",          # Some proxies
        "x-forwarded",          # Less common
        "forwarded-for",        # Less common
        "forwarded",            # RFC 7239 standard
    ]

    for header_name in headers_to_check:
        header_value = request.headers.get(header_name)
        if header_value:
            # X-Forwarded-For can contain multiple IPs: "client, proxy1, proxy2"
            # We want the first (leftmost) IP which is the original client
            if header_name == "x-forwarded-for":
                # Split by comma and take the first IP, strip whitespace
                first_ip = header_value.split(",")[0].strip()
                if first_ip and first_ip != "unknown" and _is_valid_ip(first_ip):
                    return first_ip
            else:
                # For other headers, use the value directly
                if header_value != "unknown" and _is_valid_ip(header_value.strip()):
                    return header_value.strip()

    # Fallback to the direct client IP if no proxy headers found
    if request.client:
        return request.client.host

    return None


def _is_valid_ip(ip: str) -> bool:
    """Basic IP address validation.

    Args:
        ip: IP address string to validate

    Returns:
        True if the IP appears to be valid, False otherwise
    """
    if not ip:
        return False

    # Basic validation - check if it looks like an IPv4 or IPv6 address
    # This is not comprehensive but catches obvious invalid values
    import re

    # IPv4 pattern (basic)
    ipv4_pattern = r'^(\d{1,3}\.){3}\d{1,3}$'
    # IPv6 pattern (basic)
    ipv6_pattern = r'^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$'

    return bool(re.match(ipv4_pattern, ip) or re.match(ipv6_pattern, ip))


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
        
        # Get the real client IP (handles proxy headers)
        real_client_ip = get_real_client_ip(request)

        # Prepare request logging info
        request_info = {
            "request_id": request_id,
            "method": request.method,
            "url": str(request.url),
            "client": real_client_ip,
            "client_direct": request.client.host if request.client else None,  # Keep original for debugging
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
