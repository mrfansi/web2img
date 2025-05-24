import logging
import sys
from typing import Any, Dict, List, Optional

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
    return logger.bind(name=name)


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