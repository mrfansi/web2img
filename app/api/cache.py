from typing import Dict, Any

from fastapi import APIRouter, status, Query

from app.services.cache import cache_service

# Create a router for cache management endpoints
router = APIRouter(tags=["cache"])


@router.get(
    "/cache/stats",
    response_model=Dict[str, Any],
    status_code=status.HTTP_200_OK,
    summary="Get cache statistics",
    description="""
    Get statistics about the cache, including hit rate, size, and configuration.
    
    ## Statistics
    - enabled: Whether the cache is enabled
    - size: Current number of items in the cache
    - max_size: Maximum number of items allowed in the cache
    - ttl: Time-to-live for cache items in seconds
    - hits: Number of cache hits
    - misses: Number of cache misses
    - hit_rate: Ratio of hits to total requests
    """,
    responses={
        200: {
            "description": "Cache statistics",
            "content": {
                "application/json": {
                    "example": {
                        "enabled": True,
                        "size": 42,
                        "max_size": 100,
                        "ttl": 3600,
                        "hits": 156,
                        "misses": 89,
                        "hit_rate": 0.637,
                        "cleanup_interval": 300
                    }
                }
            }
        }
    },
)
async def get_cache_stats() -> Dict[str, Any]:
    """Get cache statistics.
    
    Returns:
        Dictionary with cache statistics
    """
    return cache_service.get_stats()


@router.delete(
    "/cache",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Clear the entire cache",
    description="Clear all items from the cache.",
    responses={
        204: {"description": "Cache cleared successfully"}
    },
)
async def clear_cache() -> None:
    """Clear the entire cache.
    
    Returns:
        None
    """
    await cache_service.invalidate()
    return None


@router.delete(
    "/cache/url",
    status_code=status.HTTP_200_OK,
    summary="Invalidate cache entries for a URL",
    description="Invalidate all cache entries for a specific URL.",
    responses={
        200: {
            "description": "Cache entries invalidated",
            "content": {
                "application/json": {
                    "example": {
                        "invalidated": 3
                    }
                }
            }
        }
    },
)
async def invalidate_url(url: str = Query(..., description="URL to invalidate in the cache")) -> Dict[str, int]:
    """Invalidate cache entries for a URL.
    
    Args:
        url: URL to invalidate
        
    Returns:
        Dictionary with number of invalidated entries
    """
    count = await cache_service.invalidate(url)
    return {"invalidated": count}
