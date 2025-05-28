import logging
import sys
from typing import Any, Dict

from loguru import logger
# In Pydantic v2, BaseSettings has moved to pydantic-settings package
try:
    from pydantic_settings import BaseSettings
except ImportError:
    # Fallback for Pydantic v1
    from pydantic import BaseSettings


class LogConfig(BaseSettings):
    """Logging configuration"""
    
    # Logging level
    LEVEL: str = "INFO"
    
    # Logging format
    FORMAT: str = (
        "<green>{time:YYYY-MM-DD HH:mm:ss.SSS}</green> | "
        "<level>{level: <8}</level> | "
        "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> | "
        "<level>{message}</level>"
    )
    
    # Whether to serialize the log message to JSON
    JSON_LOGS: bool = False


class InterceptHandler(logging.Handler):
    """
    Intercept handler to route standard logging to loguru.
    """
    
    def emit(self, record: logging.LogRecord) -> None:
        # Get corresponding Loguru level if it exists
        try:
            level = logger.level(record.levelname).name
        except ValueError:
            level = record.levelno

        # Find caller from where originated the logged message
        frame, depth = logging.currentframe(), 2
        
        # Safeguard: Check if frame exists and if logging.__file__ is accessible
        if frame is not None and hasattr(logging, '__file__'):
            # Traverse frames to find the original caller
            max_depth = 25  # Prevent infinite loops
            while (frame is not None and frame.f_back is not None and 
                   hasattr(frame, 'f_code') and hasattr(frame.f_code, 'co_filename') and
                   frame.f_code.co_filename == logging.__file__ and depth < max_depth):
                frame = frame.f_back
                depth += 1

        logger.opt(depth=depth, exception=record.exc_info).log(
            level, record.getMessage()
        )


def get_logger(name: str):
    """Get a logger instance with the specified name.
    
    Args:
        name: The name of the logger, typically the module name.
        
    Returns:
        A logger instance bound with the specified name.
    """
    # Create a logger with the specified name
    return logger.bind(name=name)


def format_exception(record: Dict[str, Any]) -> str:
    """Format exception traceback more concisely.
    
    This formatter is used to make exception logs more concise by:
    1. Checking if the exception is a common one that doesn't need a full traceback
    2. Formatting the traceback in a more readable way
    
    Args:
        record: The log record containing exception information
        
    Returns:
        Formatted exception string
    """
    # Get exception information
    exception = record.get("exception")
    if not exception:
        return ""
        
    # Get exception type and message
    exc_type, exc_value, _ = exception
    
    # Check for common errors that don't need full traceback
    if exc_type.__name__ == "CircuitBreakerOpenError":
        return f"\n{exc_type.__name__}: {exc_value}"
    
    # For other exceptions, return a simplified traceback
    return ""  # Return empty string to use default formatting


def setup_logging() -> None:
    """Configure logging with loguru."""
    log_config = LogConfig()
    
    # Remove default configuration
    logger.remove()
    
    # Add custom configuration
    logger.add(
        sys.stdout,
        enqueue=True,
        backtrace=True,
        level=log_config.LEVEL,
        format=log_config.FORMAT,
        serialize=log_config.JSON_LOGS,
        format_exc=format_exception,  # Use our custom exception formatter
    )
    
    # Add file logging if needed
    logger.add(
        "logs/web2img.log",
        rotation="10 MB",
        retention="1 week",
        enqueue=True,
        backtrace=True,
        level=log_config.LEVEL,
        format=log_config.FORMAT,
        serialize=log_config.JSON_LOGS,
        format_exc=format_exception,  # Use our custom exception formatter
    )
    
    # Intercept standard logging
    logging.basicConfig(handlers=[InterceptHandler()], level=0)
    
    # Update root logger
    logging.getLogger("uvicorn").handlers = [InterceptHandler()]
    
    # Replace logging handlers for commonly used libraries
    for logger_name in [
        "uvicorn",
        "uvicorn.error",
        "fastapi",
        "gunicorn",
        "gunicorn.error",
        "gunicorn.access",
    ]:
        logging_logger = logging.getLogger(logger_name)
        logging_logger.handlers = [InterceptHandler()]

    # Done
    logger.info("Logging configuration completed")