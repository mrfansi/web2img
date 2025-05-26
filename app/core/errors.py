import traceback
from typing import Dict, Any, Optional, Type


# Define common HTTP status codes to avoid dependency on FastAPI
HTTP_200_OK = 200
HTTP_202_ACCEPTED = 202
HTTP_400_BAD_REQUEST = 400
HTTP_401_UNAUTHORIZED = 401
HTTP_403_FORBIDDEN = 403
HTTP_404_NOT_FOUND = 404
HTTP_422_UNPROCESSABLE_ENTITY = 422
HTTP_429_TOO_MANY_REQUESTS = 429
HTTP_500_INTERNAL_SERVER_ERROR = 500
HTTP_503_SERVICE_UNAVAILABLE = 503

class WebToImgError(Exception):
    """Base exception class for web2img service.
    
    This provides a standardized way to handle errors with detailed context.
    """
    def __init__(self, 
                 message: str, 
                 error_code: str = "internal_error",
                 http_status: int = HTTP_500_INTERNAL_SERVER_ERROR,
                 context: Optional[Dict[str, Any]] = None,
                 original_exception: Optional[Exception] = None):
        self.message = message
        self.error_code = error_code
        self.http_status = http_status
        self.context = context or {}
        self.original_exception = original_exception
        self.traceback = traceback.format_exc() if original_exception else None
        
        # Add original exception details to context if available
        if original_exception:
            self.context.update({
                "original_error_type": type(original_exception).__name__,
                "original_error": str(original_exception)
            })
            
        super().__init__(self.message)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert the error to a dictionary for API responses."""
        result = {
            "error": True,
            "error_code": self.error_code,
            "message": self.message,
        }
        
        # Include non-sensitive context information
        safe_context = {}
        for key, value in self.context.items():
            # Skip sensitive keys or None values
            if key not in ["password", "token", "secret", "key"] and value is not None:
                safe_context[key] = value
                
        if safe_context:
            result["details"] = safe_context
            
        return result


# Browser and screenshot specific errors
class BrowserError(WebToImgError):
    """Error related to browser operations."""
    def __init__(self, message: str, context: Optional[Dict[str, Any]] = None, original_exception: Optional[Exception] = None):
        super().__init__(
            message=message,
            error_code="browser_error",
            http_status=500,
            context=context,
            original_exception=original_exception
        )


class BrowserPoolExhaustedError(BrowserError):
    """Error when the browser pool is exhausted."""
    def __init__(self, context: Optional[Dict[str, Any]] = None):
        super().__init__(
            message="Browser pool exhausted. The service is experiencing high load. Please try again later.",
            context=context
        )


class BrowserTimeoutError(BrowserError):
    """Error when browser operations timeout."""
    def __init__(self, message: str = "Browser operation timed out", context: Optional[Dict[str, Any]] = None, original_exception: Optional[Exception] = None):
        super().__init__(
            message=message,
            context=context,
            original_exception=original_exception
        )


class NavigationError(WebToImgError):
    """Error during page navigation."""
    def __init__(self, url: str, context: Optional[Dict[str, Any]] = None, original_exception: Optional[Exception] = None):
        message = f"Failed to navigate to {url}. "
        
        # Provide more specific messages based on common navigation errors
        if original_exception:
            error_str = str(original_exception).lower()
            if "timeout" in error_str:
                message += "The page took too long to load. It might be temporarily unavailable or too complex."
            elif "net::" in error_str:
                message += "A network error occurred. The site might be unreachable or blocking automated access."
            elif "certificate" in error_str:
                message += "There was an SSL certificate issue with the website."
            elif "blocked" in error_str or "permission" in error_str:
                message += "Access to the website was denied or blocked."
            else:
                message += f"Reason: {str(original_exception)}"
        
        super().__init__(
            message=message,
            error_code="navigation_error",
            http_status=HTTP_422_UNPROCESSABLE_ENTITY,
            context=context,
            original_exception=original_exception
        )


class ScreenshotError(WebToImgError):
    """Error during screenshot capture."""
    def __init__(self, url: str, context: Optional[Dict[str, Any]] = None, original_exception: Optional[Exception] = None):
        message = f"Failed to capture screenshot of {url}. "
        
        # Provide more specific messages based on common screenshot errors
        if original_exception:
            error_str = str(original_exception).lower()
            if "timeout" in error_str:
                message += "The operation timed out. The page might be too complex or resource-intensive."
            elif "memory" in error_str:
                message += "The browser ran out of memory while processing the page."
            elif "closed" in error_str:
                message += "The browser context was unexpectedly closed during capture."
            else:
                message += f"Reason: {str(original_exception)}"
        
        super().__init__(
            message=message,
            error_code="screenshot_error",
            http_status=HTTP_422_UNPROCESSABLE_ENTITY,
            context=context,
            original_exception=original_exception
        )


# Storage related errors
class StorageError(WebToImgError):
    """Error related to storage operations."""
    def __init__(self, message: str, context: Optional[Dict[str, Any]] = None, original_exception: Optional[Exception] = None):
        super().__init__(
            message=message,
            error_code="storage_error",
            http_status=500,
            context=context,
            original_exception=original_exception
        )


class UploadError(StorageError):
    """Error during file upload to storage."""
    def __init__(self, filepath: str, context: Optional[Dict[str, Any]] = None, original_exception: Optional[Exception] = None):
        message = f"Failed to upload file {filepath}. "
        
        # Provide more specific messages based on common upload errors
        if original_exception:
            error_str = str(original_exception).lower()
            if "access denied" in error_str or "permission" in error_str:
                message += "Access to the storage was denied. Please check your credentials."
            elif "not found" in error_str:
                message += "The file to upload was not found."
            elif "timeout" in error_str:
                message += "The upload operation timed out. Please try again later."
            elif "quota" in error_str or "limit" in error_str:
                message += "Storage quota exceeded or rate limit reached."
            else:
                message += f"Reason: {str(original_exception)}"
        
        super().__init__(
            message=message,
            error_code="upload_error",
            context=context,
            original_exception=original_exception
        )


# Validation and input errors
class ValidationError(WebToImgError):
    """Error for invalid input parameters."""
    def __init__(self, message: str, field: Optional[str] = None, context: Optional[Dict[str, Any]] = None):
        if field:
            context = context or {}
            context["field"] = field
            message = f"Invalid value for '{field}': {message}"
        
        super().__init__(
            message=message,
            error_code="validation_error",
            http_status=HTTP_400_BAD_REQUEST,
            context=context
        )


# Circuit breaker errors
class CircuitBreakerOpenError(WebToImgError):
    """Error when a circuit breaker is open."""
    def __init__(self, name: str, context: Optional[Dict[str, Any]] = None):
        super().__init__(
            message=f"Service protection activated for {name}. Too many errors occurred recently. Please try again later.",
            error_code="circuit_breaker_open",
            http_status=HTTP_503_SERVICE_UNAVAILABLE,
            context=context
        )


# System capacity errors
class SystemOverloadedError(WebToImgError):
    """Error when the system is overloaded and cannot accept more requests."""
    def __init__(self, message: str = "System is currently overloaded. Please try again later.", context: Optional[Dict[str, Any]] = None):
        super().__init__(
            message=message,
            error_code="system_overloaded",
            http_status=HTTP_429_TOO_MANY_REQUESTS,
            context=context
        )


# Retry related errors
class MaxRetriesExceededError(WebToImgError):
    """Error when maximum retries are exceeded."""
    def __init__(self, operation: str, retries: int, context: Optional[Dict[str, Any]] = None, original_exception: Optional[Exception] = None):
        super().__init__(
            message=f"Operation '{operation}' failed after {retries} retries. Please try again later.",
            error_code="max_retries_exceeded",
            http_status=HTTP_503_SERVICE_UNAVAILABLE,
            context=context,
            original_exception=original_exception
        )


# Helper functions for error handling
def get_error_response(error: Exception) -> Dict[str, Any]:
    """Convert any exception to a standardized API response.
    
    Args:
        error: The exception to convert
        
    Returns:
        A dictionary with error details suitable for API responses
    """
    if isinstance(error, WebToImgError):
        return error.to_dict()
    
    # Convert standard exceptions to our format
    return WebToImgError(
        message=str(error),
        error_code="internal_error",
        original_exception=error
    ).to_dict()


def classify_exception(exc: Exception) -> Type[WebToImgError]:
    """Classify a standard exception into our custom error types.
    
    Args:
        exc: The exception to classify
        
    Returns:
        The appropriate WebToImgError subclass
    """
    error_str = str(exc).lower()
    
    # Network and connection errors
    if any(term in error_str for term in ["connection", "network", "socket", "timeout"]):
        return NavigationError
    
    # Browser and page errors
    if any(term in error_str for term in ["browser", "context", "page", "playwright"]):
        return BrowserError
    
    # Storage errors
    if any(term in error_str for term in ["storage", "upload", "download", "s3", "r2", "bucket"]):
        return StorageError
    
    # Default to base error
    return WebToImgError
