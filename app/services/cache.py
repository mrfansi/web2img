import time
import os
from typing import Dict, Any, Optional, Tuple, List
from datetime import datetime, timedelta
import asyncio
import hashlib
import json

from app.core.config import settings


class CacheItem:
    """A single item in the cache."""
    
    def __init__(self, key: str, value: Any, ttl: int = 3600):
        self.key = key
        self.value = value
        self.created_at = time.time()
        self.expires_at = self.created_at + ttl
        self.last_accessed = self.created_at
        self.access_count = 0
    
    @property
    def is_expired(self) -> bool:
        """Check if the cache item is expired."""
        return time.time() > self.expires_at
    
    def access(self) -> None:
        """Update access statistics."""
        self.last_accessed = time.time()
        self.access_count += 1


class CacheService:
    """Service for caching screenshot results."""
    
    def __init__(self):
        self._cache: Dict[str, CacheItem] = {}
        self._lock = asyncio.Lock()
        self._last_cleanup = time.time()
        self._cleanup_interval = 300  # 5 minutes
        self._hits = 0
        self._misses = 0
        self._max_items = getattr(settings, 'cache_max_items', 100)
        self._ttl = getattr(settings, 'cache_ttl_seconds', 3600)  # 1 hour default
        self._enabled = getattr(settings, 'cache_enabled', True)
    
    def _generate_key(self, url: str, width: int, height: int, format: str) -> str:
        """Generate a cache key from screenshot parameters.
        
        Args:
            url: The URL to capture
            width: The viewport width
            height: The viewport height
            format: The image format
            
        Returns:
            A unique cache key
        """
        # Create a dictionary of parameters to hash
        params = {
            'url': url,
            'width': width,
            'height': height,
            'format': format
        }
        
        # Convert to a stable JSON string and hash
        param_str = json.dumps(params, sort_keys=True)
        return hashlib.sha256(param_str.encode()).hexdigest()
    
    async def get(self, url: str, width: int, height: int, format: str) -> Optional[str]:
        """Get a cached screenshot URL if available.
        
        Args:
            url: The URL to capture
            width: The viewport width
            height: The viewport height
            format: The image format
            
        Returns:
            The cached imgproxy URL or None if not cached
        """
        if not self._enabled:
            self._misses += 1
            return None
        
        # Periodically clean up expired items
        await self._maybe_cleanup()
        
        # Generate the cache key
        key = self._generate_key(url, width, height, format)
        
        # Check if the key exists in the cache
        async with self._lock:
            if key in self._cache:
                item = self._cache[key]
                
                # Check if the item is expired
                if item.is_expired:
                    # Remove expired item
                    del self._cache[key]
                    self._misses += 1
                    return None
                
                # Update access statistics
                item.access()
                self._hits += 1
                
                # Return the cached value
                return item.value
            
            # Cache miss
            self._misses += 1
            return None
    
    async def set(self, url: str, width: int, height: int, format: str, imgproxy_url: str) -> None:
        """Cache a screenshot result.
        
        Args:
            url: The URL that was captured
            width: The viewport width
            height: The viewport height
            format: The image format
            imgproxy_url: The imgproxy URL to cache
        """
        if not self._enabled:
            return
        
        # Generate the cache key
        key = self._generate_key(url, width, height, format)
        
        # Add the item to the cache
        async with self._lock:
            # Check if we need to evict items
            if len(self._cache) >= self._max_items:
                await self._evict_items()
            
            # Add the new item
            self._cache[key] = CacheItem(key, imgproxy_url, self._ttl)
    
    async def invalidate(self, url: Optional[str] = None) -> int:
        """Invalidate cache entries.
        
        Args:
            url: Optional URL to invalidate. If None, invalidate all entries.
            
        Returns:
            Number of invalidated entries
        """
        count = 0
        
        async with self._lock:
            if url is None:
                # Invalidate all entries
                count = len(self._cache)
                self._cache.clear()
            else:
                # Invalidate entries for a specific URL
                keys_to_remove = []
                
                # Find all keys that match the URL
                for key, item in self._cache.items():
                    # We need to check if the URL is in the key
                    # This is a bit of a hack, but it works for now
                    if url in json.dumps(item.key):
                        keys_to_remove.append(key)
                
                # Remove the keys
                for key in keys_to_remove:
                    del self._cache[key]
                    count += 1
        
        return count
    
    async def _maybe_cleanup(self) -> None:
        """Perform cleanup if needed."""
        current_time = time.time()
        
        # Check if it's time to clean up
        if current_time - self._last_cleanup > self._cleanup_interval:
            await self._cleanup()
            self._last_cleanup = current_time
    
    async def _cleanup(self) -> None:
        """Clean up expired cache items."""
        async with self._lock:
            # Find expired keys
            expired_keys = [key for key, item in self._cache.items() if item.is_expired]
            
            # Remove expired items
            for key in expired_keys:
                del self._cache[key]
    
    async def _evict_items(self) -> None:
        """Evict items from the cache when it's full."""
        # Sort items by last accessed time (oldest first)
        items = sorted(
            self._cache.items(),
            key=lambda x: x[1].last_accessed
        )
        
        # Remove the oldest 10% of items
        items_to_remove = max(1, int(len(items) * 0.1))
        
        for i in range(items_to_remove):
            if i < len(items):
                del self._cache[items[i][0]]
    
    def get_stats(self) -> Dict[str, Any]:
        """Get cache statistics.
        
        Returns:
            Dictionary with cache statistics
        """
        total_requests = self._hits + self._misses
        hit_rate = self._hits / total_requests if total_requests > 0 else 0
        
        return {
            "enabled": self._enabled,
            "size": len(self._cache),
            "max_size": self._max_items,
            "ttl": self._ttl,
            "hits": self._hits,
            "misses": self._misses,
            "hit_rate": hit_rate,
            "cleanup_interval": self._cleanup_interval
        }
    
    async def cleanup(self) -> None:
        """Clean up resources."""
        async with self._lock:
            self._cache.clear()


# Create a singleton instance
cache_service = CacheService()
