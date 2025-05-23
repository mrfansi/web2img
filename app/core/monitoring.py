import time
import asyncio
import json
from typing import Dict, Any, List, Optional, Callable, Awaitable
from datetime import datetime, timedelta
from collections import defaultdict, deque

from app.core.logging import logger


class MetricsCollector:
    """Collects and manages metrics for the web2img service.
    
    This class provides methods for recording various metrics such as
    request counts, error rates, response times, and resource usage.
    It also provides methods for retrieving metrics for monitoring
    and analytics purposes.
    """
    def __init__(self):
        # Initialize metrics storage
        self._metrics = {
            # Request metrics
            "requests": {
                "total": 0,
                "success": 0,
                "error": 0,
                "by_endpoint": defaultdict(int),
                "by_status": defaultdict(int),
            },
            # Response time metrics (in milliseconds)
            "response_times": {
                "avg": 0,
                "min": float('inf'),
                "max": 0,
                "p50": 0,  # 50th percentile (median)
                "p95": 0,  # 95th percentile
                "p99": 0,  # 99th percentile
                "by_endpoint": defaultdict(list),
            },
            # Error metrics
            "errors": {
                "total": 0,
                "by_type": defaultdict(int),
                "by_endpoint": defaultdict(int),
                "recent": deque(maxlen=100),  # Store recent errors for analysis
            },
            # Resource usage metrics
            "resources": {
                "memory": {
                    "current": 0,
                    "peak": 0,
                },
                "cpu": {
                    "current": 0,
                    "peak": 0,
                },
                "disk": {
                    "used": 0,
                    "total": 0,
                },
            },
            # Browser pool metrics
            "browser_pool": {
                "size": 0,
                "available": 0,
                "in_use": 0,
                "created": 0,
                "reused": 0,
                "errors": 0,
                "recycled": 0,
                "peak_usage": 0,
            },
            # Cache metrics
            "cache": {
                "hits": 0,
                "misses": 0,
                "size": 0,
                "max_size": 0,
                "hit_rate": 0,
            },
            # Retry metrics
            "retries": {
                "attempts": 0,
                "successes": 0,
                "failures": 0,
                "circuit_breaker_rejections": 0,
            },
            # Timeouts
            "timeouts": {
                "navigation": 0,
                "browser": 0,
                "context": 0,
                "page": 0,
                "screenshot": 0,
            },
            # Batch processing metrics
            "batch": {
                "jobs_created": 0,
                "jobs_completed": 0,
                "jobs_failed": 0,
                "items_processed": 0,
                "items_succeeded": 0,
                "items_failed": 0,
                "avg_processing_time": 0,
            },
            # System metrics
            "system": {
                "uptime": 0,
                "start_time": time.time(),
            },
        }
        
        # Store raw response times for percentile calculations
        self._response_times = deque(maxlen=10000)  # Store last 10,000 response times
        
        # Store time series data for charts and trends
        self._time_series = {
            "requests": defaultdict(list),  # List of (timestamp, count) tuples
            "errors": defaultdict(list),
            "response_times": defaultdict(list),
            "resources": defaultdict(list),
        }
        
        # Store alerts configuration and state
        self._alerts = {
            "error_rate": {
                "threshold": 0.05,  # 5% error rate
                "triggered": False,
                "last_triggered": None,
            },
            "response_time": {
                "threshold": 5000,  # 5 seconds
                "triggered": False,
                "last_triggered": None,
            },
            "memory_usage": {
                "threshold": 0.9,  # 90% of available memory
                "triggered": False,
                "last_triggered": None,
            },
            "browser_pool_exhaustion": {
                "threshold": 0.9,  # 90% of pool in use
                "triggered": False,
                "last_triggered": None,
            },
        }
        
        # Alert handlers
        self._alert_handlers = []
        
        # Start background tasks
        self._start_background_tasks()
    
    def _start_background_tasks(self):
        """Start background tasks for metrics collection and processing."""
        # These would be started in an async context
        pass
    
    def record_request(self, endpoint: str, status_code: int, duration_ms: float):
        """Record a request and its outcome.
        
        Args:
            endpoint: The API endpoint that was called
            status_code: The HTTP status code of the response
            duration_ms: The request duration in milliseconds
        """
        # Update request counts
        self._metrics["requests"]["total"] += 1
        self._metrics["requests"]["by_endpoint"][endpoint] += 1
        self._metrics["requests"]["by_status"][status_code] += 1
        
        # Update success/error counts
        if 200 <= status_code < 400:
            self._metrics["requests"]["success"] += 1
        else:
            self._metrics["requests"]["error"] += 1
            self._metrics["errors"]["total"] += 1
            self._metrics["errors"]["by_endpoint"][endpoint] += 1
        
        # Update response time metrics
        self._response_times.append(duration_ms)
        self._metrics["response_times"]["by_endpoint"][endpoint].append(duration_ms)
        
        # Update min/max response times
        self._metrics["response_times"]["min"] = min(self._metrics["response_times"]["min"], duration_ms)
        self._metrics["response_times"]["max"] = max(self._metrics["response_times"]["max"], duration_ms)
        
        # Update average response time
        if self._response_times:
            self._metrics["response_times"]["avg"] = sum(self._response_times) / len(self._response_times)
        
        # Update percentiles
        if len(self._response_times) >= 10:  # Only calculate percentiles with enough data
            sorted_times = sorted(self._response_times)
            self._metrics["response_times"]["p50"] = sorted_times[len(sorted_times) // 2]
            self._metrics["response_times"]["p95"] = sorted_times[int(len(sorted_times) * 0.95)]
            self._metrics["response_times"]["p99"] = sorted_times[int(len(sorted_times) * 0.99)]
        
        # Update time series data
        timestamp = time.time()
        self._time_series["requests"]["total"].append((timestamp, self._metrics["requests"]["total"]))
        self._time_series["requests"][endpoint].append((timestamp, self._metrics["requests"]["by_endpoint"][endpoint]))
        self._time_series["response_times"]["avg"].append((timestamp, self._metrics["response_times"]["avg"]))
        
        # Check for alerts
        self._check_alerts()
    
    def record_error(self, error_type: str, endpoint: str, error_details: Dict[str, Any]):
        """Record an error.
        
        Args:
            error_type: The type of error (e.g., "navigation_error", "browser_error")
            endpoint: The API endpoint where the error occurred
            error_details: Additional details about the error
        """
        # Update error counts
        self._metrics["errors"]["total"] += 1
        self._metrics["errors"]["by_type"][error_type] += 1
        self._metrics["errors"]["by_endpoint"][endpoint] += 1
        
        # Add to recent errors
        error_record = {
            "timestamp": time.time(),
            "type": error_type,
            "endpoint": endpoint,
            "details": error_details,
        }
        self._metrics["errors"]["recent"].append(error_record)
        
        # Update time series data
        timestamp = time.time()
        self._time_series["errors"]["total"].append((timestamp, self._metrics["errors"]["total"]))
        self._time_series["errors"][error_type].append((timestamp, self._metrics["errors"]["by_type"][error_type]))
        
        # Log the error
        logger.error(f"Monitoring recorded error: {error_type}", {
            "error_type": error_type,
            "endpoint": endpoint,
            **error_details
        })
        
        # Check for alerts
        self._check_alerts()
    
    def update_browser_pool_stats(self, stats: Dict[str, Any]):
        """Update browser pool statistics.
        
        Args:
            stats: Browser pool statistics
        """
        self._metrics["browser_pool"].update(stats)
        
        # Check for browser pool exhaustion alert
        if stats.get("max_size") > 0:
            usage_ratio = stats.get("in_use", 0) / stats.get("max_size", 1)
            if usage_ratio >= self._alerts["browser_pool_exhaustion"]["threshold"]:
                self._trigger_alert("browser_pool_exhaustion", {
                    "usage_ratio": usage_ratio,
                    "in_use": stats.get("in_use", 0),
                    "max_size": stats.get("max_size", 0),
                })
    
    def update_cache_stats(self, stats: Dict[str, Any]):
        """Update cache statistics.
        
        Args:
            stats: Cache statistics
        """
        self._metrics["cache"].update(stats)
        
        # Calculate hit rate
        total_requests = stats.get("hits", 0) + stats.get("misses", 0)
        if total_requests > 0:
            self._metrics["cache"]["hit_rate"] = stats.get("hits", 0) / total_requests
    
    def update_retry_stats(self, stats: Dict[str, Any]):
        """Update retry statistics.
        
        Args:
            stats: Retry statistics
        """
        self._metrics["retries"].update(stats)
    
    def update_timeout_stats(self, stats: Dict[str, Any]):
        """Update timeout statistics.
        
        Args:
            stats: Timeout statistics
        """
        self._metrics["timeouts"].update(stats)
    
    def update_batch_stats(self, stats: Dict[str, Any]):
        """Update batch processing statistics.
        
        Args:
            stats: Batch processing statistics
        """
        self._metrics["batch"].update(stats)
    
    def update_resource_usage(self, memory_usage: float, cpu_usage: float, disk_usage: Dict[str, float]):
        """Update resource usage metrics.
        
        Args:
            memory_usage: Memory usage in bytes
            cpu_usage: CPU usage as a percentage (0-100)
            disk_usage: Disk usage statistics
        """
        # Update memory metrics
        self._metrics["resources"]["memory"]["current"] = memory_usage
        self._metrics["resources"]["memory"]["peak"] = max(
            self._metrics["resources"]["memory"]["peak"], memory_usage
        )
        
        # Update CPU metrics
        self._metrics["resources"]["cpu"]["current"] = cpu_usage
        self._metrics["resources"]["cpu"]["peak"] = max(
            self._metrics["resources"]["cpu"]["peak"], cpu_usage
        )
        
        # Update disk metrics
        self._metrics["resources"]["disk"].update(disk_usage)
        
        # Update time series data
        timestamp = time.time()
        self._time_series["resources"]["memory"].append((timestamp, memory_usage))
        self._time_series["resources"]["cpu"].append((timestamp, cpu_usage))
        
        # Check for memory usage alert
        if "total" in disk_usage and disk_usage["total"] > 0:
            memory_ratio = memory_usage / disk_usage["total"]
            if memory_ratio >= self._alerts["memory_usage"]["threshold"]:
                self._trigger_alert("memory_usage", {
                    "memory_ratio": memory_ratio,
                    "memory_usage": memory_usage,
                    "total_memory": disk_usage["total"],
                })
    
    def update_system_metrics(self):
        """Update system-wide metrics."""
        # Update uptime
        self._metrics["system"]["uptime"] = time.time() - self._metrics["system"]["start_time"]
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get all metrics.
        
        Returns:
            Dictionary containing all metrics
        """
        # Update system metrics before returning
        self.update_system_metrics()
        
        # Create a serializable copy of the metrics
        metrics_copy = {}
        for key, value in self._metrics.items():
            if key == "response_times" and "by_endpoint" in self._metrics[key]:
                # Handle response_times.by_endpoint which contains deque objects
                metrics_copy[key] = {
                    k: v for k, v in self._metrics[key].items() if k != "by_endpoint"
                }
                metrics_copy[key]["by_endpoint"] = {
                    endpoint: list(times) for endpoint, times in self._metrics[key]["by_endpoint"].items()
                }
            elif key == "errors" and "recent" in self._metrics[key]:
                # Handle errors.recent which is a deque
                metrics_copy[key] = {
                    k: v for k, v in self._metrics[key].items() if k != "recent"
                }
                metrics_copy[key]["recent"] = list(self._metrics[key]["recent"])
            else:
                metrics_copy[key] = value
        
        return metrics_copy
    
    def get_time_series(self, metric_type: str, name: str, start_time: Optional[float] = None, end_time: Optional[float] = None) -> List[tuple]:
        """Get time series data for a specific metric.
        
        Args:
            metric_type: The type of metric (e.g., "requests", "errors")
            name: The specific metric name (e.g., "total", "navigation_error")
            start_time: Start time for filtering (Unix timestamp)
            end_time: End time for filtering (Unix timestamp)
            
        Returns:
            List of (timestamp, value) tuples
        """
        if metric_type not in self._time_series or name not in self._time_series[metric_type]:
            return []
        
        data = self._time_series[metric_type][name]
        
        # Filter by time range if specified
        if start_time is not None or end_time is not None:
            filtered_data = []
            for timestamp, value in data:
                if (start_time is None or timestamp >= start_time) and \
                   (end_time is None or timestamp <= end_time):
                    filtered_data.append((timestamp, value))
            return filtered_data
        
        return data
    
    def register_alert_handler(self, handler: Callable[[str, Dict[str, Any]], Awaitable[None]]):
        """Register a handler for alerts.
        
        Args:
            handler: Async function to call when an alert is triggered
        """
        self._alert_handlers.append(handler)
    
    def _check_alerts(self):
        """Check for alert conditions."""
        # Check error rate alert
        total_requests = self._metrics["requests"]["total"]
        if total_requests > 0:
            error_rate = self._metrics["requests"]["error"] / total_requests
            if error_rate >= self._alerts["error_rate"]["threshold"]:
                self._trigger_alert("error_rate", {
                    "error_rate": error_rate,
                    "error_count": self._metrics["requests"]["error"],
                    "total_requests": total_requests,
                })
        
        # Check response time alert
        if self._metrics["response_times"]["p95"] >= self._alerts["response_time"]["threshold"]:
            self._trigger_alert("response_time", {
                "p95_response_time": self._metrics["response_times"]["p95"],
                "threshold": self._alerts["response_time"]["threshold"],
            })
    
    def _trigger_alert(self, alert_type: str, details: Dict[str, Any]):
        """Trigger an alert.
        
        Args:
            alert_type: The type of alert
            details: Additional details about the alert
        """
        # Update alert state
        self._alerts[alert_type]["triggered"] = True
        self._alerts[alert_type]["last_triggered"] = time.time()
        
        # Log the alert
        logger.warning(f"Monitoring alert triggered: {alert_type}", {
            "alert_type": alert_type,
            **details
        })
        
        # Call alert handlers
        for handler in self._alert_handlers:
            # In an async context, we would await these calls
            pass


# Create a singleton instance
metrics_collector = MetricsCollector()


async def collect_resource_metrics():
    """Collect resource metrics periodically."""
    try:
        import psutil
    except ImportError:
        logger.warning("psutil not installed, resource metrics collection disabled")
        return
    
    while True:
        try:
            # Collect memory usage
            memory = psutil.virtual_memory()
            memory_usage = memory.used
            
            # Collect CPU usage
            cpu_usage = psutil.cpu_percent(interval=1)
            
            # Collect disk usage
            disk = psutil.disk_usage('/')
            disk_usage = {
                "used": disk.used,
                "total": disk.total,
            }
            
            # Update metrics
            metrics_collector.update_resource_usage(
                memory_usage=memory_usage,
                cpu_usage=cpu_usage,
                disk_usage=disk_usage
            )
        except Exception as e:
            logger.error(f"Error collecting resource metrics: {str(e)}")
        
        # Sleep for 10 seconds
        await asyncio.sleep(10)


async def start_monitoring():
    """Start the monitoring system."""
    # Start resource metrics collection
    asyncio.create_task(collect_resource_metrics())
    
    logger.info("Monitoring system started")


async def stop_monitoring():
    """Stop the monitoring system."""
    # Nothing to do here yet
    logger.info("Monitoring system stopped")
