import asyncio
import os
import uuid

from playwright.async_api import async_playwright

from app.core.config import settings


class ScreenshotService:
    """Service for capturing screenshots using Playwright."""

    def __init__(self):
        self._browser = None
        self._context = None
        self._lock = asyncio.Lock()
        # Ensure screenshot directory exists
        os.makedirs(settings.screenshot_dir, exist_ok=True)

    async def _get_browser(self):
        """Get or create a browser instance."""
        if self._browser is None:
            playwright = await async_playwright().start()
            self._browser = await playwright.chromium.launch()
        return self._browser

    async def _get_context(self):
        """Get or create a browser context."""
        browser = await self._get_browser()
        if self._context is None:
            self._context = await browser.new_context()
        return self._context

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

        # Ensure we only run one screenshot at a time to avoid browser issues
        async with self._lock:
            try:
                context = await self._get_context()
                page = await context.new_page()
                await page.set_viewport_size({"width": width, "height": height})
                await page.goto(url, wait_until="networkidle")
                await page.screenshot(path=filepath, type=format, full_page=False)
                await page.close()
                return filepath
            except Exception as e:
                # Clean up any partially created file
                if os.path.exists(filepath):
                    os.unlink(filepath)
                raise RuntimeError(f"Failed to capture screenshot: {str(e)}") from e

    async def cleanup(self):
        """Clean up resources."""
        if self._context:
            await self._context.close()
            self._context = None

        if self._browser:
            await self._browser.close()
            self._browser = None


# Create a singleton instance
screenshot_service = ScreenshotService()
