import json
import logging
import sys
import time
from datetime import datetime
from typing import Dict, Any, Optional

from app.core.config import settings


class JsonFormatter(logging.Formatter):
    """Custom formatter to output logs in JSON format for better parsing."""
    
    def format(self, record: logging.LogRecord) -> str:
        """Format the log record as a JSON string.
        
        Args:
            record: The log record to format
            
        Returns:
            JSON formatted log string
        """
        # Get the original message
        message = record.getMessage()
        
        # Create the base log object
        log_object = {
            "timestamp": datetime.fromtimestamp(record.created).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": message,
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
            "process_id": record.process,
            "thread_id": record.thread,
        }
        
        # Add exception info if present
        if record.exc_info:
            log_object["exception"] = {
                "type": record.exc_info[0].__name__,
                "message": str(record.exc_info[1]),
                "traceback": self.formatException(record.exc_info)
            }
        
        # Add extra fields from the record
        if hasattr(record, "extra") and record.extra:
            log_object.update(record.extra)
        
        # Convert to JSON string
        return json.dumps(log_object)


class StructuredLogger:
    """Structured logger for the application."""
    
    def __init__(self, name: str):
        """Initialize the structured logger.
        
        Args:
            name: Logger name
        """
        self.logger = logging.getLogger(name)
        self.logger.setLevel(self._get_log_level())
        
        # Remove existing handlers if any
        for handler in self.logger.handlers[:]:  
            self.logger.removeHandler(handler)
        
        # Add console handler with JSON formatter
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JsonFormatter())
        self.logger.addHandler(handler)
    
    def _get_log_level(self) -> int:
        """Get the log level from settings.
        
        Returns:
            Log level as an integer
        """
        level = getattr(settings, "log_level", "INFO").upper()
        return getattr(logging, level, logging.INFO)
    
    def _log(self, level: int, msg: str, extra: Optional[Dict[str, Any]] = None) -> None:
        """Log a message with the given level and extra data.
        
        Args:
            level: Log level
            msg: Log message
            extra: Extra data to include in the log
        """
        # Create a copy of extra to avoid modifying the original
        log_extra = {"extra": extra or {}}
        
        # Add request_id if present in the current context
        # This would typically be set by middleware for each request
        # For now, we'll just use a placeholder
        
        self.logger.log(level, msg, extra=log_extra)
    
    def debug(self, msg: str, extra: Optional[Dict[str, Any]] = None) -> None:
        """Log a debug message.
        
        Args:
            msg: Log message
            extra: Extra data to include in the log
        """
        self._log(logging.DEBUG, msg, extra)
    
    def info(self, msg: str, extra: Optional[Dict[str, Any]] = None) -> None:
        """Log an info message.
        
        Args:
            msg: Log message
            extra: Extra data to include in the log
        """
        self._log(logging.INFO, msg, extra)
    
    def warning(self, msg: str, extra: Optional[Dict[str, Any]] = None) -> None:
        """Log a warning message.
        
        Args:
            msg: Log message
            extra: Extra data to include in the log
        """
        self._log(logging.WARNING, msg, extra)
    
    def error(self, msg: str, extra: Optional[Dict[str, Any]] = None) -> None:
        """Log an error message.
        
        Args:
            msg: Log message
            extra: Extra data to include in the log
        """
        self._log(logging.ERROR, msg, extra)
    
    def critical(self, msg: str, extra: Optional[Dict[str, Any]] = None) -> None:
        """Log a critical message.
        
        Args:
            msg: Log message
            extra: Extra data to include in the log
        """
        self._log(logging.CRITICAL, msg, extra)
    
    def exception(self, msg: str, extra: Optional[Dict[str, Any]] = None) -> None:
        """Log an exception message.
        
        Args:
            msg: Log message
            extra: Extra data to include in the log
        """
        log_extra = {"extra": extra or {}}
        self.logger.exception(msg, extra=log_extra)


# Create a function to get a logger instance
def get_logger(name: str) -> StructuredLogger:
    """Get a structured logger instance.
    
    Args:
        name: Logger name
        
    Returns:
        Structured logger instance
    """
    return StructuredLogger(name)


# Create a default logger for the application
logger = get_logger("web2img")
