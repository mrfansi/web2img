import asyncio
import time
from typing import Dict, List, Optional, Tuple, Any

from playwright.async_api import async_playwright, Browser, BrowserContext, Page
from app.core.config import settings


class BrowserPool:
    """A pool of browser instances for efficient reuse."""

    def __init__(
        self,
        min_size: int = 2,
        max_size: int = 10,
        idle_timeout: int = 300,
        max_age: int = 3600,
        cleanup_interval: int = 60
    ):
        """Initialize the browser pool.
        
        Args:
            min_size: Minimum number of browser instances to keep in the pool
            max_size: Maximum number of browser instances allowed in the pool
            idle_timeout: Time in seconds after which an idle browser is closed
            max_age: Maximum age in seconds for a browser instance before forced recycling
            cleanup_interval: Interval in seconds for running cleanup tasks
        """
        self._browsers: List[Dict[str, Any]] = []  # List of browser instances with metadata
        self._available_browsers: List[int] = []  # Indices of available browsers
        self._lock = asyncio.Lock()
        self._min_size = min_size
        self._max_size = max_size
        self._idle_timeout = idle_timeout
        self._max_age = max_age
        self._cleanup_interval = cleanup_interval
        self._last_cleanup = time.time()
        self._stats = {
            "created": 0,
            "reused": 0,
            "errors": 0,
            "recycled": 0,
            "peak_usage": 0,
            "current_usage": 0,
            "current_size": 0
        }
        self._cleanup_task = None
        
    async def initialize(self):
        """Initialize the pool with minimum number of browsers."""
        async with self._lock:
            # Create initial browser instances
            for _ in range(self._min_size):
                browser_data = await self._create_browser_instance()
                if browser_data:
                    self._browsers.append(browser_data)
                    self._available_browsers.append(len(self._browsers) - 1)
            
            # Start cleanup task
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())
            
            # Update stats
            self._stats["current_size"] = len(self._browsers)
    
    async def _cleanup_loop(self):
        """Background task for cleaning up idle browsers."""
        try:
            while True:
                await asyncio.sleep(self._cleanup_interval)
                await self.cleanup()
        except asyncio.CancelledError:
            # Task was cancelled, clean up resources
            pass
        except Exception as e:
            # Log error but don't crash
            print(f"Error in browser pool cleanup loop: {str(e)}")
    
    async def _create_browser_instance(self) -> Optional[Dict[str, Any]]:
        """Create a new browser instance with metadata."""
        try:
            # Start playwright
            playwright = await async_playwright().start()
            
            # Launch browser with optimized settings
            browser = await playwright.chromium.launch(
                args=[
                    '--disable-gpu',  # Disable GPU hardware acceleration
                    '--disable-dev-shm-usage',  # Overcome limited resource problems
                    '--disable-setuid-sandbox',  # Disable setuid sandbox (performance)
                    '--no-sandbox',  # Disable sandbox for better performance
                    '--no-zygote',  # Disable zygote process
                    '--disable-extensions',  # Disable extensions for performance
                    '--disable-features=site-per-process',  # Disable site isolation
                    '--disable-notifications',  # Disable notifications
                    '--disable-popup-blocking',  # Disable popup blocking
                    '--disable-sync',  # Disable sync
                    '--disable-translate',  # Disable translate
                    '--disable-web-security',  # Disable web security for complex sites
                    '--disable-background-networking',  # Reduce background activity
                    '--disable-default-apps',  # Disable default apps
                    '--disable-prompt-on-repost',  # Disable prompt on repost
                    '--disable-domain-reliability',  # Disable domain reliability
                    '--metrics-recording-only',  # Metrics recording only
                    '--mute-audio',  # Mute audio
                    '--no-first-run',  # No first run dialog
                ],
                headless=True,
                timeout=60000  # 60 seconds timeout
            )
            
            # Create browser data with metadata
            browser_data = {
                "browser": browser,
                "playwright": playwright,
                "created_at": time.time(),
                "last_used": time.time(),
                "contexts": [],  # List of active contexts
                "usage_count": 0
            }
            
            # Update stats
            self._stats["created"] += 1
            
            return browser_data
        except Exception as e:
            # Update stats
            self._stats["errors"] += 1
            print(f"Error creating browser instance: {str(e)}")
            return None
    
    async def get_browser(self) -> Tuple[Optional[Browser], Optional[int]]:
        """Get a browser instance from the pool or create a new one.
        
        Returns:
            Tuple of (browser, browser_index) or (None, None) if failed
        """
        async with self._lock:
            # Check if we have an available browser
            if self._available_browsers:
                # Get an available browser
                browser_index = self._available_browsers.pop(0)
                browser_data = self._browsers[browser_index]
                
                # Update metadata
                browser_data["last_used"] = time.time()
                browser_data["usage_count"] += 1
                
                # Update stats
                self._stats["reused"] += 1
                self._stats["current_usage"] = len(self._browsers) - len(self._available_browsers)
                self._stats["peak_usage"] = max(self._stats["peak_usage"], self._stats["current_usage"])
                
                return browser_data["browser"], browser_index
            
            # If we don't have an available browser and haven't reached max size, create a new one
            if len(self._browsers) < self._max_size:
                browser_data = await self._create_browser_instance()
                if browser_data:
                    self._browsers.append(browser_data)
                    browser_index = len(self._browsers) - 1
                    
                    # Update stats
                    self._stats["current_size"] = len(self._browsers)
                    self._stats["current_usage"] = len(self._browsers) - len(self._available_browsers)
                    self._stats["peak_usage"] = max(self._stats["peak_usage"], self._stats["current_usage"])
                    
                    return browser_data["browser"], browser_index
            
            # If we've reached max size, wait for a browser to become available
            # Log the issue and update error stats
            self._stats["errors"] += 1
            
            # Wait a short time and try again - maybe a browser will be released
            # This is better than immediately failing
            for retry in range(3):
                # Update stats to indicate we're waiting
                print(f"Browser pool exhausted, waiting for an available browser (attempt {retry+1}/3)")
                
                # Release the lock while waiting to allow other operations
                self._lock.release()
                
                # Wait a bit
                await asyncio.sleep(1)
                
                # Re-acquire the lock
                await self._lock.acquire()
                
                # Check if a browser became available while we were waiting
                if self._available_browsers:
                    browser_index = self._available_browsers.pop(0)
                    browser_data = self._browsers[browser_index]
                    
                    # Update metadata
                    browser_data["last_used"] = time.time()
                    browser_data["usage_count"] += 1
                    
                    # Update stats
                    self._stats["reused"] += 1
                    self._stats["current_usage"] = len(self._browsers) - len(self._available_browsers)
                    self._stats["peak_usage"] = max(self._stats["peak_usage"], self._stats["current_usage"])
                    
                    return browser_data["browser"], browser_index
            
            # If we still don't have an available browser, return None
            return None, None
    
    async def release_browser(self, browser_index: int, is_healthy: bool = True):
        """Return a browser to the pool or recycle it.
        
        Args:
            browser_index: Index of the browser in the pool
            is_healthy: Whether the browser is healthy and can be reused
        """
        async with self._lock:
            # Check if the browser index is valid
            if browser_index < 0 or browser_index >= len(self._browsers):
                return
            
            browser_data = self._browsers[browser_index]
            
            # Check if browser needs to be recycled
            current_time = time.time()
            age = current_time - browser_data["created_at"]
            
            if not is_healthy or age > self._max_age:
                # Recycle the browser
                await self._recycle_browser(browser_index)
            else:
                # Update last used time
                browser_data["last_used"] = current_time
                
                # Return to available pool if not already there
                if browser_index not in self._available_browsers:
                    self._available_browsers.append(browser_index)
                    
                    # Update stats
                    self._stats["current_usage"] = len(self._browsers) - len(self._available_browsers)
    
    async def _recycle_browser(self, browser_index: int):
        """Recycle a browser instance by closing it and creating a new one.
        
        Args:
            browser_index: Index of the browser to recycle
        """
        # Get the browser data
        browser_data = self._browsers[browser_index]
        
        # Close all contexts
        for context in browser_data["contexts"]:
            try:
                await context.close()
            except Exception:
                pass  # Ignore errors during cleanup
        
        # Close the browser
        try:
            await browser_data["browser"].close()
        except Exception:
            pass  # Ignore errors during cleanup
        
        # Stop playwright
        try:
            await browser_data["playwright"].stop()
        except Exception:
            pass  # Ignore errors during cleanup
        
        # Create a new browser instance
        new_browser_data = await self._create_browser_instance()
        if new_browser_data:
            # Replace the old browser data
            self._browsers[browser_index] = new_browser_data
            
            # Add to available browsers if not already there
            if browser_index not in self._available_browsers:
                self._available_browsers.append(browser_index)
                
                # Update stats
                self._stats["current_usage"] = len(self._browsers) - len(self._available_browsers)
        else:
            # If we couldn't create a new browser, remove this slot
            self._browsers.pop(browser_index)
            
            # Update indices in available_browsers
            for i, idx in enumerate(self._available_browsers):
                if idx > browser_index:
                    self._available_browsers[i] = idx - 1
                elif idx == browser_index:
                    self._available_browsers.pop(i)
            
            # Update stats
            self._stats["current_size"] = len(self._browsers)
            self._stats["current_usage"] = len(self._browsers) - len(self._available_browsers)
        
        # Update stats
        self._stats["recycled"] += 1
    
    async def create_context(self, browser_index: int, **kwargs) -> Optional[BrowserContext]:
        """Create a new browser context for the specified browser.
        
        Args:
            browser_index: Index of the browser in the pool
            **kwargs: Additional arguments to pass to browser.new_context()
            
        Returns:
            A new browser context or None if failed
        """
        async with self._lock:
            # Check if the browser index is valid
            if browser_index < 0 or browser_index >= len(self._browsers):
                return None
            
            browser_data = self._browsers[browser_index]
            
            try:
                # Create a new context
                context = await browser_data["browser"].new_context(**kwargs)
                
                # Add to contexts list
                browser_data["contexts"].append(context)
                
                return context
            except Exception as e:
                # Update stats
                self._stats["errors"] += 1
                print(f"Error creating browser context: {str(e)}")
                return None
    
    async def release_context(self, browser_index: int, context: BrowserContext):
        """Release a browser context.
        
        Args:
            browser_index: Index of the browser in the pool
            context: The browser context to release
        """
        async with self._lock:
            # Check if the browser index is valid
            if browser_index < 0 or browser_index >= len(self._browsers):
                return
            
            browser_data = self._browsers[browser_index]
            
            # Close all pages
            try:
                pages = context.pages
                for page in pages:
                    if not page.is_closed():
                        await page.close()
            except Exception:
                pass  # Ignore errors during cleanup
            
            # Close the context
            try:
                await context.close()
            except Exception:
                pass  # Ignore errors during cleanup
            
            # Remove from contexts list
            if context in browser_data["contexts"]:
                browser_data["contexts"].remove(context)
    
    async def cleanup(self):
        """Clean up idle browsers."""
        async with self._lock:
            current_time = time.time()
            
            # Check each browser
            i = 0
            while i < len(self._browsers):
                browser_data = self._browsers[i]
                
                # Check if browser is idle and not in use
                idle_time = current_time - browser_data["last_used"]
                is_available = i in self._available_browsers
                
                if is_available and idle_time > self._idle_timeout and len(self._browsers) > self._min_size:
                    # Close the browser
                    try:
                        # Close all contexts
                        for context in browser_data["contexts"]:
                            try:
                                await context.close()
                            except Exception:
                                pass  # Ignore errors during cleanup
                        
                        # Close the browser
                        await browser_data["browser"].close()
                        
                        # Stop playwright
                        await browser_data["playwright"].stop()
                    except Exception:
                        pass  # Ignore errors during cleanup
                    
                    # Remove from browsers list
                    self._browsers.pop(i)
                    
                    # Remove from available browsers
                    self._available_browsers.remove(i)
                    
                    # Update indices in available_browsers
                    for j, idx in enumerate(self._available_browsers):
                        if idx > i:
                            self._available_browsers[j] = idx - 1
                    
                    # Update stats
                    self._stats["current_size"] = len(self._browsers)
                    self._stats["recycled"] += 1
                else:
                    i += 1
            
            # Create browsers if below min_size
            while len(self._browsers) < self._min_size:
                browser_data = await self._create_browser_instance()
                if browser_data:
                    self._browsers.append(browser_data)
                    self._available_browsers.append(len(self._browsers) - 1)
                    
                    # Update stats
                    self._stats["current_size"] = len(self._browsers)
                else:
                    # If we couldn't create a browser, break to avoid infinite loop
                    break
    
    async def shutdown(self):
        """Shutdown all browsers in the pool."""
        # Cancel cleanup task
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass  # Expected when cancelling
        
        async with self._lock:
            # Close all browsers
            for browser_data in self._browsers:
                try:
                    # Close all contexts
                    for context in browser_data["contexts"]:
                        try:
                            await context.close()
                        except Exception:
                            pass  # Ignore errors during cleanup
                    
                    # Close the browser
                    await browser_data["browser"].close()
                    
                    # Stop playwright
                    await browser_data["playwright"].stop()
                except Exception:
                    pass  # Ignore errors during cleanup
            
            # Clear lists
            self._browsers = []
            self._available_browsers = []
            
            # Update stats
            self._stats["current_size"] = 0
            self._stats["current_usage"] = 0
    
    def get_stats(self) -> Dict[str, Any]:
        """Get pool statistics.
        
        Returns:
            Dictionary with pool statistics
        """
        return {
            "size": len(self._browsers),
            "available": len(self._available_browsers),
            "in_use": len(self._browsers) - len(self._available_browsers),
            "min_size": self._min_size,
            "max_size": self._max_size,
            "created": self._stats["created"],
            "reused": self._stats["reused"],
            "errors": self._stats["errors"],
            "recycled": self._stats["recycled"],
            "peak_usage": self._stats["peak_usage"]
        }
