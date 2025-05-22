import asyncio
import os
import time
import uuid
from typing import Dict, Optional, List, Any

from playwright.async_api import async_playwright, Browser, BrowserContext, Page

from app.core.config import settings


class ScreenshotService:
    """Service for capturing screenshots using Playwright."""

    def __init__(self):
        self._browser = None
        self._playwright = None
        self._contexts: List[BrowserContext] = []
        self._context_pool: List[BrowserContext] = []  # Available contexts
        self._lock = asyncio.Lock()
        self._last_cleanup = time.time()
        self._browser_lock = asyncio.Lock()  # Dedicated lock for browser operations
        self._max_contexts = 3  # Reduced from 5 to 3 for better stability
        self._context_ttl = 300  # Time to live for browser contexts in seconds (5 minutes)
        self._browser_last_used = time.time()
        self._browser_ttl = 600  # Browser time to live in seconds (10 minutes)
        
        # Ensure screenshot directory exists
        os.makedirs(settings.screenshot_dir, exist_ok=True)

    async def _get_browser(self):
        """Get or create a browser instance."""
        async with self._browser_lock:
            # Check if browser needs to be recreated due to TTL
            current_time = time.time()
            if self._browser is not None and current_time - self._browser_last_used > self._browser_ttl:
                # Browser has been idle too long, close it and create a new one
                try:
                    await self._browser.close()
                except Exception:
                    pass  # Ignore errors during cleanup
                self._browser = None
                if self._playwright:
                    try:
                        await self._playwright.stop()
                    except Exception:
                        pass  # Ignore errors during cleanup
                    self._playwright = None
            
            # Create a new browser if needed
            if self._browser is None:
                try:
                    self._playwright = await async_playwright().start()
                    # Launch with optimized settings for performance
                    self._browser = await self._playwright.chromium.launch(
                        args=[
                            '--disable-gpu',  # Disable GPU hardware acceleration
                            '--disable-dev-shm-usage',  # Overcome limited resource problems
                            '--disable-setuid-sandbox',  # Disable setuid sandbox (performance)
                            '--no-sandbox',  # Disable sandbox for better performance
                            '--no-zygote',  # Disable zygote process
                            '--single-process',  # Run in a single process
                            '--disable-extensions',  # Disable extensions for performance
                            '--disable-features=site-per-process',  # Disable site isolation
                        ],
                        headless=True
                    )
                except Exception as e:
                    # If browser creation fails, clean up resources and re-raise
                    if self._playwright:
                        try:
                            await self._playwright.stop()
                        except Exception:
                            pass  # Ignore errors during cleanup
                        self._playwright = None
                    raise RuntimeError(f"Failed to create browser: {str(e)}") from e
                    
            # Update last used timestamp
            self._browser_last_used = current_time
            return self._browser

    async def _get_context(self):
        """Get a browser context from the pool or create a new one."""
        async with self._lock:
            # Check if we have a context in the pool
            if self._context_pool:
                return self._context_pool.pop()
            
            # Get or create browser instance
            try:
                browser = await self._get_browser()
                
                # Create a new context if we haven't reached the limit
                if len(self._contexts) < self._max_contexts:
                    try:
                        context = await browser.new_context(
                            viewport={'width': 1280, 'height': 720},
                            user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                            java_script_enabled=True,
                            ignore_https_errors=True,
                            bypass_csp=True  # Bypass Content-Security-Policy
                        )
                        self._contexts.append(context)
                        return context
                    except Exception as e:
                        # If context creation fails, try to recreate the browser
                        if 'has been closed' in str(e):
                            # Browser is closed, force recreation
                            self._browser = None
                            # Try again with a new browser
                            browser = await self._get_browser()
                            context = await browser.new_context(
                                viewport={'width': 1280, 'height': 720},
                                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                                java_script_enabled=True,
                                ignore_https_errors=True,
                                bypass_csp=True  # Bypass Content-Security-Policy
                            )
                            self._contexts.append(context)
                            return context
                        else:
                            # Other error, re-raise
                            raise
                
                # If we've reached the limit, wait for a context to become available
                wait_start = time.time()
                max_wait = 10  # Maximum wait time in seconds
                
                while not self._context_pool:
                    # Check if we've waited too long
                    if time.time() - wait_start > max_wait:
                        # Force cleanup of a context to make room
                        if self._contexts:
                            try:
                                # Close the oldest context
                                await self._contexts[0].close()
                                self._contexts.pop(0)
                                # Create a new context
                                context = await browser.new_context(
                                    viewport={'width': 1280, 'height': 720},
                                    user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                                    java_script_enabled=True,
                                    ignore_https_errors=True,
                                    bypass_csp=True  # Bypass Content-Security-Policy
                                )
                                self._contexts.append(context)
                                return context
                            except Exception:
                                # If that fails, recreate the browser
                                self._browser = None
                                browser = await self._get_browser()
                                context = await browser.new_context(
                                    viewport={'width': 1280, 'height': 720},
                                    user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                                    java_script_enabled=True,
                                    ignore_https_errors=True,
                                    bypass_csp=True  # Bypass Content-Security-Policy
                                )
                                self._contexts.append(context)
                                return context
                    
                    # Release the lock while waiting
                    self._lock.release()
                    try:
                        await asyncio.sleep(0.1)
                    finally:
                        await self._lock.acquire()
                        
                return self._context_pool.pop()
            except Exception as e:
                # If all else fails, recreate the browser and try one more time
                self._browser = None
                try:
                    browser = await self._get_browser()
                    context = await browser.new_context(
                        viewport={'width': 1280, 'height': 720},
                        user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                        java_script_enabled=True,
                        ignore_https_errors=True,
                        bypass_csp=True  # Bypass Content-Security-Policy
                    )
                    self._contexts.append(context)
                    return context
                except Exception as e2:
                    # If that still fails, give up and report the error
                    raise RuntimeError(f"Failed to create browser context after multiple attempts: {str(e2)}") from e2
        
    async def _return_context(self, context: BrowserContext):
        """Return a context to the pool."""
        async with self._lock:
            # Only return to pool if it's still in our list of contexts
            if context in self._contexts:
                try:
                    # Clear browser cache and cookies before returning to pool
                    pages = context.pages
                    for page in pages:
                        if not page.is_closed():
                            await page.close()
                    self._context_pool.append(context)
                except Exception as e:
                    # If context is already closed, remove it from contexts list
                    if 'has been closed' in str(e) and context in self._contexts:
                        self._contexts.remove(context)

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
        
        # Periodically clean up old temporary files
        current_time = time.time()
        if current_time - self._last_cleanup > 3600:  # 1 hour
            self._cleanup_temp_files()
            self._last_cleanup = current_time
            
        # Get a browser context
        context = None
        page = None
        try:
            # Get a context with retry logic
            retry_count = 0
            max_retries = 3
            while retry_count < max_retries:
                try:
                    context = await self._get_context()
                    # Create a new page
                    page = await context.new_page()
                    break
                except Exception as e:
                    retry_count += 1
                    if retry_count >= max_retries:
                        raise
                    await asyncio.sleep(0.5)  # Wait before retry
            
            # Set viewport size
            await page.set_viewport_size({"width": width, "height": height})
            
            # Set timeout
            page_timeout = 30000  # 30 seconds
            
            # Configure page for better performance
            await page.route('**/*.{png,jpg,jpeg,gif,svg,pdf,woff,woff2,ttf,otf}', lambda route: route.abort())
            
            # Navigate to the URL with optimized settings
            response = await page.goto(
                url, 
                wait_until="networkidle",
                timeout=page_timeout
            )
            
            # Take the screenshot
            await page.screenshot(
                path=filepath, 
                type=format, 
                full_page=False,
                quality=90 if format in ['jpeg', 'webp'] else None
            )
            
            # Close the page to free resources
            if page and not page.is_closed():
                await page.close()
                page = None
            
            # Return the context to the pool for reuse
            if context:
                await self._return_context(context)
                context = None  # Prevent double return in finally block
            
            return filepath
        except Exception as e:
            # Clean up any partially created file
            if os.path.exists(filepath):
                os.unlink(filepath)
            raise RuntimeError(f"Failed to capture screenshot: {str(e)}") from e
        finally:
            # Close page if still open
            if page and not page.is_closed():
                try:
                    await page.close()
                except Exception:
                    pass  # Ignore errors during cleanup
                    
            # Ensure context is returned to pool even if an error occurs
            if context:
                await self._return_context(context)

    def _cleanup_temp_files(self):
        """Clean up old temporary files."""
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
        except Exception as e:
            # Log error but don't raise to avoid disrupting the main flow
            print(f"Error cleaning up temporary files: {str(e)}")
    
    async def cleanup(self):
        """Clean up resources."""
        async with self._lock:
            # Close all contexts
            for context in self._contexts:
                try:
                    await context.close()
                except Exception:
                    pass  # Ignore errors during cleanup
            
            self._contexts = []
            self._context_pool = []
        
        async with self._browser_lock:
            # Close browser
            if self._browser:
                try:
                    await self._browser.close()
                except Exception:
                    pass  # Ignore errors during cleanup
                self._browser = None
                
            # Stop playwright
            if self._playwright:
                try:
                    await self._playwright.stop()
                except Exception:
                    pass  # Ignore errors during cleanup
                self._playwright = None
                
            # Clean up temporary files
            self._cleanup_temp_files()


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
        imgproxy_url = imgproxy_service.generate_url(
            r2_key,
            width=width,
            height=height,
            format=format
        )
        
        return {"url": imgproxy_url}
    finally:
        # Clean up the temporary file
        if os.path.exists(filepath):
            os.unlink(filepath)


# Create a singleton instance
screenshot_service = ScreenshotService()
