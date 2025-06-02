"""
Browser Cache Service
Implements intelligent caching for CSS, JS, and media files to prevent timeouts
"""

import os
import time
import hashlib
import asyncio
import aiofiles
from typing import Dict, Optional, Set, Any, Tuple
from urllib.parse import urlparse
from playwright.async_api import Page, Route, Request, Response
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("browser_cache")


class BrowserCacheService:
    """Service for caching browser resources to improve page load performance."""
    
    def __init__(self):
        self.cache_dir = os.path.join(settings.screenshot_dir, "browser_cache")
        self.cache_index: Dict[str, Dict[str, Any]] = {}
        self.cache_stats = {
            "hits": 0,
            "misses": 0,
            "stores": 0,
            "errors": 0,
            "total_size": 0,
            "cleanup_runs": 0
        }
        self.max_cache_size = getattr(settings, 'browser_cache_max_size_mb', 500) * 1024 * 1024  # 500MB default
        self.max_file_size = getattr(settings, 'browser_cache_max_file_size_mb', 10) * 1024 * 1024  # 10MB default
        self.cache_ttl = getattr(settings, 'browser_cache_ttl_hours', 24) * 3600  # 24 hours default
        self.enabled = getattr(settings, 'browser_cache_enabled', True)
        
        # Resource type patterns for caching
        self.cacheable_patterns = {
            'css': ['.css'],
            'js': ['.js', '.mjs'],
            'fonts': ['.woff', '.woff2', '.ttf', '.otf', '.eot'],
            'images': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico'],
            'media': ['.mp4', '.webm', '.ogg', '.mp3', '.wav']
        }
        
        # Domains to always cache (CDNs, common libraries)
        self.priority_domains = {
            'cdnjs.cloudflare.com',
            'cdn.jsdelivr.net',
            'unpkg.com',
            'fonts.googleapis.com',
            'fonts.gstatic.com',
            'ajax.googleapis.com',
            'code.jquery.com',
            'stackpath.bootstrapcdn.com',
            'maxcdn.bootstrapcdn.com',
            'use.fontawesome.com'
        }
        
        self._initialize_cache_dir()
    
    def _initialize_cache_dir(self):
        """Initialize the cache directory."""
        try:
            os.makedirs(self.cache_dir, exist_ok=True)
            logger.info(f"Browser cache initialized at {self.cache_dir}")
        except Exception as e:
            logger.error(f"Failed to initialize cache directory: {str(e)}")
            self.enabled = False
    
    def _get_cache_key(self, url: str) -> str:
        """Generate a cache key for a URL."""
        return hashlib.sha256(url.encode()).hexdigest()
    
    def _get_cache_path(self, cache_key: str) -> str:
        """Get the file path for a cache key."""
        return os.path.join(self.cache_dir, f"{cache_key}.cache")
    
    def _is_cacheable_resource(self, url: str, resource_type: str = None) -> bool:
        """Check if a resource should be cached."""
        if not self.enabled:
            return False
        
        try:
            parsed = urlparse(url)
            
            # Check if it's a priority domain
            if parsed.netloc.lower() in self.priority_domains:
                return True
            
            # Check file extension
            path_lower = parsed.path.lower()
            for category, extensions in self.cacheable_patterns.items():
                if any(path_lower.endswith(ext) for ext in extensions):
                    return True
            
            # Check resource type if provided
            if resource_type:
                cacheable_types = ['stylesheet', 'script', 'font', 'image']
                return resource_type in cacheable_types
            
            return False
        except Exception:
            return False
    
    async def _store_in_cache(self, url: str, content: bytes, headers: Dict[str, str]) -> bool:
        """Store content in cache."""
        if not self.enabled or len(content) > self.max_file_size:
            return False
        
        try:
            cache_key = self._get_cache_key(url)
            cache_path = self._get_cache_path(cache_key)
            
            # Store content
            async with aiofiles.open(cache_path, 'wb') as f:
                await f.write(content)
            
            # Store metadata
            metadata = {
                'url': url,
                'headers': headers,
                'size': len(content),
                'stored_at': time.time(),
                'access_count': 0,
                'last_accessed': time.time()
            }
            
            self.cache_index[cache_key] = metadata
            self.cache_stats['stores'] += 1
            self.cache_stats['total_size'] += len(content)
            
            logger.debug(f"Cached resource: {url} ({len(content)} bytes)")
            return True
            
        except Exception as e:
            logger.error(f"Failed to store in cache: {url} - {str(e)}")
            self.cache_stats['errors'] += 1
            return False
    
    async def _get_from_cache(self, url: str) -> Optional[Tuple[bytes, Dict[str, str]]]:
        """Get content from cache."""
        if not self.enabled:
            return None
        
        try:
            cache_key = self._get_cache_key(url)
            
            if cache_key not in self.cache_index:
                self.cache_stats['misses'] += 1
                return None
            
            metadata = self.cache_index[cache_key]
            
            # Check if cache entry is expired
            if time.time() - metadata['stored_at'] > self.cache_ttl:
                await self._remove_from_cache(cache_key)
                self.cache_stats['misses'] += 1
                return None
            
            cache_path = self._get_cache_path(cache_key)
            
            if not os.path.exists(cache_path):
                # Cache file missing, remove from index
                del self.cache_index[cache_key]
                self.cache_stats['misses'] += 1
                return None
            
            # Read content
            async with aiofiles.open(cache_path, 'rb') as f:
                content = await f.read()
            
            # Update access statistics
            metadata['access_count'] += 1
            metadata['last_accessed'] = time.time()
            
            self.cache_stats['hits'] += 1
            logger.debug(f"Cache hit: {url}")
            
            return content, metadata['headers']
            
        except Exception as e:
            logger.error(f"Failed to get from cache: {url} - {str(e)}")
            self.cache_stats['errors'] += 1
            return None
    
    async def _remove_from_cache(self, cache_key: str) -> bool:
        """Remove an item from cache."""
        try:
            if cache_key in self.cache_index:
                metadata = self.cache_index[cache_key]
                cache_path = self._get_cache_path(cache_key)
                
                # Remove file
                if os.path.exists(cache_path):
                    os.remove(cache_path)
                
                # Update stats
                self.cache_stats['total_size'] -= metadata.get('size', 0)
                
                # Remove from index
                del self.cache_index[cache_key]
                
                return True
        except Exception as e:
            logger.error(f"Failed to remove from cache: {cache_key} - {str(e)}")
        
        return False
    
    async def setup_page_caching(self, page: Page) -> None:
        """Set up caching for a page."""
        if not self.enabled:
            return
        
        async def handle_route(route: Route) -> None:
            """Handle route with caching logic."""
            request = route.request
            url = request.url
            
            try:
                # Check if resource is cacheable
                if not self._is_cacheable_resource(url, request.resource_type):
                    await route.continue_()
                    return
                
                # Try to get from cache first
                cached_result = await self._get_from_cache(url)
                if cached_result:
                    content, headers = cached_result
                    
                    # Serve from cache
                    await route.fulfill(
                        status=200,
                        headers=headers,
                        body=content
                    )
                    return
                
                # Not in cache, fetch and store
                try:
                    response = await route.fetch()
                    
                    if response.status == 200:
                        content = await response.body()
                        headers = response.headers
                        
                        # Store in cache asynchronously
                        asyncio.create_task(self._store_in_cache(url, content, headers))
                        
                        # Fulfill the request
                        await route.fulfill(
                            status=response.status,
                            headers=headers,
                            body=content
                        )
                    else:
                        await route.fulfill(response=response)
                        
                except Exception as fetch_error:
                    logger.warning(f"Failed to fetch resource for caching: {url} - {str(fetch_error)}")
                    await route.continue_()
                    
            except Exception as e:
                logger.error(f"Error in cache route handler: {url} - {str(e)}")
                await route.continue_()
        
        # Set up route handler for cacheable resources
        await page.route("**/*", handle_route)
        
        logger.debug("Page caching setup completed")
    
    async def cleanup_cache(self) -> Dict[str, int]:
        """Clean up expired and oversized cache."""
        if not self.enabled:
            return {"removed": 0, "errors": 0}
        
        removed_count = 0
        error_count = 0
        current_time = time.time()
        
        try:
            # Remove expired entries
            expired_keys = []
            for cache_key, metadata in self.cache_index.items():
                if current_time - metadata['stored_at'] > self.cache_ttl:
                    expired_keys.append(cache_key)
            
            for cache_key in expired_keys:
                if await self._remove_from_cache(cache_key):
                    removed_count += 1
                else:
                    error_count += 1
            
            # If cache is still too large, remove least recently used items
            if self.cache_stats['total_size'] > self.max_cache_size:
                # Sort by last accessed time (oldest first)
                sorted_items = sorted(
                    self.cache_index.items(),
                    key=lambda x: x[1]['last_accessed']
                )
                
                for cache_key, metadata in sorted_items:
                    if self.cache_stats['total_size'] <= self.max_cache_size * 0.8:  # Clean to 80%
                        break
                    
                    if await self._remove_from_cache(cache_key):
                        removed_count += 1
                    else:
                        error_count += 1
            
            self.cache_stats['cleanup_runs'] += 1
            
            logger.info(f"Cache cleanup completed: removed {removed_count} items, {error_count} errors")
            
        except Exception as e:
            logger.error(f"Error during cache cleanup: {str(e)}")
            error_count += 1
        
        return {"removed": removed_count, "errors": error_count}
    
    def get_cache_stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        hit_rate = 0
        if self.cache_stats['hits'] + self.cache_stats['misses'] > 0:
            hit_rate = self.cache_stats['hits'] / (self.cache_stats['hits'] + self.cache_stats['misses'])
        
        return {
            **self.cache_stats,
            "hit_rate": hit_rate,
            "cache_size_mb": self.cache_stats['total_size'] / (1024 * 1024),
            "max_cache_size_mb": self.max_cache_size / (1024 * 1024),
            "cached_items": len(self.cache_index),
            "enabled": self.enabled,
            "cache_dir": self.cache_dir
        }
    
    async def clear_cache(self) -> Dict[str, int]:
        """Clear all cache."""
        if not self.enabled:
            return {"removed": 0, "errors": 0}
        
        removed_count = 0
        error_count = 0
        
        try:
            # Remove all cached files
            cache_keys = list(self.cache_index.keys())
            for cache_key in cache_keys:
                if await self._remove_from_cache(cache_key):
                    removed_count += 1
                else:
                    error_count += 1
            
            # Reset stats
            self.cache_stats = {
                "hits": 0,
                "misses": 0,
                "stores": 0,
                "errors": 0,
                "total_size": 0,
                "cleanup_runs": 0
            }
            
            logger.info(f"Cache cleared: removed {removed_count} items")
            
        except Exception as e:
            logger.error(f"Error clearing cache: {str(e)}")
            error_count += 1
        
        return {"removed": removed_count, "errors": error_count}


# Global instance
browser_cache_service = BrowserCacheService()
