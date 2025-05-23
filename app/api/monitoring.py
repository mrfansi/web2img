from typing import Dict, Any, Optional
from fastapi import APIRouter, Query

from app.core.monitoring import metrics_collector
from app.core.errors import HTTP_200_OK

# Create a router for monitoring endpoints
router = APIRouter(tags=["monitoring"])


@router.get(
    "/metrics",
    status_code=HTTP_200_OK,
    summary="Get service metrics",
    description="""
    Get detailed metrics about the service's performance, error rates, and resource usage.
    
    ## Available Metrics
    
    - **Requests**: Total requests, success/error counts, and counts by endpoint
    - **Response Times**: Average, min, max, and percentile response times
    - **Errors**: Error counts by type and endpoint
    - **Resources**: Memory, CPU, and disk usage
    - **Browser Pool**: Pool size, usage, and error statistics
    - **Cache**: Hit/miss counts and hit rate
    - **Retries**: Retry attempts, successes, and failures
    - **Batch Processing**: Job and item processing statistics
    
    ## Filtering
    
    Use the `sections` parameter to filter which metric sections to include in the response.
    """,
)
async def get_metrics(
    sections: Optional[str] = Query(
        None,
        description="Comma-separated list of metric sections to include (e.g., 'requests,errors')"
    )
) -> Dict[str, Any]:
    """Get service metrics.
    
    Args:
        sections: Optional comma-separated list of metric sections to include
        
    Returns:
        Dictionary containing the requested metrics
    """
    # Get all metrics
    metrics = metrics_collector.get_metrics()
    
    # Filter by sections if specified
    if sections:
        section_list = [s.strip() for s in sections.split(',')]
        filtered_metrics = {}
        for section in section_list:
            if section in metrics:
                filtered_metrics[section] = metrics[section]
        return filtered_metrics
    
    return metrics


@router.get(
    "/metrics/time-series",
    status_code=HTTP_200_OK,
    summary="Get time series metrics",
    description="""
    Get time series data for a specific metric over time.
    
    ## Available Metric Types
    
    - **requests**: Request counts over time
    - **errors**: Error counts over time
    - **response_times**: Response times over time
    - **resources**: Resource usage over time
    
    ## Time Range
    
    Optionally specify a time range using `start_time` and `end_time` parameters.
    """,
)
async def get_time_series_metrics(
    metric_type: str = Query(..., description="Type of metric (e.g., 'requests', 'errors')"),
    name: str = Query(..., description="Specific metric name (e.g., 'total', 'navigation_error')"),
    start_time: Optional[float] = Query(None, description="Start time (Unix timestamp)"),
    end_time: Optional[float] = Query(None, description="End time (Unix timestamp)"),
) -> Dict[str, Any]:
    """Get time series data for a specific metric.
    
    Args:
        metric_type: Type of metric (e.g., 'requests', 'errors')
        name: Specific metric name (e.g., 'total', 'navigation_error')
        start_time: Optional start time (Unix timestamp)
        end_time: Optional end time (Unix timestamp)
        
    Returns:
        Dictionary containing time series data
    """
    data = metrics_collector.get_time_series(metric_type, name, start_time, end_time)
    
    # Format the response
    return {
        "metric_type": metric_type,
        "name": name,
        "start_time": start_time,
        "end_time": end_time,
        "data_points": len(data),
        "data": [
            {"timestamp": ts, "value": val} for ts, val in data
        ],
    }


@router.get(
    "/metrics/errors",
    status_code=HTTP_200_OK,
    summary="Get detailed error information",
    description="""
    Get detailed information about recent errors.
    
    This endpoint provides access to the most recent errors recorded by the service,
    including error types, endpoints, and detailed error information.
    
    ## Filtering
    
    Optionally filter errors by type or limit the number of errors returned.
    """,
)
async def get_error_metrics(
    error_type: Optional[str] = Query(None, description="Filter by error type"),
    limit: int = Query(10, description="Maximum number of errors to return"),
) -> Dict[str, Any]:
    """Get detailed error information.
    
    Args:
        error_type: Optional filter by error type
        limit: Maximum number of errors to return
        
    Returns:
        Dictionary containing error metrics and recent errors
    """
    # Get all metrics
    metrics = metrics_collector.get_metrics()
    
    # Extract error metrics
    error_metrics = metrics.get("errors", {})
    
    # Filter recent errors
    recent_errors = error_metrics.get("recent", [])
    if error_type:
        recent_errors = [e for e in recent_errors if e.get("type") == error_type]
    
    # Limit the number of errors
    recent_errors = recent_errors[:limit]
    
    # Format the response
    return {
        "total_errors": error_metrics.get("total", 0),
        "by_type": error_metrics.get("by_type", {}),
        "by_endpoint": error_metrics.get("by_endpoint", {}),
        "recent_errors": recent_errors,
    }


@router.get(
    "/metrics/performance",
    status_code=HTTP_200_OK,
    summary="Get performance metrics",
    description="""
    Get detailed performance metrics for the service.
    
    This endpoint provides access to response time metrics, resource usage,
    and other performance-related metrics.
    
    ## Available Metrics
    
    - **Response Times**: Average, min, max, and percentile response times
    - **Resources**: Memory, CPU, and disk usage
    - **Browser Pool**: Pool size, usage, and performance statistics
    - **Cache**: Hit/miss counts and hit rate
    """,
)
async def get_performance_metrics() -> Dict[str, Any]:
    """Get performance metrics.
    
    Returns:
        Dictionary containing performance metrics
    """
    # Get all metrics
    metrics = metrics_collector.get_metrics()
    
    # Extract performance-related metrics
    return {
        "response_times": metrics.get("response_times", {}),
        "resources": metrics.get("resources", {}),
        "browser_pool": metrics.get("browser_pool", {}),
        "cache": metrics.get("cache", {}),
        "system": metrics.get("system", {}),
    }
