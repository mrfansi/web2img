import asyncio
import os
import time
import uuid
from typing import Dict, Optional, Tuple, Any, AsyncGenerator

from app.core.logging import get_logger

from playwright.async_api import BrowserContext, Page, TimeoutError as PlaywrightTimeoutError

from app.core.config import settings
from app.services.browser_pool import BrowserPool
from app.services.retry import RetryConfig, CircuitBreaker, RetryManager
from app.services.browser_cache import browser_cache_service



class ScreenshotService:
    """Service for capturing screenshots using Playwright."""

    def __init__(self):
        # Initialize logger
        self.logger = get_logger("screenshot_service")

        # Initialize the browser pool with configuration from settings
        self._browser_pool = BrowserPool(
            min_size=settings.browser_pool_min_size,
            max_size=settings.browser_pool_max_size,
            idle_timeout=settings.browser_pool_idle_timeout,
            max_age=settings.browser_pool_max_age,
            cleanup_interval=settings.browser_pool_cleanup_interval
        )
        self._last_cleanup = time.time()
        self._lock = asyncio.Lock()

        # Resource tracking for automatic cleanup
        self._active_resources = {
            "contexts": set(),  # Set of (browser_index, context) tuples
            "pages": set()     # Set of page objects
        }
        self._resource_lock = asyncio.Lock()

        # Cleanup task
        self._cleanup_task = None
        self._cleanup_interval = settings.screenshot_cleanup_interval or 300  # 5 minutes default

        # Create retry configurations
        self._retry_config_regular = RetryConfig(
            max_retries=settings.max_retries_regular,
            base_delay=settings.retry_base_delay,
            max_delay=settings.retry_max_delay,
            jitter=settings.retry_jitter
        )

        self._retry_config_complex = RetryConfig(
            max_retries=settings.max_retries_complex,
            base_delay=settings.retry_base_delay,
            max_delay=settings.retry_max_delay,
            jitter=settings.retry_jitter
        )

        # Create circuit breakers
        self._browser_circuit_breaker = CircuitBreaker(
            threshold=settings.circuit_breaker_threshold,
            reset_time=settings.circuit_breaker_reset_time
        )

        self._navigation_circuit_breaker = CircuitBreaker(
            threshold=settings.circuit_breaker_threshold,
            reset_time=settings.circuit_breaker_reset_time
        )

        # Create retry managers
        self._browser_retry_manager = RetryManager(
            retry_config=self._retry_config_regular,
            circuit_breaker=self._browser_circuit_breaker,
            name="browser_operations"
        )

        # Statistics
        self._timeout_stats = {
            "navigation": 0,
            "browser": 0,
            "context": 0,
            "page": 0,
            "screenshot": 0
        }

        # Health monitoring
        self._health_stats = {
            "consecutive_failures": 0,
            "last_success_time": time.time(),
            "total_requests": 0,
            "failed_requests": 0,
            "recovery_attempts": 0
        }



        # Ensure screenshot directory exists
        os.makedirs(settings.screenshot_dir, exist_ok=True)

    def _update_health_stats(self, success: bool):
        """Update health statistics."""
        self._health_stats["total_requests"] += 1

        if success:
            self._health_stats["consecutive_failures"] = 0
            self._health_stats["last_success_time"] = time.time()
        else:
            self._health_stats["consecutive_failures"] += 1
            self._health_stats["failed_requests"] += 1

    def _is_service_healthy(self) -> bool:
        """Check if the service is in a healthy state."""
        # Consider unhealthy if too many consecutive failures
        if self._health_stats["consecutive_failures"] >= 10:
            return False

        # Consider unhealthy if no success in the last 5 minutes
        time_since_success = time.time() - self._health_stats["last_success_time"]
        if time_since_success > 300:  # 5 minutes
            return False

        # Consider unhealthy if failure rate is too high
        if self._health_stats["total_requests"] > 20:
            failure_rate = self._health_stats["failed_requests"] / self._health_stats["total_requests"]
            if failure_rate > 0.8:  # 80% failure rate
                return False

        return True

    async def _attempt_service_recovery(self):
        """Attempt to recover the service from an unhealthy state."""
        self.logger.warning("Service appears unhealthy, attempting recovery")
        self._health_stats["recovery_attempts"] += 1

        try:
            # Force cleanup of all resources
            await self._cleanup_resources()

            # Reset browser pool
            if hasattr(self, '_browser_pool'):
                await self._browser_pool.cleanup()

            # Reset circuit breakers
            self._browser_circuit_breaker.failure_count = 0
            self._navigation_circuit_breaker.failure_count = 0

            # Reset some health stats
            self._health_stats["consecutive_failures"] = 0

            self.logger.info("Service recovery attempt completed")

        except Exception as e:
            self.logger.error(f"Service recovery failed: {str(e)}")

    async def startup(self):
        """Initialize the browser pool and start the cleanup task."""
        self.logger.info("Initializing screenshot service", {
            "browser_pool_config": {
                "min_size": settings.browser_pool_min_size,
                "max_size": settings.browser_pool_max_size,
                "idle_timeout": settings.browser_pool_idle_timeout,
                "max_age": settings.browser_pool_max_age
            },
            "retry_config": {
                "regular": {
                    "max_retries": settings.max_retries_regular,
                    "base_delay": settings.retry_base_delay,
                    "max_delay": settings.retry_max_delay
                },
                "complex": {
                    "max_retries": settings.max_retries_complex,
                    "base_delay": settings.retry_base_delay,
                    "max_delay": settings.retry_max_delay
                }
            },
            "cleanup_interval": self._cleanup_interval
        })

        # Initialize the browser pool
        await self._browser_pool.initialize()

        # Start the scheduled cleanup task
        self._start_cleanup_task()

        # Start browser cache cleanup task if enabled
        if settings.browser_cache_enabled:
            self._start_cache_cleanup_task()

        self.logger.info("Screenshot service initialized successfully")

    async def _get_context(self, width: int = 1280, height: int = 720) -> Tuple[Optional[BrowserContext], Optional[int]]:
        """Get a browser context from the pool.

        Note:
            It's recommended to use the managed_context() context manager instead
            of calling _get_context() and _return_context() directly.
        """
        # Get a browser from the pool
        browser, browser_index = await self._browser_pool.get_browser()
        if browser is None or browser_index is None:
            self.logger.error("Failed to get browser from pool")
            return None, None

        # Create a new context with the specified viewport size
        try:
            context = await self._browser_pool.create_context(
                browser_index,
                viewport={"width": width, "height": height},
                user_agent=settings.user_agent,
                ignore_https_errors=True
            )

            if context is None:
                self.logger.error(f"Failed to create context for browser {browser_index}")
                await self._browser_pool.release_browser(browser_index, is_healthy=False)
                return None, None

            # Track the context for automatic cleanup
            await self._track_resource("context", (browser_index, context))

            return context, browser_index
        except Exception as e:
            self.logger.error(f"Error creating context: {str(e)}", {
                "error": str(e),
                "error_type": type(e).__name__,
                "browser_index": browser_index
            })
            await self._browser_pool.release_browser(browser_index, is_healthy=False)
            return None, None

    async def _return_context(self, context: BrowserContext, browser_index: int, is_healthy: bool = True) -> None:
        """Return a browser context to the pool and untrack it."""
        try:
            # Untrack the context from resource tracking
            await self._untrack_resource("context", (browser_index, context))

            # Release the context back to the browser pool
            await self._browser_pool.release_context(browser_index, context)

            if not is_healthy:
                # If the context is not healthy, release the browser as unhealthy
                await self._browser_pool.release_browser(browser_index, is_healthy=False)
                self.logger.info(f"Released unhealthy browser {browser_index}")
        except Exception as e:
            self.logger.error(f"Error returning context: {str(e)}", {
                "error": str(e),
                "error_type": type(e).__name__,
                "browser_index": browser_index
            })
            # Try to release the browser as unhealthy as a last resort
            try:
                await self._browser_pool.release_browser(browser_index, is_healthy=False)
            except Exception as release_error:
                self.logger.error(f"Failed to release browser {browser_index} after context error: {str(release_error)}")

    async def managed_context(self, width: int = 1280, height: int = 720) -> AsyncGenerator[Tuple[BrowserContext, int, Page], None]:
        """Context manager for safely using a browser context and page.

        This is the recommended way to get and use a browser context and page, as it ensures
        proper cleanup even in case of exceptions.

        Example:
            ```python
            async with screenshot_service.managed_context(width=1280, height=720) as (context, browser_index, page):
                # Use the context and page...
            # Context, page, and browser are automatically cleaned up
            ```

        Args:
            width: The viewport width
            height: The viewport height

        Yields:
            Tuple of (context, browser_index, page)
        """
        context = None
        browser_index = None
        page = None

        try:
            # Get a context from the pool
            context, browser_index = await self._get_context(width, height)
            if context is None or browser_index is None:
                raise RuntimeError("Failed to get browser context")

            # Create a new page
            try:
                page = await asyncio.wait_for(
                    context.new_page(),
                    timeout=settings.page_creation_timeout
                )
                # Track the page for automatic cleanup
                await self._track_resource("page", page)
            except asyncio.TimeoutError:
                self.logger.error("Timeout creating new page")
                await self._return_context(context, browser_index, is_healthy=False)
                raise RuntimeError("Timeout creating new page")
            except Exception as e:
                self.logger.error(f"Error creating new page: {str(e)}", {
                    "error": str(e),
                    "error_type": type(e).__name__
                })
                await self._return_context(context, browser_index, is_healthy=False)
                raise RuntimeError(f"Error creating new page: {str(e)}")

            # Yield the context, browser index, and page
            yield context, browser_index, page
        except Exception as e:
            # Handle any exceptions during setup
            self.logger.error(f"Error in managed_context setup: {str(e)}", {
                "error": str(e),
                "error_type": type(e).__name__,
                "browser_index": browser_index
            })

            # Clean up if needed
            if page is not None and not page.is_closed():
                try:
                    await asyncio.wait_for(page.close(), timeout=3.0)
                    await self._untrack_resource("page", page)
                except Exception as cleanup_error:
                    self.logger.warning(f"Error closing page during exception handling: {str(cleanup_error)}")

            if context is not None and browser_index is not None:
                try:
                    await self._return_context(context, browser_index, is_healthy=False)
                except Exception as cleanup_error:
                    self.logger.error(f"Error returning context during exception handling: {str(cleanup_error)}")

            # Re-raise the original exception
            raise
        finally:
            # This block runs after the with block completes or if an exception occurs
            if page is not None and not page.is_closed():
                try:
                    await asyncio.wait_for(page.close(), timeout=3.0)
                    await self._untrack_resource("page", page)
                except Exception as e:
                    self.logger.warning(f"Error closing page during cleanup: {str(e)}", {
                        "error": str(e),
                        "error_type": type(e).__name__
                    })

            if context is not None and browser_index is not None:
                try:
                    await self._return_context(context, browser_index)
                except Exception as e:
                    self.logger.error(f"Error returning context during cleanup: {str(e)}", {
                        "error": str(e),
                        "error_type": type(e).__name__,
                        "browser_index": browser_index
                    })

    async def _get_navigation_strategy(self) -> Tuple[str, int]:
        """Get the navigation strategy for all URLs.

        Returns:
            Tuple of (wait_until, timeout_ms)
        """
        # Use domcontentloaded for faster, more reliable navigation
        # This is more resilient to slow-loading resources and network issues
        return "domcontentloaded", settings.navigation_timeout_regular

    async def capture_screenshot(self, url: str, width: int, height: int, format: str) -> str:
        """Capture a screenshot of the given URL.

        Args:
            url: The URL to capture
            width: The viewport width
            height: The viewport height
            format: The image format (png, jpeg, webp)

        Returns:
            Path to the saved screenshot file
        """
        from app.services.pool_watchdog import pool_watchdog
        if pool_watchdog:
            pool_watchdog.record_request()

        # Generate a unique filename
        filename = f"{uuid.uuid4()}.{format}"
        filepath = os.path.join(settings.screenshot_dir, filename)

        # Create context for logging
        context = {
            "url": url,
            "width": width,
            "height": height,
            "format": format,
            "filepath": filepath,
            "request_id": str(uuid.uuid4())  # Generate a unique ID for this request
        }

        # Start timer for performance tracking
        start_time = time.time()

        # Log browser pool stats before starting
        pool_stats = self._browser_pool.get_stats()
        self.logger.info(f"Starting screenshot capture for {url}", {
            **context,
            "browser_pool": {
                "size": pool_stats["size"],
                "available": pool_stats["available"],
                "in_use": pool_stats["in_use"]
            }
        })

        # Periodically clean up old temporary files
        current_time = time.time()
        if current_time - self._last_cleanup > 3600:  # 1 hour
            await self._cleanup_temp_files()
            self._last_cleanup = current_time

        try:
            # Execute screenshot capture directly
            return await self._capture_screenshot_impl(
                url=url,
                width=width,
                height=height,
                format=format,
                filepath=filepath,
                start_time=start_time
            )
        except Exception as e:
            # Clean up any partially created file
            if os.path.exists(filepath):
                os.unlink(filepath)

            # Log error with structured data
            duration = time.time() - start_time
            error_context = {
                "url": url,
                "width": width,
                "height": height,
                "format": format,
                "filepath": filepath,
                "duration": duration,
                "error": str(e),
                "error_type": type(e).__name__
            }

            self.logger.error(f"Failed to capture screenshot for {url}", error_context)

            # Use our custom error class for better error messages
            from app.core.errors import ScreenshotError
            raise ScreenshotError(url=url, context=error_context, original_exception=e)

    async def _create_retry_manager(self, is_complex: bool, name: str) -> RetryManager:
        """Create a retry manager based on site complexity and operation type.

        Args:
            is_complex: Whether the site is complex and needs special handling
            name: Name for the retry manager

        Returns:
            A configured RetryManager instance
        """
        # For context creation, use a more aggressive retry strategy with longer delays
        # to handle high concurrency better
        if name == "context_creation":
            # Create a special retry config for browser context creation using multipliers
            # This applies multipliers to the base retry settings for better handling of high concurrency
            from app.services.retry import RetryConfig

            # Select base retry config based on site complexity
            base_config = self._retry_config_complex if is_complex else self._retry_config_regular
            base_max_retries = settings.max_retries_complex if is_complex else settings.max_retries_regular

            # Apply multipliers to create an optimized config for context creation
            context_retry_config = RetryConfig(
                max_retries=int(base_max_retries * settings.context_retry_max_retries_multiplier),
                base_delay=base_config.base_delay * settings.context_retry_base_delay_multiplier,
                max_delay=base_config.max_delay * settings.context_retry_max_delay_multiplier,
                jitter=base_config.jitter * settings.context_retry_jitter_multiplier
            )

            # Create a retry manager optimized for high concurrency
            return RetryManager(
                retry_config=context_retry_config,
                circuit_breaker=None,  # No circuit breaker for context creation
                name=f"context_creation_{"complex" if is_complex else "regular"}"
            )
        else:
            # For other operations, use standard retry configuration based on complexity
            retry_config = self._retry_config_complex if is_complex else self._retry_config_regular

            # Create a retry manager for this operation
            return RetryManager(
                retry_config=retry_config,
                circuit_breaker=None,  # Circuit breakers are set separately if needed
                name=name
            )

    async def _configure_page_for_site(self, page: Page) -> None:
        """Configure page settings for optimal performance and faster loading.

        Args:
            page: The page to configure
        """
        # Set up browser caching first (before other route handlers)
        if settings.browser_cache_enabled:
            try:
                await browser_cache_service.setup_page_caching(page)
                self.logger.debug("Browser caching enabled for page")
            except Exception as e:
                self.logger.warning(f"Failed to setup browser caching: {str(e)}")

        # Configure resource blocking based on settings
        # Note: These routes are set up after caching to allow cache to handle resources first
        if settings.disable_media:
            await page.route('**/*.{mp3,mp4,ogg,webm,wav,avi,mov,wmv,flv}', lambda route: route.abort())

        if settings.disable_fonts:
            await page.route('**/*.{woff,woff2,ttf,otf,eot}', lambda route: route.abort())

        if settings.disable_images:
            await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,ico,bmp,tiff}', lambda route: route.abort())

        # Always block documents for performance
        await page.route('**/*.{pdf,doc,docx,xls,xlsx,ppt,pptx,zip,rar}', lambda route: route.abort())

        # Block analytics and tracking based on settings
        if settings.disable_analytics:
            await page.route('**/analytics.js', lambda route: route.abort())
            await page.route('**/gtag/**', lambda route: route.abort())
            await page.route('**/google-analytics.com/**', lambda route: route.abort())
            await page.route('**/googletagmanager.com/**', lambda route: route.abort())
            await page.route('**/facebook.com/tr/**', lambda route: route.abort())
            await page.route('**/doubleclick.net/**', lambda route: route.abort())
            await page.route('**/googleadservices.com/**', lambda route: route.abort())
            await page.route('**/googlesyndication.com/**', lambda route: route.abort())

        # Disable JavaScript if configured
        if settings.disable_javascript:
            await page.set_javascript_enabled(False)

        # Set headers to appear more like a real browser
        await page.set_extra_http_headers({
            'Accept-Language': 'en-US,en;q=0.9',
            'User-Agent': settings.user_agent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-User': '?1',
            'Sec-Fetch-Dest': 'document',
        })

        # Log the configuration being used
        self.logger.debug("Page configuration applied", {
            "browser_cache_enabled": settings.browser_cache_enabled,
            "disable_images": settings.disable_images,
            "disable_javascript": settings.disable_javascript,
            "disable_css": settings.disable_css,
            "disable_fonts": settings.disable_fonts,
            "disable_media": settings.disable_media,
            "disable_analytics": settings.disable_analytics
        })

    async def _navigate_to_url(self, page: Page, url: str, wait_until: str, page_timeout: int) -> Any:
        """Navigate to a URL with robust error handling and fallback strategies.

        Args:
            page: The page to navigate with
            url: The URL to navigate to
            wait_until: The wait_until strategy for navigation
            page_timeout: The timeout for navigation in milliseconds

        Returns:
            The navigation response or None for partial success

        Raises:
            NavigationError: If navigation fails after all fallback attempts
        """
        # Define fallback strategies in order of preference
        strategies = [
            ("domcontentloaded", page_timeout),
            ("load", int(page_timeout * 0.8)),  # Shorter timeout for load event
            ("commit", int(page_timeout * 0.6))  # Even shorter for commit
        ]

        last_error = None

        for strategy_index, (strategy, timeout) in enumerate(strategies):
            try:
                self.logger.debug(f"Attempting navigation to {url} with strategy {strategy} (timeout: {timeout}ms)")

                # Navigate to the URL
                response = await page.goto(
                    url,
                    wait_until=strategy,
                    timeout=timeout
                )

                # Wait a bit after navigation to ensure content loads
                await asyncio.sleep(0.5)

                # Check if navigation was successful
                if not response:
                    raise Exception("Navigation resulted in null response")

                # Check response status
                status = response.status
                if status >= 400:
                    raise Exception(f"Navigation failed with status {status}")

                # Success! Log and return
                if strategy_index > 0:
                    self.logger.info(f"Navigation succeeded with fallback strategy {strategy} for {url}")

                return response

            except PlaywrightTimeoutError as e:
                last_error = e
                self._timeout_stats["navigation"] += 1

                self.logger.warning(f"Navigation timeout with strategy {strategy} for {url}", {
                    "url": url,
                    "timeout": timeout,
                    "wait_until": strategy,
                    "strategy_index": strategy_index,
                    "error": str(e)
                })

                # If this isn't the last strategy, continue to next one
                if strategy_index < len(strategies) - 1:
                    continue

                # This was the last strategy, try to get partial content
                try:
                    content = await page.content()
                    if len(content) > 100:  # If we have some meaningful content
                        self.logger.info(f"Got partial content despite all timeouts for {url}")
                        return None  # Return None to indicate partial success
                except Exception as content_error:
                    self.logger.debug(f"Failed to get content after all timeouts: {str(content_error)}")

            except Exception as e:
                last_error = e
                self.logger.warning(f"Navigation failed with strategy {strategy} for {url}: {str(e)}")

                # If this isn't the last strategy, continue to next one
                if strategy_index < len(strategies) - 1:
                    continue

                # This was the last strategy, break out
                break

        # All strategies failed, raise error
        from app.core.errors import NavigationError
        nav_context = {
            "url": url,
            "strategies_attempted": len(strategies),
            "final_wait_until": wait_until,
            "final_timeout": page_timeout
        }
        raise NavigationError(url=url, context=nav_context, original_exception=last_error)

    async def _create_context_and_page(self, url: str, width: int, height: int) -> Tuple[BrowserContext, int, Page]:
        """Create a browser context and page with timeout protection and fallback strategies.

        Args:
            url: The URL to capture
            width: The viewport width
            height: The viewport height

        Returns:
            A tuple of (context, browser_index, page)

        Raises:
            BrowserTimeoutError: If a timeout occurs during context or page creation
        """
        self.logger.debug(f"Attempting to get browser context for {url}")

        # Try multiple timeout strategies for better reliability
        timeout_strategies = [
            ("normal", settings.browser_context_timeout, settings.page_creation_timeout),
            ("extended", int(settings.browser_context_timeout * 1.5), int(settings.page_creation_timeout * 1.5)),
            ("minimal", int(settings.browser_context_timeout * 0.7), int(settings.page_creation_timeout * 0.7))
        ]

        last_error = None

        for strategy_name, context_timeout, page_timeout in timeout_strategies:
            try:
                self.logger.debug(f"Trying {strategy_name} timeout strategy for {url}", {
                    "context_timeout": context_timeout,
                    "page_timeout": page_timeout
                })

                # Get context with timeout protection
                context, browser_index = await asyncio.wait_for(
                    self._get_context(width=width, height=height),
                    timeout=context_timeout / 1000.0  # Convert to seconds
                )

                if context is None or browser_index is None:
                    raise Exception("Failed to get browser context from pool")

                self.logger.debug(f"Got browser context {browser_index} for {url}")

                # Create page with timeout protection
                page = await asyncio.wait_for(
                    context.new_page(),
                    timeout=page_timeout / 1000.0  # Convert to seconds
                )
                self.logger.debug(f"Created new page for {url} using browser {browser_index}")

                # Track the page resource
                await self._track_resource("page", page)

                # Success! Log if we used a fallback strategy
                if strategy_name != "normal":
                    self.logger.info(f"Context creation succeeded with {strategy_name} strategy for {url}")

                return context, browser_index, page

            except asyncio.TimeoutError as e:
                last_error = e
                self.logger.warning(f"Timeout with {strategy_name} strategy for {url}", {
                    "strategy": strategy_name,
                    "context_timeout": context_timeout,
                    "page_timeout": page_timeout
                })

                # Clean up partial resources
                if 'context' in locals() and 'browser_index' in locals() and context and browser_index is not None:
                    self.logger.debug(f"Releasing browser {browser_index} after timeout")
                    try:
                        await self._return_context(context, browser_index, is_healthy=False)
                    except Exception as cleanup_error:
                        self.logger.error(f"Error during cleanup: {str(cleanup_error)}")

                # Continue to next strategy
                continue

            except Exception as e:
                last_error = e
                self.logger.warning(f"Error with {strategy_name} strategy for {url}: {str(e)}")

                # Clean up partial resources
                if 'context' in locals() and 'browser_index' in locals() and context and browser_index is not None:
                    try:
                        await self._return_context(context, browser_index, is_healthy=False)
                    except Exception as cleanup_error:
                        self.logger.error(f"Error during cleanup: {str(cleanup_error)}")

                # Continue to next strategy
                continue

        # All strategies failed - get detailed diagnostics
        pool_stats = self._browser_pool.get_stats()
        self.logger.error(f"All context creation strategies failed for {url}", {
            "url": url,
            "last_error": str(last_error),
            "last_error_type": type(last_error).__name__ if last_error else None,
            "strategies_attempted": len(timeout_strategies),
            "browser_pool_stats": pool_stats,
            "browser_pool_size": pool_stats.get("size", 0),
            "browser_pool_in_use": pool_stats.get("in_use", 0),
            "browser_pool_available": pool_stats.get("available", 0),
            "browser_pool_errors": pool_stats.get("errors", 0)
        })

        # Try one last emergency strategy with minimal requirements
        try:
            self.logger.warning(f"Attempting emergency context creation for {url}")

            # Get a browser directly without timeout strategies
            browser, browser_index = await self._browser_pool.get_browser()
            if browser and browser_index is not None:
                # Try to create context with very basic settings
                context = await asyncio.wait_for(
                    browser.new_context(
                        viewport={"width": width, "height": height},
                        ignore_https_errors=True
                    ),
                    timeout=5.0  # Very short timeout
                )

                if context:
                    # Try to create page with minimal timeout
                    page = await asyncio.wait_for(
                        context.new_page(),
                        timeout=3.0
                    )

                    if page:
                        self.logger.info(f"Emergency context creation succeeded for {url}")
                        await self._track_resource("page", page)
                        return context, browser_index, page

        except Exception as emergency_error:
            self.logger.error(f"Emergency context creation also failed for {url}: {str(emergency_error)}")

        # Re-raise as a custom error for better retry handling
        from app.core.errors import BrowserTimeoutError
        raise BrowserTimeoutError(f"Failed to create browser context after trying all strategies including emergency fallback: {str(last_error)}")

    async def _capture_screenshot_impl(self, url: str, width: int, height: int, format: str, filepath: str, start_time: float) -> str:
        """Implementation of screenshot capture.

        Args:
            url: The URL to capture
            width: The viewport width
            height: The viewport height
            format: The image format (png, jpeg, webp)
            filepath: Path to save the screenshot
            start_time: Time when the capture was started

        Returns:
            Path to the saved screenshot file
        """
        # Local variables for cleanup in finally block
        context = None
        browser_index = None
        page = None

        try:
            # Get navigation strategy
            wait_until, page_timeout = await self._get_navigation_strategy()

            # Check browser pool health before attempting context creation
            pool_stats = self._browser_pool.get_stats()
            if pool_stats.get("available", 0) == 0 and pool_stats.get("size", 0) >= pool_stats.get("max_size", 0):
                self.logger.warning(f"Browser pool exhausted for {url}", {
                    "pool_stats": pool_stats,
                    "url": url
                })

                # Try to force cleanup of unhealthy browsers
                try:
                    await self._browser_pool._cleanup_unhealthy_browsers()
                    self.logger.info("Attempted cleanup of unhealthy browsers")
                except Exception as cleanup_error:
                    self.logger.warning(f"Failed to cleanup unhealthy browsers: {str(cleanup_error)}")

            # Create a retry manager for context creation with more retries for stability
            retry_manager = await self._create_retry_manager(False, "context_creation")
            # Use more retries for context creation since it's critical
            retry_manager.retry_config.max_retries = 5  # Increase for better reliability

            # Get context with retry logic
            async def get_context_with_page():
                nonlocal context, browser_index, page
                context, browser_index, page = await self._create_context_and_page(url, width, height)
                return page

            # Execute with retry
            page = await retry_manager.execute(get_context_with_page, operation_name="get_context_with_page")

            # Set viewport size
            await page.set_viewport_size({"width": width, "height": height})

            # Configure page and navigate to URL
            await self._configure_page_for_site(page)

            # Create a retry manager for navigation with reduced retries
            navigation_retry_manager = await self._create_retry_manager(False, "navigation")
            navigation_retry_manager.circuit_breaker = self._navigation_circuit_breaker
            # Override retry config for faster failure detection
            navigation_retry_manager.retry_config.max_retries = 1  # Only 1 retry for navigation

            # Use more aggressive timeout strategy for faster failure detection
            pool_stats = self._browser_pool.get_stats()
            pool_load = pool_stats["in_use"] / max(pool_stats["size"], 1)  # Avoid division by zero

            # Reduce timeout significantly for faster failure detection
            adaptive_timeout = int(page_timeout * 0.6)  # Always use 60% of original timeout

            # Further reduce timeout under high load
            if pool_load > 0.7:  # High load (>70% of pool in use)
                # Additional reduction up to 50% based on load
                additional_reduction = min(0.5, (pool_load - 0.7) * 1.67)  # Scale between 0-50%
                adaptive_timeout = int(adaptive_timeout * (1 - additional_reduction))

            self.logger.debug(
                f"Using adaptive timeout for {url}",
                {"original_timeout": page_timeout, "adaptive_timeout": adaptive_timeout, "pool_load": pool_load}
            )

            # Navigate to URL with retry logic
            await navigation_retry_manager.execute(
                lambda: self._navigate_to_url(page, url, wait_until, adaptive_timeout),
                operation_name="navigate_to_url"
            )

            # Capture the screenshot with retry logic
            filepath = await self._capture_screenshot_with_retry(page, filepath, format)

            # Log successful screenshot capture
            capture_time = time.time() - start_time
            self.logger.info(f"Screenshot captured for {url}", {
                "url": url,
                "filepath": filepath,
                "capture_time": capture_time,
                "width": width,
                "height": height,
                "format": format
            })

            return filepath
        except Exception as e:
            # Check for common errors that don't need full traceback
            from app.core.errors import CircuitBreakerOpenError, MaxRetriesExceededError

            elapsed_time = time.time() - start_time

            if isinstance(e, CircuitBreakerOpenError):
                # For circuit breaker errors, use a more concise log without traceback
                self.logger.error(f"Circuit breaker open for {url}: {str(e)}", {
                    "url": url,
                    "error": str(e),
                    "error_type": "CircuitBreakerOpenError",
                    "elapsed_time": elapsed_time
                })
            elif isinstance(e, MaxRetriesExceededError):
                # For max retries exceeded, provide helpful troubleshooting info
                self.logger.error(f"Screenshot capture failed after all retries for {url}", {
                    "url": url,
                    "error": str(e),
                    "error_type": "MaxRetriesExceededError",
                    "elapsed_time": elapsed_time,
                    "retry_config": {
                        "max_retries": settings.screenshot_max_retries,
                        "base_delay": settings.screenshot_base_delay,
                        "max_delay": settings.screenshot_max_delay
                    },
                    "troubleshooting_tips": [
                        "Check if the URL is accessible",
                        "Verify browser pool health",
                        "Consider increasing SCREENSHOT_MAX_RETRIES environment variable",
                        "Check system resources (memory, CPU)",
                        "Review browser timeout settings"
                    ]
                })
            else:
                # For other errors, log with full traceback
                self.logger.exception(f"Error capturing screenshot for {url}", {
                    "url": url,
                    "error": str(e),
                    "error_type": type(e).__name__,
                    "elapsed_time": elapsed_time
                })

            # Re-raise with our custom error class
            from app.core.errors import ScreenshotError
            error_context = {
                "url": url,
                "width": width,
                "height": height,
                "format": format,
                "elapsed_time": elapsed_time,
                "retry_config": {
                    "max_retries": settings.screenshot_max_retries,
                    "base_delay": settings.screenshot_base_delay,
                    "max_delay": settings.screenshot_max_delay
                }
            }
            raise ScreenshotError(url=url, context=error_context, original_exception=e)
        finally:
            # Clean up resources
            if page and not page.is_closed():
                try:
                    await asyncio.wait_for(page.close(), timeout=5.0)
                    await self._untrack_resource("page", page)
                    self.logger.debug(f"Successfully closed page for {url}")
                except Exception as e:
                    self.logger.warning(f"Error closing page: {str(e)}", {
                        "url": url,
                        "error": str(e),
                        "error_type": type(e).__name__
                    })

            # Return context to the pool if it was obtained
            if context and browser_index is not None:
                try:
                    await self._return_context(context, browser_index)
                    self.logger.debug(f"Successfully returned context {browser_index} for {url}")
                except Exception as e:
                    self.logger.warning(f"Error returning context: {str(e)}", {
                        "url": url,
                        "browser_index": browser_index,
                        "error": str(e),
                        "error_type": type(e).__name__
                    })

    async def _cleanup_temp_files(self) -> int:
        """Clean up old temporary files.

        Returns:
            Number of files removed
        """
        # Get the screenshot directory from settings
        screenshot_dir = settings.screenshot_dir

        # Ensure the directory exists
        if not os.path.exists(screenshot_dir):
            return 0

        # Get current time
        now = time.time()

        # Maximum age of files to keep (in seconds)
        max_age = settings.temp_file_max_age or 3600  # 1 hour default

        # Count of removed files
        removed_count = 0

        # Iterate through files in the directory
        for filename in os.listdir(screenshot_dir):
            filepath = os.path.join(screenshot_dir, filename)

            # Skip directories
            if os.path.isdir(filepath):
                continue

            # Check if file is a temporary screenshot
            if not filename.startswith('screenshot_'):
                continue

            try:
                # Get file modification time
                file_mtime = os.path.getmtime(filepath)

                # Remove file if it's older than max_age
                if now - file_mtime > max_age:
                    os.unlink(filepath)
                    removed_count += 1
            except Exception as e:
                self.logger.warning(f"Error removing temp file {filepath}: {str(e)}", {
                    "filepath": filepath,
                    "error": str(e),
                    "error_type": type(e).__name__
                })

        return removed_count

    async def _start_cleanup_task(self):
        """Start the scheduled cleanup task."""
        self._cleanup_task = asyncio.create_task(self._scheduled_cleanup_loop())
        self._cleanup_task.add_done_callback(self._handle_cleanup_task_done)
    async def _handle_cleanup_task_done(self, task):
        """Handle completion of the cleanup task."""
        try:
            # Check if the task raised an exception
            if task.cancelled():
                self.logger.warning("Cleanup task was cancelled")
            elif task.exception():
                exception = task.exception()
                self.logger.error(f"Cleanup task failed with error: {str(exception)}", {
                    "error": str(exception),
                    "error_type": type(exception).__name__
                })
            else:
                self.logger.debug("Cleanup task completed successfully")
        except asyncio.CancelledError:
            self.logger.warning("Cleanup task was cancelled while checking its status")
        except Exception as e:
            self.logger.error(f"Error handling cleanup task completion: {str(e)}", {
                "error": str(e),
                "error_type": type(e).__name__
            })
    async def _scheduled_cleanup_loop(self):
        """Scheduled cleanup loop that runs periodically."""
        self.logger.info("Starting scheduled cleanup loop")

        try:
            while True:
                # Perform cleanup operations
                try:
                    # Clean up temporary files
                    files_removed = await self._cleanup_temp_files()

                    # Clean up tracked resources
                    resources_cleaned = await self._cleanup_resources()

                    # Log cleanup results
                    self.logger.info("Scheduled cleanup completed", {
                        "temp_files_removed": files_removed,
                        "resources_cleaned": resources_cleaned
                    })
                except Exception as e:
                    self.logger.error(f"Error in scheduled cleanup: {str(e)}", {
                        "error": str(e),
                        "error_type": type(e).__name__
                    })

                # Wait for next cleanup interval
                await asyncio.sleep(self._cleanup_interval)
        except asyncio.CancelledError:
            self.logger.info("Scheduled cleanup loop cancelled")
            raise
    async def _cleanup_resources(self) -> Dict[str, int]:
        """Clean up tracked resources that may have been leaked.

        Returns:
            Dictionary with counts of cleaned up resources
        """
        cleanup_stats = {
            "contexts": 0,
            "pages": 0
        }

        # Clean up tracked pages
        async with self._resource_lock:
            pages_to_close = list(self._active_resources["pages"])

        for page in pages_to_close:
            try:
                if not page.is_closed():
                    await asyncio.wait_for(page.close(), timeout=3.0)
                    cleanup_stats["pages"] += 1

                async with self._resource_lock:
                    self._active_resources["pages"].discard(page)
            except Exception as e:
                self.logger.warning(f"Error closing page during cleanup: {str(e)}", {
                    "error": str(e),
                    "error_type": type(e).__name__
                })

        # Clean up tracked contexts
        async with self._resource_lock:
            contexts_to_close = list(self._active_resources["contexts"])

        for browser_index, context in contexts_to_close:
            try:
                await asyncio.wait_for(
                    self._return_context(context, browser_index, is_healthy=False),
                    timeout=5.0
                )
                cleanup_stats["contexts"] += 1
            except Exception as e:
                self.logger.warning(f"Error returning context during cleanup: {str(e)}", {
                    "browser_index": browser_index,
                    "error": str(e),
                    "error_type": type(e).__name__
                })

        # Log cleanup results if any resources were cleaned up
        if cleanup_stats["contexts"] > 0 or cleanup_stats["pages"] > 0:
            self.logger.info(f"Cleaned up {cleanup_stats['contexts']} contexts and {cleanup_stats['pages']} pages")

        return cleanup_stats

    async def _track_resource(self, resource_type: str, resource):
        """Track a resource for automatic cleanup.

        Args:
            resource_type: The type of resource (page or context)
            resource: The resource to track
        """
        async with self._resource_lock:
            if resource_type == "page":
                self._active_resources["pages"].add(resource)
            elif resource_type == "context":
                browser_index, context = resource
                self._active_resources["contexts"].add((browser_index, context))

    async def _untrack_resource(self, resource_type: str, resource):
        """Remove a resource from tracking.

        Args:
            resource_type: The type of resource (page or context)
            resource: The resource to untrack
        """
        async with self._resource_lock:
            if resource_type == "page":
                self._active_resources["pages"].discard(resource)
            elif resource_type == "context":
                browser_index, context = resource
                self._active_resources["contexts"].discard((browser_index, context))

    async def cleanup(self):
        """Clean up resources.

        This method should be called when shutting down the service to ensure
        all resources are properly released.
        """
        self.logger.info("Cleaning up screenshot service resources")

        # Cancel the cleanup task if it's running
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass

        # Clean up tracked resources
        await self._cleanup_resources()

        # Shutdown the browser pool
        start_time = time.time()
        await self._browser_pool.shutdown()
        browser_pool_shutdown_time = time.time() - start_time

        # Clean up temporary files
        temp_files_start = time.time()
        files_removed = await self._cleanup_temp_files()
        temp_files_cleanup_time = time.time() - temp_files_start

        self.logger.info("Screenshot service resources cleaned up", {
            "browser_pool_shutdown_time": browser_pool_shutdown_time,
            "temp_files_cleanup_time": temp_files_cleanup_time,
            "temp_files_removed": files_removed
        })

    async def _cleanup_temp_files(self) -> int:
        """Clean up temporary screenshot files that are older than the retention period.

        Returns:
            Number of files removed
        """
        temp_dir = settings.screenshot_dir
        if not temp_dir or not os.path.exists(temp_dir):
            return 0

        now = time.time()
        retention_seconds = settings.temp_file_retention_hours * 3600
        removed_count = 0

        try:
            # Get all files in the temp directory
            for filename in os.listdir(temp_dir):
                filepath = os.path.join(temp_dir, filename)

                # Skip directories
                if not os.path.isfile(filepath):
                    continue

                # Check if file is older than retention period
                file_mod_time = os.path.getmtime(filepath)
                age_seconds = now - file_mod_time

                if age_seconds > retention_seconds:
                    try:
                        os.remove(filepath)
                        removed_count += 1
                    except Exception as e:
                        self.logger.warning(f"Failed to remove temp file {filepath}: {str(e)}", {
                            "filepath": filepath,
                            "error": str(e),
                            "error_type": type(e).__name__
                        })
        except Exception as e:
            self.logger.error(f"Error during temp file cleanup: {str(e)}", {
                "error": str(e),
                "error_type": type(e).__name__,
                "temp_dir": self._temp_dir
            })

        return removed_count

    def _cleanup_temp_files_sync(self) -> int:
        """Synchronous version of cleanup_temp_files for backward compatibility.

        This method is deprecated and will be removed in a future version.
        Use the async version with asyncio.run() if needed in a sync context.

        Returns:
            Number of files removed
        """
        self.logger.warning("Using deprecated synchronous _cleanup_temp_files_sync method")

        files_removed = 0
        try:
            # Create an event loop if one doesn't exist
            try:
                loop = asyncio.get_event_loop()
            except RuntimeError:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)

            # Run the async version in the event loop
            if loop.is_running():
                self.logger.warning("Cannot run async _cleanup_temp_files in a running event loop synchronously")
                return 0
            else:
                return loop.run_until_complete(self._cleanup_temp_files())
        except Exception as e:
            self.logger.error(f"Error cleaning up temporary files: {str(e)}", {
                "error": str(e),
                "error_type": type(e).__name__,
                "directory": settings.screenshot_dir
            })
            return files_removed

    def _start_cleanup_task(self):
        """Start the scheduled cleanup task."""
        if self._cleanup_task is None or self._cleanup_task.done():
            self.logger.info(f"Starting scheduled cleanup task with interval {self._cleanup_interval} seconds")
            self._cleanup_task = asyncio.create_task(self._scheduled_cleanup_loop())
            # Add error handling for the cleanup task
            self._cleanup_task.add_done_callback(self._handle_cleanup_task_done)

    def _start_cache_cleanup_task(self):
        """Start the browser cache cleanup task."""
        if not hasattr(self, '_cache_cleanup_task') or self._cache_cleanup_task is None or self._cache_cleanup_task.done():
            cache_interval = settings.browser_cache_cleanup_interval
            self.logger.info(f"Starting browser cache cleanup task with interval {cache_interval} seconds")
            self._cache_cleanup_task = asyncio.create_task(self._cache_cleanup_loop())
            self._cache_cleanup_task.add_done_callback(self._handle_cache_cleanup_task_done)

    def _handle_cache_cleanup_task_done(self, task):
        """Handle completion of the cache cleanup task."""
        try:
            exception = task.exception()
            if exception:
                self.logger.error(f"Cache cleanup task failed: {str(exception)}", {
                    "error": str(exception),
                    "error_type": type(exception).__name__
                })
            else:
                self.logger.debug("Cache cleanup task completed successfully")
        except asyncio.CancelledError:
            self.logger.warning("Cache cleanup task was cancelled")
        except Exception as e:
            self.logger.error(f"Error handling cache cleanup task completion: {str(e)}")

    async def _cache_cleanup_loop(self):
        """Browser cache cleanup loop that runs periodically."""
        try:
            while True:
                try:
                    # Run cache cleanup
                    cleanup_result = await browser_cache_service.cleanup_cache()
                    if cleanup_result["removed"] > 0:
                        self.logger.info(f"Browser cache cleanup completed", {
                            "removed_items": cleanup_result["removed"],
                            "errors": cleanup_result["errors"]
                        })
                except Exception as e:
                    self.logger.error(f"Error during browser cache cleanup: {str(e)}")

                # Wait for next cleanup interval
                await asyncio.sleep(settings.browser_cache_cleanup_interval)
        except asyncio.CancelledError:
            self.logger.info("Browser cache cleanup task was cancelled")
        except Exception as e:
            self.logger.error(f"Unexpected error in cache cleanup loop: {str(e)}")

    def _handle_cleanup_task_done(self, task):
        """Handle completion of the cleanup task."""
        try:
            # Check if the task raised an exception
            exception = task.exception()
            if exception:
                self.logger.error(f"Cleanup task failed with error: {str(exception)}", {
                    "error": str(exception),
                    "error_type": type(exception).__name__
                })
            else:
                self.logger.debug("Cleanup task completed successfully")
        except asyncio.CancelledError:
            self.logger.warning("Cleanup task was cancelled while checking its status")
        except Exception as e:
            self.logger.error(f"Error handling cleanup task completion: {str(e)}", {
                "error": str(e),
                "error_type": type(e).__name__
            })

    async def _capture_screenshot_with_retry(self, page: Page, filepath: str, format: str) -> str:
        """Capture a screenshot with retry logic.

        Args:
            page: The page to capture
            filepath: Path where the screenshot should be saved
            format: Image format (png, jpeg, webp)

        Returns:
            Path to the saved screenshot file
        """
        # Define a function to capture the screenshot
        async def capture_screenshot():
            # Take the screenshot
            await page.screenshot(path=filepath, type=format, full_page=True)
            return filepath

        # Create a screenshot retry manager with configurable settings
        screenshot_retry_manager = RetryManager(
            retry_config=RetryConfig(
                max_retries=settings.screenshot_max_retries,
                base_delay=settings.screenshot_base_delay,
                max_delay=settings.screenshot_max_delay,
                jitter=settings.screenshot_jitter
            ),
            circuit_breaker=self._browser_circuit_breaker,
            name="screenshot_capture"
        )

        # Take the screenshot with a slight delay to ensure content is ready
        await asyncio.sleep(0.5)

        # Check service health before attempting capture
        if not self._is_service_healthy():
            self.logger.warning("Service is unhealthy, attempting recovery before screenshot")
            await self._attempt_service_recovery()

        # Execute the screenshot capture with retry
        try:
            result = await screenshot_retry_manager.execute(capture_screenshot, operation_name="capture_screenshot")
            self._update_health_stats(success=True)
            return result
        except Exception as e:
            self._update_health_stats(success=False)
            raise

    async def _scheduled_cleanup_loop(self):
        """Scheduled cleanup loop that runs periodically."""
        self.logger.info("Starting scheduled cleanup loop")

        try:
            while True:
                # Perform cleanup operations
                try:
                    # Clean up temporary files
                    files_removed = await self._cleanup_temp_files()

                    # Clean up tracked resources
                    resources_cleaned = await self._cleanup_resources()

                    # Log cleanup results
                    self.logger.info("Scheduled cleanup completed", {
                        "temp_files_removed": files_removed,
                        "resources_cleaned": resources_cleaned
                    })
                except Exception as e:
                    self.logger.error(f"Error in scheduled cleanup: {str(e)}", {
                        "error": str(e),
                        "error_type": type(e).__name__
                    })

                # Wait for next cleanup interval
                await asyncio.sleep(self._cleanup_interval)
        except asyncio.CancelledError:
            # Task was cancelled, which is expected during shutdown
            self.logger.info("Cleanup task was cancelled")
        except Exception as e:
            # Unexpected error handling the task completion
            self.logger.error(f"Error handling cleanup task completion: {str(e)}", {
                "error": str(e),
                "error_type": type(e).__name__
            })

    async def _scheduled_cleanup_loop(self):
        """Scheduled cleanup loop that runs periodically."""
        try:
            while True:
                # Sleep for the cleanup interval
                await asyncio.sleep(self._cleanup_interval)

                # Perform cleanup operations
                try:
                    await self._cleanup_resources()
                    await self._cleanup_temp_files()
                except Exception as e:
                    self.logger.error(f"Error in scheduled cleanup: {str(e)}", {
                        "error": str(e),
                        "error_type": type(e).__name__
                    })
        except asyncio.CancelledError:
            # Task was cancelled, which is expected during shutdown
            self.logger.info("Scheduled cleanup loop was cancelled")
        except Exception as e:
            # Unexpected error in the cleanup loop
            self.logger.error(f"Unexpected error in cleanup loop: {str(e)}", {
                "error": str(e),
                "error_type": type(e).__name__
            })
            # Re-raise to trigger the done callback
            raise

    async def _cleanup_resources(self):
        """Clean up tracked resources that may have been leaked."""
        async with self._resource_lock:
            # Clean up tracked pages
            pages_closed = 0
            for page in list(self._active_resources["pages"]):
                try:
                    if not page.is_closed():
                        await asyncio.wait_for(page.close(), timeout=3.0)
                        pages_closed += 1
                except Exception as e:
                    self.logger.warning(f"Error closing tracked page: {str(e)}")
                self._active_resources["pages"].discard(page)

            # Clean up tracked contexts
            contexts_closed = 0
            for browser_index, context in list(self._active_resources["contexts"]):
                try:
                    await self._return_context(context, browser_index)
                    contexts_closed += 1
                except Exception as e:
                    self.logger.warning(f"Error releasing tracked context: {str(e)}")
                self._active_resources["contexts"].discard((browser_index, context))

            if pages_closed > 0 or contexts_closed > 0:
                self.logger.info(f"Cleaned up tracked resources", {
                    "pages_closed": pages_closed,
                    "contexts_closed": contexts_closed
                })

    async def _track_resource(self, resource_type: str, resource):
        """Track a resource for automatic cleanup."""
        async with self._resource_lock:
            if resource_type == "page":
                self._active_resources["pages"].add(resource)
            elif resource_type == "context":
                browser_index, context = resource
                self._active_resources["contexts"].add((browser_index, context))

    async def _untrack_resource(self, resource_type: str, resource):
        """Remove a resource from tracking."""
        async with self._resource_lock:
            if resource_type == "page":
                self._active_resources["pages"].discard(resource)
            elif resource_type == "context":
                browser_index, context = resource
                self._active_resources["contexts"].discard((browser_index, context))

    async def cleanup(self):
        """Clean up resources."""
        self.logger.info("Cleaning up screenshot service resources")

        # Cancel the cleanup task if it's running
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass

        # Cancel the cache cleanup task if it's running
        if hasattr(self, '_cache_cleanup_task') and self._cache_cleanup_task and not self._cache_cleanup_task.done():
            self._cache_cleanup_task.cancel()
            try:
                await self._cache_cleanup_task
            except asyncio.CancelledError:
                pass

        # Clean up tracked resources
        await self._cleanup_resources()

        # Shutdown the browser pool
        start_time = time.time()
        await self._browser_pool.shutdown()
        browser_pool_shutdown_time = time.time() - start_time

        # Clean up temporary files
        temp_files_start = time.time()
        files_removed = await self._cleanup_temp_files()
        temp_files_cleanup_time = time.time() - temp_files_start

        self.logger.info("Screenshot service resources cleaned up", {
            "browser_pool_shutdown_time": browser_pool_shutdown_time,
            "temp_files_cleanup_time": temp_files_cleanup_time,
            "temp_files_removed": files_removed
        })

    def get_pool_stats(self):
        """Get browser pool statistics."""
        return self._browser_pool.get_stats()

    def get_retry_stats(self) -> Dict[str, Any]:
        """Get retry statistics.

        Returns:
            Dictionary with retry statistics
        """
        return {
            "browser_retry": self._browser_retry_manager.get_stats(),
            "circuit_breakers": {
                "browser": self._browser_circuit_breaker.get_state(),
                "navigation": self._navigation_circuit_breaker.get_state()
            }
        }

    async def reset_circuit_breakers(self):
        """Reset all circuit breakers to closed state.

        This is particularly useful for tests to ensure isolation between test cases.
        """
        self.logger.info("Resetting all circuit breakers to closed state")

        # Create new circuit breakers with the same configuration
        self._browser_circuit_breaker = CircuitBreaker(
            threshold=settings.circuit_breaker_threshold,
            reset_time=settings.circuit_breaker_reset_time,
            name="browser"
        )

        self._navigation_circuit_breaker = CircuitBreaker(
            threshold=settings.circuit_breaker_threshold,
            reset_time=settings.circuit_breaker_reset_time,
            name="navigation"
        )

        # Update the retry manager with the new circuit breaker
        self._browser_retry_manager.circuit_breaker = self._browser_circuit_breaker


# Helper function for batch processing
async def capture_screenshot_with_options(url: str, width: int = 1280, height: int = 720, format: str = "png") -> Dict[str, Any]:
    """Capture a screenshot with the given options and return the result as a dictionary.

    This is a helper function used by the batch processing service.

    Args:
        url: The URL to capture
        width: The viewport width
        height: The viewport height
        format: The image format (png, jpeg, webp)

    Returns:
        Dictionary with the URL to the processed image
    """
    from app.services.storage import storage_service
    from app.services.imgproxy import imgproxy_service
    from app.utils.url_transformer import transform_url
    from app.core.logging import get_logger

    logger = get_logger("screenshot_batch")

    # Transform URL if needed (viding.co -> viding-co_website-revamp, etc.)
    original_url = url
    transformed_url = transform_url(url)

    # Log URL transformation if it occurred
    if transformed_url != original_url:
        logger.info(f"URL transformed for batch screenshot: {original_url} -> {transformed_url}")

    # Capture the screenshot using the transformed URL
    filepath = await screenshot_service.capture_screenshot(transformed_url, width, height, format)

    try:
        # Upload to R2
        r2_key = await storage_service.upload_file(filepath)

        # Generate imgproxy URL
        # Ensure width and height are integers before passing to generate_url
        img_width = int(width) if not isinstance(width, int) else width
        img_height = int(height) if not isinstance(height, int) else height

        imgproxy_url = imgproxy_service.generate_url(
            r2_key,
            width=img_width,
            height=img_height,
            format=format
        )

        return {"url": imgproxy_url}
    finally:
        # Clean up the temporary file
        if os.path.exists(filepath):
            os.unlink(filepath)


# Create a singleton instance
screenshot_service = ScreenshotService()
