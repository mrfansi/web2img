import asyncio
import time
import random
from typing import Dict, List, Optional, Tuple, Any, AsyncGenerator

from playwright.async_api import async_playwright, Browser, BrowserContext
from app.core.config import settings
from app.core.logging import get_logger
from app.services.browser_manager import browser_manager


class BrowserPool:
    """A pool of browser instances for efficient reuse."""

    def __init__(
        self,
        min_size: int = None,
        max_size: int = None,
        idle_timeout: int = None,
        max_age: int = None,
        cleanup_interval: int = None
    ):
        """Initialize the browser pool.
        
        Args:
            min_size: Minimum number of browser instances to keep in the pool
            max_size: Maximum number of browser instances allowed in the pool
            idle_timeout: Time in seconds after which an idle browser is closed
            max_age: Maximum age in seconds for a browser instance before forced recycling
            cleanup_interval: Interval in seconds for running cleanup tasks
            
        Note:
            If any parameter is None, it will be loaded from settings.
            This allows dynamic reconfiguration by updating the settings.
        """
        # Initialize logger
        self.logger = get_logger("browser_pool")
        
        # Initialize pool parameters from settings if not provided
        self._min_size = min_size if min_size is not None else settings.browser_pool_min_size
        self._max_size = max_size if max_size is not None else settings.browser_pool_max_size
        self._idle_timeout = idle_timeout if idle_timeout is not None else settings.browser_pool_idle_timeout
        self._max_age = max_age if max_age is not None else settings.browser_pool_max_age
        self._cleanup_interval = cleanup_interval if cleanup_interval is not None else settings.browser_pool_cleanup_interval
        
        # Log configuration
        self.logger.info("Initializing browser pool", {
            "min_size": self._min_size,
            "max_size": self._max_size,
            "idle_timeout": self._idle_timeout,
            "max_age": self._max_age,
            "cleanup_interval": self._cleanup_interval
        })
        
        # Initialize pool data structures
        self._browsers: List[Dict[str, Any]] = []  # List of browser instances with metadata
        self._available_browsers: List[int] = []  # Indices of available browsers
        self._lock = asyncio.Lock()
        self._last_cleanup = time.time()
        
        # Initialize statistics
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
        self._stuck_browser_cleanup_task = None
        
    async def initialize(self):
        """Initialize the pool with minimum number of browsers."""
        self.logger.info("Starting browser pool initialization", {
            "min_size": self._min_size,
            "max_size": self._max_size,
            "current_size": len(self._browsers)
        })
        
        # Track initialization metrics
        start_time = time.time()
        success_count = 0
        failure_count = 0
        
        async with self._lock:
            # Check if we need to adjust pool size based on current state
            current_size = len(self._browsers)
            browsers_to_create = max(0, self._min_size - current_size)
            
            if browsers_to_create > 0:
                self.logger.info(f"Creating {browsers_to_create} browsers to reach minimum pool size")
                
                # Create initial browser instances in parallel for faster startup
                # This helps ensure we're ready for concurrent requests right away
                tasks = []
                for _ in range(browsers_to_create):
                    tasks.append(self._create_browser_instance())
                
                # Wait for all browsers to be created
                results = await asyncio.gather(*tasks, return_exceptions=True)
                
                # Process results
                for result in results:
                    if isinstance(result, Exception):
                        self.logger.warning(f"Failed to create browser during initialization: {str(result)}", {
                            "error": str(result),
                            "error_type": type(result).__name__
                        })
                        failure_count += 1
                        continue
                        
                    if result:  # result is browser_data
                        self._browsers.append(result)
                        self._available_browsers.append(len(self._browsers) - 1)
                        success_count += 1
            else:
                self.logger.info("Pool already at or above minimum size, skipping browser creation")
            
            # Start cleanup task if not already running
            if self._cleanup_task is None or self._cleanup_task.done():
                self._cleanup_task = asyncio.create_task(self._cleanup_loop())
                self.logger.debug("Started browser pool cleanup task")

            # Start stuck browser cleanup task
            if self._stuck_browser_cleanup_task is None or self._stuck_browser_cleanup_task.done():
                self._stuck_browser_cleanup_task = asyncio.create_task(self._stuck_browser_cleanup_loop())
                self.logger.debug("Started stuck browser cleanup task")
            
            # Update stats
            self._stats["current_size"] = len(self._browsers)
            
            # Calculate initialization metrics
            duration = time.time() - start_time
            total_attempted = browsers_to_create
            success_rate = success_count / total_attempted if total_attempted > 0 else 1.0
            
            # Log initialization results (enhanced when LOG_BROWSER_POOL_STATS is enabled)
            log_data = {
                "duration": round(duration, 2),
                "success_count": success_count,
                "failure_count": failure_count,
                "total_attempted": total_attempted,
                "success_rate": round(success_rate * 100, 1),
                "current_size": len(self._browsers),
                "available": len(self._available_browsers)
            }

            if settings.log_browser_pool_stats:
                log_data.update({
                    "min_size": self._min_size,
                    "max_size": self._max_size,
                    "idle_timeout": self._idle_timeout,
                    "max_age": self._max_age,
                    "stats": self._stats
                })

            self.logger.info("Browser pool initialization completed", log_data)
            
            # If we couldn't create enough browsers, log a warning
            if len(self._browsers) < self._min_size:
                self.logger.warning("Browser pool initialized below minimum size", {
                    "current_size": len(self._browsers),
                    "min_size": self._min_size,
                    "deficit": self._min_size - len(self._browsers)
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
            # Get the configured browser engine
            engine = settings.validate_browser_engine()

            # Launch browser using the browser manager
            browser = await browser_manager.launch_browser(engine)

            if not browser:
                self.logger.error(f"Failed to launch {engine} browser")
                return None
            
            # Create browser data with metadata
            browser_data = {
                "browser": browser,
                "engine": engine,
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
        # Get current pool configuration from settings in case it was updated
        dynamic_max_size = settings.browser_pool_max_size
        
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
                
                # Log browser reuse (enhanced when LOG_BROWSER_POOL_STATS is enabled)
                log_data = {
                    "browser_index": browser_index,
                    "usage_count": browser_data["usage_count"],
                    "age": round(time.time() - browser_data["created_at"], 1)
                }

                if settings.log_browser_pool_stats:
                    log_data.update({
                        "pool_size": len(self._browsers),
                        "available": len(self._available_browsers),
                        "in_use": len(self._browsers) - len(self._available_browsers),
                        "current_usage": self._stats["current_usage"],
                        "peak_usage": self._stats["peak_usage"]
                    })
                    self.logger.info(f"Reusing browser {browser_index}", log_data)
                else:
                    self.logger.debug(f"Reusing browser {browser_index}", log_data)
                
                return browser_data["browser"], browser_index
            
            # If we don't have an available browser and haven't reached max size, create a new one
            # Use the dynamic max size from settings in case it was updated
            if len(self._browsers) < dynamic_max_size:
                # Update our internal max_size to match the current setting
                if dynamic_max_size != self._max_size:
                    self.logger.info(f"Updating browser pool max size from {self._max_size} to {dynamic_max_size}")
                    self._max_size = dynamic_max_size
                
                self.logger.debug(f"Creating new browser (current pool size: {len(self._browsers)}/{self._max_size})")
                browser_data = await self._create_browser_instance()
                
                if browser_data:
                    self._browsers.append(browser_data)
                    browser_index = len(self._browsers) - 1
                    
                    # Update stats
                    self._stats["current_size"] = len(self._browsers)
                    self._stats["current_usage"] = len(self._browsers) - len(self._available_browsers)
                    self._stats["peak_usage"] = max(self._stats["peak_usage"], self._stats["current_usage"])
                    
                    self.logger.debug(f"Created new browser {browser_index}", {
                        "browser_index": browser_index,
                        "pool_size": len(self._browsers),
                        "max_size": self._max_size
                    })
                    
                    return browser_data["browser"], browser_index
                else:
                    self.logger.warning("Failed to create new browser instance")
            
            # If we've reached max size, implement a more sophisticated waiting strategy
            # Log the issue and update error stats
            self._stats["errors"] += 1
            
            # Calculate pool utilization metrics
            pool_size = len(self._browsers)
            available_count = len(self._available_browsers)
            in_use_count = pool_size - available_count
            utilization_pct = round((in_use_count / pool_size) * 100, 1) if pool_size > 0 else 0
            
            # Enhanced capacity warning when LOG_BROWSER_POOL_STATS is enabled
            log_data = {
                "pool_size": pool_size,
                "max_size": self._max_size,
                "available": available_count,
                "in_use": in_use_count,
                "utilization_pct": utilization_pct
            }

            if settings.log_browser_pool_stats:
                log_data.update({
                    "stats": self._stats,
                    "min_size": self._min_size,
                    "idle_timeout": self._idle_timeout,
                    "max_age": self._max_age
                })

            self.logger.warning(f"Browser pool at capacity ({pool_size}/{self._max_size}), waiting for an available browser", log_data)
        
            # Use optimized adaptive exponential backoff for high concurrency scenarios
            # Increase max attempts and reduce wait time for better throughput
            utilization_factor = in_use_count / max(1, pool_size)  # Avoid division by zero
            max_wait_attempts = min(25, 10 + int(15 * utilization_factor))  # 10-25 attempts for high concurrency
            base_wait_time = 0.05 * (1 + utilization_factor * 0.5)  # 0.05-0.075s for faster response
            
            for retry in range(max_wait_attempts):
                # Calculate wait time with optimized exponential backoff for high concurrency
                wait_time = min(2.0, base_wait_time * (1.5 ** retry))  # Reduced max wait and growth factor

                # Add smaller jitter to prevent thundering herd problem
                jitter = wait_time * 0.1  # 10% jitter for faster response
                wait_time = wait_time + (random.random() * 2 - 1) * jitter
                
                # Release the lock while waiting to allow other operations
                self._lock.release()
                
                # Wait with backoff
                self.logger.debug(f"Waiting {wait_time:.2f}s for an available browser (attempt {retry+1}/{max_wait_attempts})", {
                    "retry": retry + 1,
                    "max_attempts": max_wait_attempts,
                    "wait_time": round(wait_time, 2)
                })
                
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
                    
                    self.logger.info(f"Successfully acquired browser after waiting (attempt {retry+1}/{max_wait_attempts})", {
                        "browser_index": browser_index,
                        "wait_attempts": retry + 1,
                        "wait_time_total": round(sum([min(8.0, base_wait_time * (2 ** r)) for r in range(retry + 1)]), 2)
                    })
                    
                    return browser_data["browser"], browser_index
                
                # Check if the max size has been increased while we were waiting
                current_dynamic_max_size = settings.browser_pool_max_size
                if current_dynamic_max_size > self._max_size and len(self._browsers) < current_dynamic_max_size:
                    # Max size has been increased, try to create a new browser
                    self.logger.info(f"Max size increased from {self._max_size} to {current_dynamic_max_size}, creating new browser")
                    self._max_size = current_dynamic_max_size
                    
                    browser_data = await self._create_browser_instance()
                    if browser_data:
                        self._browsers.append(browser_data)
                        browser_index = len(self._browsers) - 1
                        
                        # Update stats
                        self._stats["current_size"] = len(self._browsers)
                        self._stats["current_usage"] = len(self._browsers) - len(self._available_browsers)
                        self._stats["peak_usage"] = max(self._stats["peak_usage"], self._stats["current_usage"])
                        
                        self.logger.info(f"Created new browser {browser_index} after max size increase")
                        return browser_data["browser"], browser_index
        
            # If we still don't have an available browser, raise a detailed error
            from app.core.errors import BrowserPoolExhaustedError
            
            # Get detailed stats for error reporting
            detailed_stats = self.get_stats()
            
            context = {
                "pool_size": len(self._browsers),
                "max_size": self._max_size,
                "available": len(self._available_browsers),
                "in_use": len(self._browsers) - len(self._available_browsers),
                "utilization_pct": utilization_pct,
                "wait_attempts": max_wait_attempts,
                "total_wait_time": round(sum([min(8.0, base_wait_time * (2 ** r)) for r in range(max_wait_attempts)]), 2),
                "stats": detailed_stats
            }
            
            self.logger.error("Browser pool exhausted after maximum wait attempts", context)
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
                from app.core.logging import get_logger
                logger = get_logger("browser_pool")
                logger.warning(f"Attempted to release invalid browser index: {browser_index}")
                return

            browser_data = self._browsers[browser_index]

            # CRITICAL FIX: Always return browser to available pool first
            # This ensures browsers are released even if recycling fails
            current_time = time.time()
            browser_data["last_used"] = current_time

            # Force return to available pool if not already there
            if browser_index not in self._available_browsers:
                self._available_browsers.append(browser_index)
                from app.core.logging import get_logger
                logger = get_logger("browser_pool")
                logger.debug(f"Released browser {browser_index} back to available pool")

            # Update stats immediately
            self._stats["current_usage"] = len(self._browsers) - len(self._available_browsers)

            # Check if browser needs to be recycled (but don't block release)
            age = current_time - browser_data["created_at"]
            if not is_healthy or age > self._max_age:
                # Schedule recycling asynchronously to not block release
                asyncio.create_task(self._async_recycle_browser(browser_index))
                from app.core.logging import get_logger
                logger = get_logger("browser_pool")
                logger.debug(f"Scheduled browser {browser_index} for recycling (healthy={is_healthy}, age={age:.1f}s)")
    
    async def _recycle_browser(self, browser_index: int):
        """Recycle a browser instance by closing it and creating a new one.
        
        Args:
            browser_index: Index of the browser to recycle
        """
        # Get the browser data
        browser_data = self._browsers[browser_index]

        # Clean up tabs associated with this browser
        try:
            from app.services.tab_pool import tab_pool
            await tab_pool.cleanup_browser_tabs(browser_index)
        except Exception as e:
            self.logger.warning(f"Error cleaning up tabs for browser {browser_index}: {str(e)}")

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
        
        # Browser cleanup complete (playwright managed globally)
        
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

    async def _async_recycle_browser(self, browser_index: int):
        """Asynchronously recycle a browser without blocking release.

        Args:
            browser_index: Index of the browser to recycle
        """
        try:
            # Wait a bit to ensure the browser is not in use
            await asyncio.sleep(1.0)

            async with self._lock:
                # Check if browser index is still valid
                if browser_index < 0 or browser_index >= len(self._browsers):
                    return

                # Check if browser is currently available (not in use)
                if browser_index in self._available_browsers:
                    from app.core.logging import get_logger
                    logger = get_logger("browser_pool")
                    logger.debug(f"Recycling available browser {browser_index}")
                    await self._recycle_browser(browser_index)
                else:
                    # Browser is in use, schedule for later recycling
                    logger.debug(f"Browser {browser_index} in use, will recycle later")
        except Exception as e:
            from app.core.logging import get_logger
            logger = get_logger("browser_pool")
            logger.warning(f"Error in async browser recycling for browser {browser_index}: {str(e)}")
    
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
            
            # Check if browser is still healthy
            if not browser_data.get("browser") or not browser_data["browser"].is_connected():
                from app.core.logging import get_logger
                logger = get_logger("browser_pool")
                logger.warning(f"Browser {browser_index} is disconnected, marking as unhealthy")
                self._stats["errors"] += 1
                return None

            try:
                # Create a new context with timeout protection
                context = await asyncio.wait_for(
                    browser_data["browser"].new_context(**kwargs),
                    timeout=10.0  # 10 second timeout for context creation
                )

                # Add to contexts list
                browser_data["contexts"].append(context)

                # Update usage stats
                browser_data["usage_count"] += 1
                browser_data["last_used"] = time.time()

                return context

            except asyncio.TimeoutError:
                from app.core.logging import get_logger
                logger = get_logger("browser_pool")
                logger.error(f"Timeout creating context for browser {browser_index}")
                self._stats["errors"] += 1
                # Mark browser as potentially unhealthy
                browser_data["last_error"] = time.time()
                return None

            except Exception as e:
                from app.core.logging import get_logger
                logger = get_logger("browser_pool")
                # Update stats
                self._stats["errors"] += 1
                logger.error(f"Error creating browser context for browser {browser_index}: {str(e)}", {
                    "error": str(e),
                    "error_type": type(e).__name__,
                    "browser_index": browser_index
                })

                # Mark browser as potentially unhealthy
                browser_data["last_error"] = time.time()

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
            
            # Log current pool status with more detailed metrics (controlled by LOG_BROWSER_POOL_STATS)
            from app.core.config import settings
            if settings.log_browser_pool_stats:
                logger.info(f"Browser pool status: {pool_size} browsers, {available_count} available, {usage_ratio:.2f} usage ratio", {
                    "pool_size": pool_size,
                    "available": available_count,
                    "in_use": in_use_count,
                    "usage_ratio": usage_ratio,
                    "min_size": self._min_size,
                    "max_size": self._max_size,
                    "stats": self._stats
                })
            else:
                logger.debug(f"Browser pool status: {pool_size} browsers, {available_count} available, {usage_ratio:.2f} usage ratio")
            
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
        
        # Cancel cleanup tasks
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

        # Cancel stuck browser cleanup task
        if self._stuck_browser_cleanup_task:
            self._stuck_browser_cleanup_task.cancel()
            try:
                await self._stuck_browser_cleanup_task
            except asyncio.CancelledError:
                logger.debug("Stuck browser cleanup task cancelled during shutdown")
            except Exception as e:
                logger.warning(f"Error while cancelling stuck browser cleanup task: {str(e)}", {
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


    async def force_recycle(self, count: int = 1) -> int:
        """Force recycle a specific number of browsers, prioritizing in-use ones.
        
        This method is used by the watchdog to recover from stuck browser situations.
        
        Args:
            count: Number of browsers to forcibly recycle
            
        Returns:
            Number of browsers actually recycled
        """
        from app.core.logging import get_logger
        logger = get_logger("browser_pool")
        
        async with self._lock:
            # Calculate pool metrics
            pool_size = len(self._browsers)
            available_count = len(self._available_browsers)
            in_use_count = pool_size - available_count
            
            # Limit count to actual pool size
            count = min(count, pool_size)
            
            if count <= 0:
                return 0
                
            logger.info(f"Force recycling {count} browsers", {
                "requested_count": count,
                "pool_size": pool_size,
                "in_use": in_use_count
            })
            
            # First, identify browsers that are in use (not in available_browsers)
            in_use_browsers = [i for i in range(len(self._browsers)) if i not in self._available_browsers]
            
            # Prioritize in-use browsers, but fall back to available ones if needed
            browsers_to_recycle = []
            
            # Add in-use browsers first
            browsers_to_recycle.extend(in_use_browsers[:count])
            
            # If we need more, add available browsers
            if len(browsers_to_recycle) < count:
                remaining = count - len(browsers_to_recycle)
                browsers_to_recycle.extend(self._available_browsers[:remaining])
            
            # Sort in reverse order for safe removal
            browsers_to_recycle.sort(reverse=True)
            
            # Track how many we actually recycled
            recycled_count = 0
            
            # Process browsers to recycle
            for i in browsers_to_recycle:
                try:
                    # Close all contexts
                    for context in self._browsers[i]["contexts"]:
                        try:
                            await context.close()
                        except Exception as e:
                            logger.debug(f"Error closing context during force recycling: {str(e)}")
                    
                    # Close the browser
                    await self._browsers[i]["browser"].close()
                    
                    # Remove from browsers list
                    self._browsers.pop(i)
                    
                    # Update available_browsers list
                    if i in self._available_browsers:
                        self._available_browsers.remove(i)
                    
                    # Update indices in available_browsers
                    for j, idx in enumerate(self._available_browsers):
                        if idx > i:
                            self._available_browsers[j] = idx - 1
                    
                    # Update stats
                    self._stats["current_size"] = len(self._browsers)
                    self._stats["recycled"] += 1
                    recycled_count += 1
                    
                    logger.info(f"Force recycled browser {i}")
                except Exception as e:
                    logger.error(f"Error during force recycling of browser {i}: {str(e)}")
            
            # Create replacement browsers to maintain minimum pool size
            current_size = len(self._browsers)
            if current_size < self._min_size:
                browsers_to_create = self._min_size - current_size
                logger.info(f"Creating {browsers_to_create} browsers to maintain minimum pool size")
                
                for _ in range(browsers_to_create):
                    browser_data = await self._create_browser_instance()
                    if browser_data:
                        self._browsers.append(browser_data)
                        self._available_browsers.append(len(self._browsers) - 1)
            
            return recycled_count

    async def get_browser_ages(self) -> dict:
        """Get the age of each browser in the pool.

        Returns:
            Dictionary mapping browser index to age in seconds
        """
        async with self._lock:
            current_time = time.time()
            return {i: current_time - browser_data["created_at"]
                for i, browser_data in enumerate(self._browsers)}

    async def _cleanup_unhealthy_browsers(self):
        """Force cleanup of browsers that appear to be unhealthy or stuck."""
        from app.core.logging import get_logger
        logger = get_logger("browser_pool")

        async with self._lock:
            current_time = time.time()
            browsers_to_recycle = []
            browsers_to_force_release = []

            # Check each browser for health issues
            for i, browser_data in enumerate(self._browsers):
                # Skip browsers that are currently available (likely healthy)
                if i in self._available_browsers:
                    continue

                # Check for browsers with recent errors
                last_error = browser_data.get("last_error", 0)
                if last_error > 0 and (current_time - last_error) < 60:  # Error in last minute
                    browsers_to_recycle.append((i, "recent_error"))
                    continue

                # Check for browsers that have been in use too long (STUCK BROWSER DETECTION)
                last_used = browser_data.get("last_used", current_time)
                time_in_use = current_time - last_used

                if time_in_use > 120:  # In use for more than 2 minutes - likely stuck
                    # Force release stuck browsers immediately
                    browsers_to_force_release.append((i, "stuck_in_use", time_in_use))
                    continue
                elif time_in_use > 300:  # In use for more than 5 minutes - definitely stuck
                    browsers_to_recycle.append((i, "stuck_in_use_long"))
                    continue

                # Check for browsers with too many contexts
                context_count = len(browser_data.get("contexts", []))
                if context_count > 10:  # Too many contexts
                    browsers_to_recycle.append((i, "too_many_contexts"))
                    continue

            # CRITICAL: Force release stuck browsers first
            force_released_count = 0
            for browser_index, reason, time_stuck in browsers_to_force_release:
                try:
                    logger.warning(f"FORCE RELEASING stuck browser {browser_index} - {reason} for {time_stuck:.1f}s")

                    # Force add to available browsers if not already there
                    if browser_index not in self._available_browsers:
                        self._available_browsers.append(browser_index)
                        force_released_count += 1

                        # Update last_used to current time
                        self._browsers[browser_index]["last_used"] = current_time

                        logger.info(f"Force released stuck browser {browser_index} back to available pool")

                except Exception as e:
                    logger.error(f"Error force releasing stuck browser {browser_index}: {str(e)}")

            # Update stats after force release
            self._stats["current_usage"] = len(self._browsers) - len(self._available_browsers)

            # Recycle unhealthy browsers
            recycled_count = 0
            for browser_index, reason in browsers_to_recycle:
                try:
                    logger.info(f"Force recycling unhealthy browser {browser_index} due to {reason}")
                    await self._recycle_browser(browser_index)
                    recycled_count += 1
                except Exception as e:
                    logger.error(f"Error recycling unhealthy browser {browser_index}: {str(e)}")

            if force_released_count > 0 or recycled_count > 0:
                logger.info(f"Browser cleanup: {force_released_count} force released, {recycled_count} recycled")

                # Create replacement browsers if needed
                current_size = len(self._browsers)
                if current_size < self._min_size:
                    browsers_to_create = min(3, self._min_size - current_size)  # Create up to 3 at once
                    for _ in range(browsers_to_create):
                        browser_data = await self._create_browser_instance()
                        if browser_data:
                            self._browsers.append(browser_data)
                            self._available_browsers.append(len(self._browsers) - 1)
                            logger.info(f"Created replacement browser {len(self._browsers) - 1}")
                        else:
                            break

            return force_released_count + recycled_count

    async def _stuck_browser_cleanup_loop(self):
        """Background task to periodically check for and release stuck browsers."""
        from app.core.logging import get_logger
        logger = get_logger("browser_pool")

        logger.info("Started stuck browser cleanup loop")

        try:
            while True:
                try:
                    # Run stuck browser cleanup every 30 seconds
                    await asyncio.sleep(30)

                    # Check for stuck browsers and force release them
                    cleaned_count = await self._cleanup_unhealthy_browsers()

                    if cleaned_count > 0:
                        logger.info(f"Stuck browser cleanup: processed {cleaned_count} browsers")

                except asyncio.CancelledError:
                    logger.info("Stuck browser cleanup loop cancelled")
                    break
                except Exception as e:
                    logger.error(f"Error in stuck browser cleanup loop: {str(e)}")
                    # Continue running even if there's an error
                    await asyncio.sleep(10)

        except Exception as e:
            logger.error(f"Fatal error in stuck browser cleanup loop: {str(e)}")

