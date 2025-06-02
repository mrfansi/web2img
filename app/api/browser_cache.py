"""
Browser Cache API Endpoints
Provides endpoints to manage browser cache for CSS, JS, and media files
"""

from typing import Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.browser_cache import browser_cache_service
from app.core.logging import get_logger

# Create router
router = APIRouter(tags=["browser-cache"])
logger = get_logger("browser_cache_api")


class CacheStatsResponse(BaseModel):
    """Model for cache statistics response."""
    hits: int = Field(..., description="Number of cache hits")
    misses: int = Field(..., description="Number of cache misses")
    stores: int = Field(..., description="Number of items stored in cache")
    errors: int = Field(..., description="Number of cache errors")
    total_size: int = Field(..., description="Total cache size in bytes")
    cleanup_runs: int = Field(..., description="Number of cleanup runs")
    hit_rate: float = Field(..., description="Cache hit rate (0.0 to 1.0)")
    cache_size_mb: float = Field(..., description="Cache size in MB")
    max_cache_size_mb: float = Field(..., description="Maximum cache size in MB")
    cached_items: int = Field(..., description="Number of cached items")
    enabled: bool = Field(..., description="Whether cache is enabled")
    cache_dir: str = Field(..., description="Cache directory path")


class CacheCleanupResponse(BaseModel):
    """Model for cache cleanup response."""
    removed: int = Field(..., description="Number of items removed")
    errors: int = Field(..., description="Number of errors during cleanup")


@router.get(
    "/browser-cache/stats",
    response_model=CacheStatsResponse,
    summary="Get browser cache statistics",
    description="Get detailed statistics about the browser cache including hit rates, size, and performance metrics"
)
async def get_cache_stats() -> CacheStatsResponse:
    """Get browser cache statistics."""
    try:
        stats = browser_cache_service.get_cache_stats()
        return CacheStatsResponse(**stats)
    except Exception as e:
        logger.error(f"Failed to get cache stats: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get cache stats: {str(e)}")


@router.post(
    "/browser-cache/cleanup",
    response_model=CacheCleanupResponse,
    summary="Clean up browser cache",
    description="Manually trigger browser cache cleanup to remove expired and oversized items"
)
async def cleanup_cache() -> CacheCleanupResponse:
    """Manually trigger cache cleanup."""
    try:
        result = await browser_cache_service.cleanup_cache()
        logger.info(f"Manual cache cleanup completed: removed {result['removed']} items")
        return CacheCleanupResponse(**result)
    except Exception as e:
        logger.error(f"Failed to cleanup cache: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to cleanup cache: {str(e)}")


@router.delete(
    "/browser-cache/clear",
    response_model=CacheCleanupResponse,
    summary="Clear all browser cache",
    description="Clear all cached items from the browser cache"
)
async def clear_cache() -> CacheCleanupResponse:
    """Clear all cache."""
    try:
        result = await browser_cache_service.clear_cache()
        logger.info(f"Cache cleared: removed {result['removed']} items")
        return CacheCleanupResponse(**result)
    except Exception as e:
        logger.error(f"Failed to clear cache: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to clear cache: {str(e)}")


@router.get(
    "/browser-cache/info",
    summary="Get browser cache information",
    description="Get information about browser cache configuration and capabilities"
)
async def get_cache_info() -> Dict[str, Any]:
    """Get browser cache information."""
    try:
        stats = browser_cache_service.get_cache_stats()
        
        return {
            "enabled": stats["enabled"],
            "cache_directory": stats["cache_dir"],
            "configuration": {
                "max_cache_size_mb": stats["max_cache_size_mb"],
                "max_file_size_mb": browser_cache_service.max_file_size / (1024 * 1024),
                "cache_ttl_hours": browser_cache_service.cache_ttl / 3600,
                "cleanup_interval_seconds": browser_cache_service.cache_ttl
            },
            "cacheable_patterns": browser_cache_service.cacheable_patterns,
            "priority_domains": list(browser_cache_service.priority_domains),
            "current_stats": {
                "cached_items": stats["cached_items"],
                "cache_size_mb": stats["cache_size_mb"],
                "hit_rate": stats["hit_rate"],
                "total_requests": stats["hits"] + stats["misses"]
            },
            "benefits": [
                "Faster page load times by caching CSS, JS, and media files",
                "Reduced timeout issues during domcontentloaded events",
                "Improved performance for sites with heavy resource dependencies",
                "Automatic cleanup of expired and oversized cache items",
                "Priority caching for common CDN resources"
            ]
        }
    except Exception as e:
        logger.error(f"Failed to get cache info: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get cache info: {str(e)}")


@router.get(
    "/browser-cache/test",
    summary="Test browser cache functionality",
    description="Test browser cache with sample URLs to verify caching behavior"
)
async def test_cache() -> Dict[str, Any]:
    """Test browser cache functionality."""
    try:
        # Test URLs that should be cacheable
        test_urls = [
            "https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.0/jquery.min.js",
            "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap",
            "https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css",
            "https://use.fontawesome.com/releases/v5.15.4/css/all.css"
        ]
        
        results = []
        for url in test_urls:
            is_cacheable = browser_cache_service._is_cacheable_resource(url)
            cache_key = browser_cache_service._get_cache_key(url)
            
            results.append({
                "url": url,
                "is_cacheable": is_cacheable,
                "cache_key": cache_key[:16] + "...",  # Show first 16 chars
                "reason": "Priority domain" if any(domain in url for domain in browser_cache_service.priority_domains) else "File extension match"
            })
        
        return {
            "test_results": results,
            "cache_enabled": browser_cache_service.enabled,
            "total_cacheable": sum(1 for r in results if r["is_cacheable"]),
            "cache_stats": browser_cache_service.get_cache_stats()
        }
    except Exception as e:
        logger.error(f"Failed to test cache: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to test cache: {str(e)}")


@router.get(
    "/browser-cache/performance",
    summary="Get cache performance metrics",
    description="Get detailed performance metrics for browser cache"
)
async def get_cache_performance() -> Dict[str, Any]:
    """Get cache performance metrics."""
    try:
        stats = browser_cache_service.get_cache_stats()
        
        # Calculate performance metrics
        total_requests = stats["hits"] + stats["misses"]
        hit_rate = stats["hit_rate"]
        
        # Estimate performance benefits
        avg_resource_size_kb = 50  # Estimated average resource size
        avg_network_latency_ms = 200  # Estimated average network latency
        
        estimated_bandwidth_saved_mb = (stats["hits"] * avg_resource_size_kb) / 1024
        estimated_time_saved_seconds = (stats["hits"] * avg_network_latency_ms) / 1000
        
        performance_grade = "A" if hit_rate > 0.8 else "B" if hit_rate > 0.6 else "C" if hit_rate > 0.4 else "D"
        
        return {
            "performance_metrics": {
                "hit_rate": hit_rate,
                "total_requests": total_requests,
                "cache_hits": stats["hits"],
                "cache_misses": stats["misses"],
                "performance_grade": performance_grade
            },
            "estimated_benefits": {
                "bandwidth_saved_mb": round(estimated_bandwidth_saved_mb, 2),
                "time_saved_seconds": round(estimated_time_saved_seconds, 2),
                "requests_served_from_cache": stats["hits"]
            },
            "cache_efficiency": {
                "cache_size_mb": stats["cache_size_mb"],
                "max_cache_size_mb": stats["max_cache_size_mb"],
                "utilization_percent": round((stats["cache_size_mb"] / stats["max_cache_size_mb"]) * 100, 2),
                "cached_items": stats["cached_items"]
            },
            "recommendations": [
                "Excellent cache performance!" if hit_rate > 0.8 else
                "Good cache performance" if hit_rate > 0.6 else
                "Consider increasing cache TTL" if hit_rate > 0.4 else
                "Cache may need optimization",
                
                "Cache size is optimal" if stats["cache_size_mb"] < stats["max_cache_size_mb"] * 0.8 else
                "Consider increasing max cache size",
                
                "Regular cleanup is working well" if stats["cleanup_runs"] > 0 else
                "Enable automatic cache cleanup"
            ]
        }
    except Exception as e:
        logger.error(f"Failed to get cache performance: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to get cache performance: {str(e)}")
