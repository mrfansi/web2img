import asyncio
import time
from typing import Dict, List, Optional, Tuple, Any, AsyncGenerator

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
        from app.core.logging import get_logger
        logger = get_logger("browser_pool")
        
        logger.info(f"Initializing browser pool with {self._min_size} browsers (max: {self._max_size})")
        
        # Track initialization success rate
        success_count = 0
        
        async with self._lock:
            # Create initial browser instances in parallel for faster startup
            # This helps ensure we're ready for concurrent requests right away
            tasks = []
            for _ in range(self._min_size):
                tasks.append(self._create_browser_instance())
            
            # Wait for all browsers to be created
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Process results
            for result in results:
                if isinstance(result, Exception):
                    logger.warning(f"Failed to create browser during initialization: {str(result)}")
                    continue
                    
                if result:  # result is browser_data
                    self._browsers.append(result)
                    self._available_browsers.append(len(self._browsers) - 1)
                    success_count += 1
            
            # Start cleanup task
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())
            
            # Update stats
            self._stats["current_size"] = len(self._browsers)
            
            # Log initialization results
            logger.info(f"Browser pool initialized with {success_count}/{self._min_size} browsers", {
                "success_rate": f"{success_count}/{self._min_size}",
                "success_percentage": round(success_count / self._min_size * 100) if self._min_size > 0 else 0
            })
    
    async def _cleanup_loop(self):
        """Background task for cleaning up idle browsers."""
        try:
            while True:
                await asyncio.sleep(self._cleanup_interval)
                await self.cleanup()
        except asyncio.CancelledError:
            # Task was cancelled, this is expected during shutdown
            # No need to log this as it's a normal part of the shutdown process
            pass
        except (asyncio.TimeoutError, ConnectionError) as e:
            # Log specific network/timeout errors with context
            from app.core.logging import get_logger
            logger = get_logger("browser_pool")
            logger.error(f"Timeout or connection error in browser pool cleanup loop: {str(e)}", {
                "error": str(e),
                "error_type": type(e).__name__,
                "cleanup_interval": self._cleanup_interval
            })
        except Exception as e:
            # Log unexpected errors with full context
            from app.core.logging import get_logger
            logger = get_logger("browser_pool")
            logger.exception(f"Unexpected error in browser pool cleanup loop: {str(e)}", {
                "error": str(e),
                "error_type": type(e).__name__,
                "cleanup_interval": self._cleanup_interval,
                "browser_count": len(self._browsers),
                "available_browsers": len(self._available_browsers)
            })
    
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
            
        Note:
            It's recommended to use the browser_context() context manager instead
            of calling get_browser() and release_browser() directly.
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
            
            # If we've reached max size, implement a more sophisticated waiting strategy
            # Log the issue and update error stats
            self._stats["errors"] += 1
            
            # Import logger here to avoid circular imports
            from app.core.logging import get_logger
            logger = get_logger("browser_pool")
            logger.warning(f"Browser pool at capacity ({self._max_size}/{self._max_size}), waiting for an available browser", {
                "pool_size": len(self._browsers),
                "max_size": self._max_size,
                "available": len(self._available_browsers),
                "in_use": len(self._browsers) - len(self._available_browsers)
            })
        
            # Use exponential backoff for waiting to reduce contention
            max_wait_attempts = 5  # Increase from 3 to 5 for more patience under load
            base_wait_time = 0.2  # Start with a short wait
            
            for retry in range(max_wait_attempts):
                # Calculate wait time with exponential backoff
                wait_time = min(5.0, base_wait_time * (2 ** retry))
                
                # Add jitter to prevent thundering herd problem
                jitter = wait_time * 0.1  # 10% jitter
                wait_time = wait_time + (random.random() * 2 - 1) * jitter
                
                # Release the lock while waiting to allow other operations
                self._lock.release()
                
                # Wait with backoff
                logger.debug(f"Waiting {wait_time:.2f}s for an available browser (attempt {retry+1}/{max_wait_attempts})")
                await asyncio.sleep(wait_time)
                
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
                    
                    logger.info(f"Successfully acquired browser after waiting (attempt {retry+1})")
                    return browser_data["browser"], browser_index
        
            # If we still don't have an available browser, raise a detailed error
            from app.core.errors import BrowserPoolExhaustedError
            context = {
                "pool_size": len(self._browsers),
                "max_size": self._max_size,
                "available": len(self._available_browsers),
                "in_use": len(self._browsers) - len(self._available_browsers),
                "stats": self.get_stats()
            }
            raise BrowserPoolExhaustedError(context=context)
    
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
        """Cleanup idle browsers and manage pool size based on load conditions."""
        async with self._lock:
            current_time = time.time()
            
            # Import logger here to avoid circular imports
            from app.core.logging import get_logger
            logger = get_logger("browser_pool")
        
            # Calculate pool metrics
            pool_size = len(self._browsers)
            available_count = len(self._available_browsers)
            in_use_count = pool_size - available_count
            usage_ratio = in_use_count / max(pool_size, 1)  # Avoid division by zero
            
            # Log current pool status with more detailed metrics
            logger.debug(f"Browser pool status: {pool_size} browsers, {available_count} available, {usage_ratio:.2f} usage ratio", {
                "pool_size": pool_size,
                "available": available_count,
                "in_use": in_use_count,
                "usage_ratio": usage_ratio,
                "min_size": self._min_size,
                "max_size": self._max_size
            })
            
            # Determine if we're under high load (more than 80% of browsers in use)
            high_load = usage_ratio > 0.8
            
            # Browsers to recycle based on various criteria
            browsers_to_recycle = []
        
            # Check each browser against recycling criteria
            for i, browser_data in enumerate(self._browsers):
                # Only consider browsers that are available for recycling
                if i not in self._available_browsers:
                    continue
                    
                # Calculate age and idle time
                browser_age = current_time - browser_data["created_at"]
                idle_time = current_time - browser_data["last_used"]
                usage_count = browser_data["usage_count"]
                
                # Criteria for recycling:
                # 1. Browser exceeds maximum age
                if browser_age > self._max_age:
                    browsers_to_recycle.append((i, "age", browser_age))
                    logger.debug(f"Marking browser {i} for recycling due to age: {browser_age:.1f}s > {self._max_age}s")
                # 2. Browser has been idle for too long
                elif idle_time > self._idle_timeout:
                    browsers_to_recycle.append((i, "idle", idle_time))
                    logger.debug(f"Marking browser {i} for recycling due to idle time: {idle_time:.1f}s > {self._idle_timeout}s")
                # 3. Under high load, recycle browsers with high usage count to prevent memory leaks
                elif high_load and usage_count > 50:
                    browsers_to_recycle.append((i, "usage", usage_count))
                    logger.debug(f"Marking browser {i} for recycling due to high usage count: {usage_count} > 50")
            
            # Sort browsers to recycle by priority (age first, then idle time, then usage count)
            browsers_to_recycle.sort(key=lambda x: x[0], reverse=True)  # Sort by index in reverse order for safe removal
            
            # Process browsers marked for recycling
            for i, reason, value in browsers_to_recycle:
                try:
                    # Close all contexts
                    for context in self._browsers[i]["contexts"]:
                        try:
                            await context.close()
                        except Exception as e:
                            logger.debug(f"Error closing context during recycling: {str(e)}")
                    
                    # Close the browser
                    await self._browsers[i]["browser"].close()
                    
                    # Stop playwright
                    await self._browsers[i]["playwright"].stop()
                    
                    logger.debug(f"Recycled browser {i} due to {reason}: {value:.1f}")
                except Exception as e:
                    logger.warning(f"Error recycling browser {i}: {str(e)}")
                
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
            
            # Proactive scaling: If we're under high load and have capacity, create new browsers
            if high_load and pool_size < self._max_size:
                browsers_to_add = min(5, self._max_size - pool_size)  # Add up to 5 browsers at once
                logger.info(f"High load detected ({usage_ratio:.2f}), proactively adding {browsers_to_add} browsers")
                
                for _ in range(browsers_to_add):
                    browser_data = await self._create_browser_instance()
                    if browser_data:
                        self._browsers.append(browser_data)
                        browser_index = len(self._browsers) - 1
                        self._available_browsers.append(browser_index)
                        logger.debug(f"Proactively added browser {browser_index}")
                    else:
                        logger.warning("Failed to create browser instance for proactive scaling")
            
            # If we have too many browsers and low usage, scale down to save resources
            elif pool_size > self._min_size and usage_ratio < 0.3:
                # Keep at least min_size browsers, but reduce excess if usage is low
                excess_browsers = min(pool_size - self._min_size, 3)  # Remove up to 3 at once
                if excess_browsers > 0:
                    logger.info(f"Low usage detected ({usage_ratio:.2f}), removing {excess_browsers} excess browsers")
                    # We'll let the next cleanup cycle handle the actual removal based on idle time
            
            # Create browsers if below min_size
            while len(self._browsers) < self._min_size:
                browser_data = await self._create_browser_instance()
                if browser_data:
                    self._browsers.append(browser_data)
                    self._available_browsers.append(len(self._browsers) - 1)
                    
                    # Update stats
                    self._stats["current_size"] = len(self._browsers)
                    logger.debug(f"Created new browser to maintain minimum pool size: {len(self._browsers)}/{self._min_size}")
                else:
                    # If we couldn't create a browser, break to avoid infinite loop
                    logger.warning("Failed to create browser to maintain minimum pool size")
                    break
    
    async def shutdown(self):
        """Shutdown all browsers in the pool."""
        from app.core.logging import get_logger
        logger = get_logger("browser_pool")
        
        # Cancel cleanup task
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                # This is expected when cancelling a task
                logger.debug("Cleanup task cancelled during shutdown")
            except Exception as e:
                # Log any unexpected errors during cleanup task cancellation
                logger.warning(f"Error while cancelling cleanup task: {str(e)}", {
                    "error": str(e),
                    "error_type": type(e).__name__
                })
        
        browser_count = len(self._browsers)
        logger.info(f"Shutting down browser pool with {browser_count} browsers")
        
        async with self._lock:
            # Close all browsers
            for i, browser_data in enumerate(self._browsers):
                # Track context closure success for logging
                context_success = 0
                context_errors = 0
                
                # Close all contexts
                for j, context in enumerate(browser_data["contexts"]):
                    try:
                        await context.close()
                        context_success += 1
                    except (ConnectionError, TimeoutError) as e:
                        # Log specific network/timeout errors
                        context_errors += 1
                        logger.warning(f"Network error closing context {j} for browser {i}: {str(e)}", {
                            "error": str(e),
                            "error_type": type(e).__name__,
                            "browser_index": i,
                            "context_index": j
                        })
                    except Exception as e:
                        # Log unexpected errors with context
                        context_errors += 1
                        logger.error(f"Error closing context {j} for browser {i}: {str(e)}", {
                            "error": str(e),
                            "error_type": type(e).__name__,
                            "browser_index": i,
                            "context_index": j
                        })
                
                try:
                    # Close the browser
                    await browser_data["browser"].close()
                    
                    # Stop playwright
                    await browser_data["playwright"].stop()
                    
                    logger.debug(f"Successfully closed browser {i}", {
                        "browser_index": i,
                        "contexts_closed": context_success,
                        "context_errors": context_errors
                    })
                except (ConnectionError, TimeoutError) as e:
                    # Log specific network/timeout errors
                    logger.warning(f"Network error closing browser {i}: {str(e)}", {
                        "error": str(e),
                        "error_type": type(e).__name__,
                        "browser_index": i
                    })
                except Exception as e:
                    # Log unexpected errors with context
                    logger.error(f"Error closing browser {i}: {str(e)}", {
                        "error": str(e),
                        "error_type": type(e).__name__,
                        "browser_index": i
                    })
            
            # Clear lists
            self._browsers = []
            self._available_browsers = []
            
            # Update stats
            self._stats["current_size"] = 0
            self._stats["current_usage"] = 0
            
            logger.info("Browser pool shutdown complete")
    
    async def browser_context(self, **kwargs) -> AsyncGenerator[Tuple[BrowserContext, int], None]:
        """Context manager for safely using a browser and context.
        
        This is the recommended way to get and use a browser context, as it ensures
        proper cleanup even in case of exceptions.
        
        Example:
            ```python
            async with browser_pool.browser_context() as (context, browser_index):
                page = await context.new_page()
                # Use the page...
            # Context and page are automatically closed and browser is released
            ```
            
        Args:
            **kwargs: Additional arguments to pass to browser.new_context()
            
        Yields:
            Tuple of (context, browser_index)
        """
        from app.core.logging import get_logger
        logger = get_logger("browser_pool")
        
        browser, browser_index = None, None
        context = None
        
        try:
            # Get a browser from the pool
            browser, browser_index = await self.get_browser()
            if browser is None or browser_index is None:
                logger.error("Failed to get browser from pool")
                raise RuntimeError("Failed to get browser from pool")
                
            # Create a context
            context = await self.create_context(browser_index, **kwargs)
            if context is None:
                logger.error(f"Failed to create context for browser {browser_index}")
                await self.release_browser(browser_index, is_healthy=False)
                raise RuntimeError(f"Failed to create context for browser {browser_index}")
                
            # Yield the context and browser index
            yield context, browser_index
        except Exception as e:
            # Handle any exceptions during setup
            logger.error(f"Error in browser_context setup: {str(e)}", {
                "error": str(e),
                "error_type": type(e).__name__,
                "browser_index": browser_index
            })
            
            # Clean up if needed
            if context is not None and browser_index is not None:
                try:
                    await asyncio.wait_for(self.release_context(browser_index, context), timeout=5.0)
                except Exception as cleanup_error:
                    logger.error(f"Error releasing context during exception handling: {str(cleanup_error)}")
            elif browser_index is not None:
                try:
                    await asyncio.wait_for(self.release_browser(browser_index, is_healthy=False), timeout=5.0)
                except Exception as cleanup_error:
                    logger.error(f"Error releasing browser during exception handling: {str(cleanup_error)}")
                    
            # Re-raise the original exception
            raise
        finally:
            # This block runs after the with block completes or if an exception occurs
            if context is not None and browser_index is not None:
                try:
                    await asyncio.wait_for(self.release_context(browser_index, context), timeout=5.0)
                except Exception as e:
                    logger.error(f"Error in browser_context cleanup: {str(e)}", {
                        "error": str(e),
                        "error_type": type(e).__name__,
                        "browser_index": browser_index
                    })
                    # Force browser recycling as a last resort
                    try:
                        await asyncio.wait_for(self.release_browser(browser_index, is_healthy=False), timeout=5.0)
                    except Exception:
                        logger.error(f"Failed to recycle browser {browser_index} during cleanup")
    
    def get_stats(self) -> Dict[str, Any]:
        """Get pool statistics with detailed metrics.
        
        Returns:
            Dictionary with comprehensive pool statistics including usage ratio
        """
        # Calculate current metrics
        pool_size = len(self._browsers)
        available_count = len(self._available_browsers)
        in_use_count = pool_size - available_count
        usage_ratio = in_use_count / max(pool_size, 1)  # Avoid division by zero
        
        return {
            # Size metrics
            "size": pool_size,
            "available": available_count,
            "in_use": in_use_count,
            "usage_ratio": usage_ratio,
            "min_size": self._min_size,
            "max_size": self._max_size,
            
            # Activity metrics
            "created": self._stats["created"],
            "reused": self._stats["reused"],
            "errors": self._stats["errors"],
            "recycled": self._stats["recycled"],
            "peak_usage": self._stats["peak_usage"],
            "current_usage": self._stats["current_usage"],
            "current_size": self._stats["current_size"]
        }
