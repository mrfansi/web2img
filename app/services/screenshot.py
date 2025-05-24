import asyncio
import os
import re
import time
import uuid
from typing import Dict, List, Optional, Tuple, Any

from app.core.logging import get_logger

from playwright.async_api import async_playwright, Browser, BrowserContext, Page, TimeoutError as PlaywrightTimeoutError

from app.core.config import settings
from app.services.browser_pool import BrowserPool
from app.services.retry import RetryConfig, CircuitBreaker, RetryManager


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
        """Initialize the browser pool."""
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
            }
        })
        await self._browser_pool.initialize()
        self.logger.info("Screenshot service initialized successfully")

    async def _get_context(self, width: int = 1280, height: int = 720):
        """Get a browser context from the pool."""
        # Get a browser from the pool
        browser, browser_index = await self._browser_pool.get_browser()
        
        if browser is None or browser_index is None:
            # If we couldn't get a browser, raise an error
            # Note: This should not normally happen as BrowserPool.get_browser now raises BrowserPoolExhaustedError
            # But we keep this as a fallback
            from app.core.errors import BrowserPoolExhaustedError
            raise BrowserPoolExhaustedError(context={
                "width": width,
                "height": height
            })
        
        # Create a context for this browser
        context = await self._browser_pool.create_context(
            browser_index,
            viewport={'width': width, 'height': height},
            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            java_script_enabled=True,
            ignore_https_errors=True,
            bypass_csp=True  # Bypass Content-Security-Policy
        )
        
        if context is None:
            # If context creation failed, release the browser and raise an error
            await self._browser_pool.release_browser(browser_index, is_healthy=False)
            from app.core.errors import BrowserError
            raise BrowserError(
                message="Failed to create browser context",
                context={
                    "browser_index": browser_index,
                    "width": width,
                    "height": height
                }
            )
        
        return context, browser_index
        
    async def _return_context(self, context: BrowserContext, browser_index: int):
        """Release a browser context."""
        # Release the context back to the browser pool
        await self._browser_pool.release_context(browser_index, context)
        
        # Release the browser back to the pool
        await self._browser_pool.release_browser(browser_index)

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
        
        self.logger.info(f"Starting screenshot capture for {url}", context)
        
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
        context = None
        browser_index = None
        page = None
        try:
            # Select retry configuration based on site complexity
            retry_config = self._retry_config_complex if is_complex else self._retry_config_regular
            
            # Create a retry manager for this operation
            retry_manager = RetryManager(
                retry_config=retry_config,
                circuit_breaker=None,  # No circuit breaker for context creation
                name="context_creation"
            )
            
            # Get context with retry logic
            async def get_context_with_page():
                nonlocal context, browser_index, page
                context, browser_index = await self._get_context(width=width, height=height)
                page = await context.new_page()
                return page
            
            # Execute with retry
            page = await retry_manager.execute(get_context_with_page)
            
            # Set viewport size
            await page.set_viewport_size({"width": width, "height": height})
            
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
            
            # Create a retry manager for navigation
            navigation_retry_manager = RetryManager(
                retry_config=retry_config,
                circuit_breaker=self._navigation_circuit_breaker,
                name="navigation"
            )
            
            # Define navigation function
            async def navigate_to_url():
                nonlocal page, context, browser_index
                
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
                        await asyncio.sleep(1)
                    
                    return response
                except PlaywrightTimeoutError as e:
                    # Increment timeout stats
                    self._timeout_stats["navigation"] += 1
                    
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
                except Exception as e:
                    # Check for closed context/browser issues
                    if "has been closed" in str(e):
                        # Browser context issue, recreate it
                        if context:
                            try:
                                await self._return_context(context, browser_index)
                            except Exception:
                                pass
                        context = None
                        browser_index = None
                        
                        # Get a new context and page
                        context, browser_index = await self._get_context(width=width, height=height)
                        page = await context.new_page()
                        
                        # Try navigation again
                        response = await page.goto(
                            url, 
                            wait_until=wait_until,
                            timeout=page_timeout
                        )
                        return response
                    
                    # Other errors are re-raised
                    raise
            
            # Execute navigation with retry
            response = await navigation_retry_manager.execute(navigate_to_url)
            
            # Take the screenshot with a slight delay for complex sites
            if is_complex:
                await asyncio.sleep(1)  # Extra wait for complex sites
            
            # Create a retry manager for screenshot capture
            screenshot_retry_manager = RetryManager(
                retry_config=RetryConfig(
                    max_retries=2,  # Fewer retries for screenshot capture
                    base_delay=0.5,
                    max_delay=2.0,
                    jitter=0.1
                ),
                name="screenshot_capture"
            )
            
            # Define screenshot function
            async def capture_screenshot():
                try:
                    await page.screenshot(
                        path=filepath, 
                        type=format, 
                        full_page=False,
                        quality=90 if format in ['jpeg', 'webp'] else None,
                        timeout=settings.screenshot_timeout
                    )
                    return filepath
                except PlaywrightTimeoutError:
                    self._timeout_stats["screenshot"] += 1
                    raise
            
            # Execute screenshot capture with retry
            await screenshot_retry_manager.execute(capture_screenshot)
            
            # Close the page to free resources
            if page and not page.is_closed():
                await page.close()
                page = None
            
            # Return the context to the pool for reuse
            if context and browser_index is not None:
                await self._return_context(context, browser_index)
                context = None  # Prevent double return in finally block
                browser_index = None  # Prevent double return in finally block
            
            # Log successful screenshot capture
            duration = time.time() - start_time
            self.logger.info(f"Screenshot captured successfully for {url}", {
                "url": url,
                "width": width,
                "height": height,
                "format": format,
                "filepath": filepath,
                "duration": duration,
                "is_complex_site": is_complex,
                "is_visual_site": is_visual_site,
                "navigation_strategy": wait_until,
                "timeout_used": page_timeout,
                "browser_index": browser_index if browser_index is not None else -1
            })
            
            return filepath
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
                "error_type": type(e).__name__,
                "is_complex_site": is_complex if 'is_complex' in locals() else None,
                "is_visual_site": is_visual_site if 'is_visual_site' in locals() else None,
                "browser_index": browser_index if 'browser_index' in locals() and browser_index is not None else -1
            }
            
            self.logger.error(f"Failed to capture screenshot for {url}", error_context)
            
            # Use our custom error class for better error messages
            from app.core.errors import ScreenshotError
            raise ScreenshotError(url=url, context=error_context, original_exception=e)
        finally:
            # Close page if still open
            if page and not page.is_closed():
                try:
                    await page.close()
                except Exception:
                    pass  # Ignore errors during cleanup
                    
            # Ensure context is returned to pool even if an error occurs
            if context and browser_index is not None:
                await self._return_context(context, browser_index)

    def _cleanup_temp_files(self) -> int:
        """Clean up old temporary files.
        
        Returns:
            Number of files removed
        """
        files_removed = 0
        try:
            # Get current time
            current_time = time.time()
            
            # Get all files in the screenshot directory
            for filename in os.listdir(settings.screenshot_dir):
                filepath = os.path.join(settings.screenshot_dir, filename)
                
                # Check if file is older than 1 hour
                file_mod_time = os.path.getmtime(filepath)
                if current_time - file_mod_time > 3600:  # 1 hour in seconds
                    # Remove the file
                    os.unlink(filepath)
                    files_removed += 1
            
            if files_removed > 0:
                self.logger.info(f"Removed {files_removed} old temporary files", {
                    "files_removed": files_removed,
                    "directory": settings.screenshot_dir,
                    "age_threshold": "1 hour"
                })
            
            return files_removed
        except Exception as e:
            # Log error but don't raise to avoid disrupting the main flow
            self.logger.error(f"Error cleaning up temporary files: {str(e)}", {
                "error": str(e),
                "error_type": type(e).__name__,
                "directory": settings.screenshot_dir
            })
            return files_removed
    
    async def cleanup(self):
        """Clean up resources."""
        self.logger.info("Cleaning up screenshot service resources")
        
        # Shutdown the browser pool
        start_time = time.time()
        await self._browser_pool.shutdown()
        browser_pool_shutdown_time = time.time() - start_time
        
        # Clean up temporary files
        temp_files_start = time.time()
        files_removed = self._cleanup_temp_files()
        temp_files_cleanup_time = time.time() - temp_files_start
        
        self.logger.info("Screenshot service resources cleaned up", {
            "browser_pool_shutdown_time": browser_pool_shutdown_time,
            "temp_files_cleanup_time": temp_files_cleanup_time,
            "temp_files_removed": files_removed
        })
        
    def get_pool_stats(self):
        """Get browser pool statistics."""
        return self._browser_pool.get_stats()
    
    def get_retry_stats(self):
        """Get retry and timeout statistics."""
        return {
            "timeouts": self._timeout_stats,
            "browser_retry": self._browser_retry_manager.get_stats(),
            "circuit_breakers": {
                "browser": self._browser_circuit_breaker.get_state(),
                "navigation": self._navigation_circuit_breaker.get_state()
            }
        }


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
