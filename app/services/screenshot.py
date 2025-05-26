import asyncio
import os
import re
import time
import uuid
from typing import Dict, List, Optional, Tuple, Any, AsyncGenerator, ContextManager

from app.core.logging import get_logger

from playwright.async_api import async_playwright, Browser, BrowserContext, Page, TimeoutError as PlaywrightTimeoutError

from app.core.config import settings
from app.services.browser_pool import BrowserPool
from app.services.retry import RetryConfig, CircuitBreaker, RetryManager
from app.services.throttle import screenshot_throttle


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
        
        # Complex site patterns that need special handling
        self._complex_sites = [
            r'linkedin\.com',
            r'youtube\.com',
            r'facebook\.com',
            r'twitter\.com',
            r'instagram\.com',
            r'snapchat\.com',
            r'tiktok\.com',
            r'viding\.co',
            r'harisenin\.com'
        ]
        
        # Sites where visual content is important and images should be loaded
        self._visual_content_sites = [
            r'viding\.co',
            r'harisenin\.com',
            r'instagram\.com',
            r'snapchat\.com',
            r'tiktok\.com'
        ]
        
        # Ensure screenshot directory exists
        os.makedirs(settings.screenshot_dir, exist_ok=True)

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

    def _is_complex_site(self, url: str) -> bool:
        """Check if the URL is for a complex site that needs special handling."""
        return any(re.search(pattern, url, re.IGNORECASE) for pattern in self._complex_sites)
        
    def _is_visual_content_site(self, url: str) -> bool:
        """Check if the URL is for a site where visual content is important."""
        return any(re.search(pattern, url, re.IGNORECASE) for pattern in self._visual_content_sites)
    
    async def _get_navigation_strategy(self, url: str) -> Tuple[str, int]:
        """Determine the optimal navigation strategy for a URL.
        
        Returns:
            Tuple of (wait_until, timeout_ms)
        """
        if self._is_complex_site(url):
            # For complex sites, use a more patient strategy
            return "domcontentloaded", settings.navigation_timeout_complex  # Wait for DOM only
        else:
            # For regular sites, use the standard strategy
            return "networkidle", settings.navigation_timeout_regular  # Wait for network idle
    
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
            self._cleanup_temp_files()
            self._last_cleanup = current_time
            
        # Determine if this is a complex site that needs special handling
        is_complex = self._is_complex_site(url)
        
        # Get navigation strategy based on site complexity
        wait_until, page_timeout = await self._get_navigation_strategy(url)
            
        # Get a browser context
        context_dict: Dict[str, Any] = {}  # Initialize as empty dict instead of None
        browser_index = None
        page = None
        try:
            # Apply request throttling to prevent overwhelming the browser pool
            # This will queue the request if too many are already in progress
            try:
                # Execute the rest of the function with throttling
                return await screenshot_throttle.execute(
                    self._capture_screenshot_impl,
                    url=url,
                    width=width,
                    height=height,
                    format=format,
                    filepath=filepath,
                    start_time=start_time,
                    context_dict=context_dict
                )
            except asyncio.QueueFull:
                # If the throttle queue is full, raise a custom error
                from app.core.errors import SystemOverloadedError
                raise SystemOverloadedError(
                    message="Too many concurrent screenshot requests",
                    context={
                        "url": url,
                        "throttle_stats": screenshot_throttle.get_stats(),
                        "browser_pool_stats": self._browser_pool.get_stats()
                    }
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
        """Create a retry manager based on site complexity.
        
        Args:
            is_complex: Whether the site is complex and needs special handling
            name: Name for the retry manager
            
        Returns:
            A configured RetryManager instance
        """
        # Select retry configuration based on site complexity
        retry_config = self._retry_config_complex if is_complex else self._retry_config_regular
        
        # Create a retry manager for this operation
        return RetryManager(
            retry_config=retry_config,
            circuit_breaker=None,  # No circuit breaker for context creation
            name=name
        )
    
    async def _configure_page_for_site(self, page: Page, url: str, is_complex: bool) -> None:
        """Configure page settings based on site complexity.
        
        Args:
            page: The page to configure
            url: The URL to capture
            is_complex: Whether the site is complex and needs special handling
        """
        # Check if this is a site where visual content is important
        is_visual_site = self._is_visual_content_site(url)
        
        # Configure page based on site complexity and visual content importance
        if not is_complex and not is_visual_site:
            # For regular sites without important visual content, block unnecessary resources
            await page.route('**/*.{png,jpg,jpeg,gif,webp,svg}', lambda route: route.abort())
            await page.route('**/*.{woff,woff2,ttf,otf,eot}', lambda route: route.abort())
            await page.route('**/*.{mp3,mp4,ogg,webm,wav}', lambda route: route.abort())
        elif is_visual_site:
            # For sites with important visual content, only block audio/video but allow images
            await page.route('**/*.{mp3,mp4,ogg,webm,wav}', lambda route: route.abort())
            # Allow fonts for better rendering
            await page.route('**/*.{woff,woff2,ttf,otf,eot}', lambda route: route.continue_())
        else:
            # For complex sites, only block media files to ensure proper rendering
            await page.route('**/*.{mp3,mp4,ogg,webm,wav}', lambda route: route.abort())
            
            # Set extra headers for complex sites to appear more like a real browser
            await page.set_extra_http_headers({
                'Accept-Language': 'en-US,en;q=0.9',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Sec-Fetch-Site': 'none',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-User': '?1',
                'Sec-Fetch-Dest': 'document',
            })
    
    async def _navigate_to_url(self, page: Page, url: str, wait_until: str, page_timeout: int, is_complex: bool) -> Any:
        """Navigate to a URL with proper error handling.
        
        Args:
            page: The page to navigate with
            url: The URL to navigate to
            wait_until: The wait_until strategy for navigation
            page_timeout: The timeout for navigation in milliseconds
            is_complex: Whether the site is complex and needs special handling
            
        Returns:
            The navigation response or None for partial success
            
        Raises:
            NavigationError: If navigation fails
        """
        try:
            # Navigate to the URL
            response = await page.goto(
                url, 
                wait_until=wait_until,
                timeout=page_timeout
            )
            
            if is_complex:
                # For complex sites, wait a bit more after navigation to ensure content loads
                await asyncio.sleep(2)
                
                # Scroll down slightly to trigger lazy loading content if needed
                await page.evaluate("window.scrollBy(0, 250)")
                
                # Wait a bit more for lazy loaded content
                await asyncio.sleep(1)
            
            # Check if navigation was successful
            if not response:
                raise Exception("Navigation resulted in null response")
                
            # Check response status
            status = response.status
            if status >= 400:
                raise Exception(f"Navigation failed with status {status}")
                
            return response
            
        except PlaywrightTimeoutError as e:
            # Increment timeout counter
            self._timeout_stats["navigation"] += 1
            
            # Log the timeout with context
            self.logger.warning(f"Navigation timeout for {url}", {
                "url": url,
                "timeout": page_timeout,
                "wait_until": wait_until,
                "error": str(e)
            })
            
            # If the context is still valid, try to get the page content anyway
            # This can help in cases where the page loaded but some resources timed out
            try:
                content = await page.content()
                if len(content) > 100:  # If we have some meaningful content
                    self.logger.info(f"Got partial content despite timeout for {url}")
                    return None  # Return None to indicate partial success
            except Exception as content_error:
                self.logger.debug(f"Failed to get content after timeout: {str(content_error)}")
            
            # For complex sites, try with a simpler strategy before giving up
            if is_complex and "timeout" in str(e).lower():
                # Try with a simpler strategy
                if page and not page.is_closed():
                    try:
                        # Try with domcontentloaded and longer timeout
                        response = await page.goto(
                            url, 
                            wait_until="domcontentloaded",  # Simpler strategy
                            timeout=page_timeout * 1.5  # 50% longer timeout
                        )
                        await asyncio.sleep(3)  # Wait longer after load
                        return response
                    except Exception as inner_e:
                        # Log the fallback attempt failure
                        self.logger.warning(f"Fallback navigation strategy also failed for {url}", {
                            "url": url,
                            "error": str(inner_e),
                            "error_type": type(inner_e).__name__
                        })
            
            # If we get here, the simpler strategy failed or wasn't attempted
            # Use our custom error class for better error messages
            from app.core.errors import NavigationError
            nav_context = {
                "url": url,
                "wait_until": wait_until,
                "timeout": page_timeout,
                "is_complex_site": is_complex
            }
            raise NavigationError(url=url, context=nav_context, original_exception=e)
            
    async def _create_context_and_page(self, url: str, width: int, height: int) -> Tuple[BrowserContext, int, Page]:
        """Create a browser context and page with timeout protection.
        
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
        
        # Get context with timeout protection
        try:
            context, browser_index = await asyncio.wait_for(
                self._get_context(width=width, height=height),
                timeout=settings.browser_context_timeout
            )
            self.logger.debug(f"Got browser context {browser_index} for {url}")
            
            # Create page with timeout protection
            page = await asyncio.wait_for(
                context.new_page(),
                timeout=settings.page_creation_timeout
            )
            self.logger.debug(f"Created new page for {url} using browser {browser_index}")
            
            # Track the page resource
            await self._track_resource("page", page)
            
            return context, browser_index, page
            
        except asyncio.TimeoutError:
            self.logger.warning(f"Timeout getting browser context or creating page for {url}")
            
            # Clean up partial resources
            if 'context' in locals() and 'browser_index' in locals() and context and browser_index is not None:
                self.logger.debug(f"Releasing browser {browser_index} after timeout")
                await self._return_context(context, browser_index)
            
            # Re-raise as a custom error for better retry handling
            from app.core.errors import BrowserTimeoutError
            raise BrowserTimeoutError("Timeout getting browser context or creating page")
    
    async def _capture_screenshot_impl(self, url: str, width: int, height: int, format: str, filepath: str, start_time: float, context_dict: dict) -> str:
        """Implementation of screenshot capture with throttling applied.
        
        This is the actual implementation that gets executed by the throttle mechanism.
        
        Args:
            url: The URL to capture
            width: The viewport width
            height: The viewport height
            format: The image format (png, jpeg, webp)
            filepath: Path to save the screenshot
            start_time: Time when the capture was started
            context_dict: Dictionary for context sharing between retries
            
        Returns:
            Path to the saved screenshot file
        """
        # Local variables for cleanup in finally block
        context = None
        browser_index = None
        page = None
        
        try:
            # Determine if this is a complex site that needs special handling
            is_complex = self._is_complex_site(url)
            
            # Get navigation strategy based on site complexity
            wait_until, page_timeout = await self._get_navigation_strategy(url)
            
            # Create a retry manager for context creation
            retry_manager = await self._create_retry_manager(is_complex, "context_creation")
            
            # Get context with retry logic
            async def get_context_with_page():
                nonlocal context, browser_index, page
                context, browser_index, page = await self._create_context_and_page(url, width, height)
                return page
            
            # Execute with retry
            page = await retry_manager.execute(get_context_with_page)
            
            # Set viewport size
            await page.set_viewport_size({"width": width, "height": height})
            
            # Configure page and navigate to URL
            await self._configure_page_for_site(page, url, is_complex)
            
            # Create a retry manager for navigation
            navigation_retry_manager = await self._create_retry_manager(is_complex, "navigation")
            navigation_retry_manager.circuit_breaker = self._navigation_circuit_breaker
            
            # Navigate to URL with retry logic
            response = await navigation_retry_manager.execute(
                lambda: self._navigate_to_url(page, url, wait_until, page_timeout, is_complex)
            )
            
            # Capture the screenshot with retry logic
            filepath = await self._capture_screenshot_with_retry(page, filepath, format, is_complex)
            
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
            # Log the error with context
            self.logger.exception(f"Error capturing screenshot for {url}", {
                "url": url,
                "error": str(e),
                "error_type": type(e).__name__,
                "elapsed_time": time.time() - start_time
            })
            
            # Re-raise with our custom error class
            from app.core.errors import ScreenshotError
            error_context = {
                "url": url,
                "width": width,
                "height": height,
                "format": format,
                "elapsed_time": time.time() - start_time
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
            
    async def _capture_screenshot_with_retry(self, page: Page, filepath: str, format: str, is_complex: bool) -> str:
        """Capture a screenshot with retry logic.
        
        Args:
            page: The page to capture
            filepath: Path where the screenshot should be saved
            format: Image format (png, jpeg, webp)
            is_complex: Whether the site is complex and needs special handling
            
        Returns:
            Path to the saved screenshot file
        """
        # Define a function to capture the screenshot
        async def capture_screenshot():
            # Take the screenshot
            await page.screenshot(path=filepath, type=format, full_page=True)
            return filepath
            
        # Create a screenshot retry manager
        screenshot_retry_manager = RetryManager(
            retry_config=RetryConfig(
                max_retries=2,  # Fewer retries for screenshot capture
                base_delay=0.5,
                max_delay=2.0,
                jitter=0.1
            ),
            name="screenshot_capture"
        )
        
        # Take the screenshot with a slight delay for complex sites
        if is_complex:
            await asyncio.sleep(1)  # Extra wait for complex sites
        
        # Execute the screenshot capture with retry
        return await screenshot_retry_manager.execute(capture_screenshot)

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
                    self._cleanup_temp_files()
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
            },
            "throttle": {
                "screenshot": screenshot_throttle.get_stats()
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
    
    # Capture the screenshot
    filepath = await screenshot_service.capture_screenshot(url, width, height, format)
    
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
