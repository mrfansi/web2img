import asyncio
import os
import time
import uuid
from typing import Dict, Optional, List

from playwright.async_api import async_playwright, Browser, BrowserContext, Page

from app.core.config import settings


class ScreenshotService:
    """Service for capturing screenshots using Playwright."""

    def __init__(self):
        self._browser = None
        self._contexts: List[BrowserContext] = []
        self._context_pool: List[BrowserContext] = []  # Available contexts
        self._lock = asyncio.Lock()
        self._last_cleanup = time.time()
        self._max_contexts = 5  # Maximum number of browser contexts to keep
        self._context_ttl = 300  # Time to live for browser contexts in seconds (5 minutes)
        
        # Ensure screenshot directory exists
        os.makedirs(settings.screenshot_dir, exist_ok=True)

    async def _get_browser(self):
        """Get or create a browser instance."""
        if self._browser is None:
            playwright = await async_playwright().start()
            # Launch with optimized settings for performance
            self._browser = await playwright.chromium.launch(
                args=[
                    '--disable-gpu',  # Disable GPU hardware acceleration
                    '--disable-dev-shm-usage',  # Overcome limited resource problems
                    '--disable-setuid-sandbox',  # Disable setuid sandbox (performance)
                    '--no-sandbox',  # Disable sandbox for better performance
                    '--no-zygote',  # Disable zygote process
                    '--single-process',  # Run in a single process
                    '--disable-extensions',  # Disable extensions for performance
                    '--disable-features=site-per-process',  # Disable site isolation
                ]
            )
        return self._browser

    async def _get_context(self):
        """Get a browser context from the pool or create a new one."""
        browser = await self._get_browser()
        
        # Check if we have a context in the pool
        if self._context_pool:
            return self._context_pool.pop()
            
        # Create a new context if we haven't reached the limit
        if len(self._contexts) < self._max_contexts:
            context = await browser.new_context(
                viewport={'width': 1280, 'height': 720},
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                java_script_enabled=True,
                ignore_https_errors=True,
                bypass_csp=True  # Bypass Content-Security-Policy
            )
            self._contexts.append(context)
            return context
            
        # If we've reached the limit, wait for a context to become available
        while not self._context_pool:
            await asyncio.sleep(0.1)
        return self._context_pool.pop()
        
    async def _return_context(self, context: BrowserContext):
        """Return a context to the pool."""
        # Only return to pool if it's still in our list of contexts
        if context in self._contexts:
            # Clear browser cache and cookies before returning to pool
            pages = context.pages
            for page in pages:
                if not page.is_closed():
                    await page.close()
            self._context_pool.append(context)

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
        if current_time - self._last_cleanup > 3600:  # Clean up every hour
            self._cleanup_temp_files()
            self._last_cleanup = current_time

        context = None
        try:
            # Get a browser context from the pool
            context = await self._get_context()
            
            # Create a new page with optimized settings
            page = await context.new_page()
            
            # Set viewport size
            await page.set_viewport_size({"width": width, "height": height})
            
            # Set timeout for navigation
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
            await page.close()
            
            # Return the context to the pool for reuse
            await self._return_context(context)
            context = None  # Prevent double return in finally block
            
            return filepath
        except Exception as e:
            # Clean up any partially created file
            if os.path.exists(filepath):
                os.unlink(filepath)
            raise RuntimeError(f"Failed to capture screenshot: {str(e)}") from e
        finally:
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
        # Close all contexts
        for context in self._contexts:
            try:
                await context.close()
            except Exception:
                pass  # Ignore errors during cleanup
        
        self._contexts = []
        self._context_pool = []

        # Close browser
        if self._browser:
            try:
                await self._browser.close()
            except Exception:
                pass  # Ignore errors during cleanup
            self._browser = None
            
        # Clean up temporary files
        self._cleanup_temp_files()


# Create a singleton instance
screenshot_service = ScreenshotService()
