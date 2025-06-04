"""
Tab Pool Manager for optimizing browser usage with multiple tabs per browser.

This module manages tab allocation and reuse within browser instances to reduce
browser pool usage and improve performance for high-concurrency screenshot operations.
"""

import asyncio
import time
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field
from playwright.async_api import Page, BrowserContext

from app.core.logging import get_logger
from app.core.config import settings


@dataclass
class TabInfo:
    """Information about a tab in the pool."""
    page: Page
    context: BrowserContext
    browser_index: int
    created_at: float
    last_used: float
    is_busy: bool = False
    usage_count: int = 0
    url_history: List[str] = field(default_factory=list)


class TabPool:
    """Manages tabs within browser instances for optimal resource utilization."""
    
    def __init__(self):
        self.logger = get_logger("tab_pool")
        
        # Tab storage: browser_index -> list of TabInfo
        self._browser_tabs: Dict[int, List[TabInfo]] = {}
        
        # Available tabs queue for quick access
        self._available_tabs: List[TabInfo] = []
        
        # Lock for thread-safe operations
        self._lock = asyncio.Lock()
        
        # Statistics
        self._stats = {
            "total_tabs": 0,
            "available_tabs": 0,
            "busy_tabs": 0,
            "tabs_created": 0,
            "tabs_reused": 0,
            "tabs_cleaned": 0,
            "browsers_with_tabs": 0
        }
        
        # Cleanup task
        self._cleanup_task: Optional[asyncio.Task] = None
        
    async def initialize(self):
        """Initialize the tab pool."""
        self.logger.info("Initializing tab pool", {
            "max_tabs_per_browser": settings.max_tabs_per_browser,
            "tab_idle_timeout": settings.tab_idle_timeout,
            "tab_max_age": settings.tab_max_age,
            "enable_tab_reuse": settings.enable_tab_reuse
        })
        
        # Start cleanup task
        self._start_cleanup_task()
        
    async def get_tab(self, browser_index: int, context: BrowserContext, width: int = 1280, height: int = 720) -> Tuple[Page, TabInfo]:
        """Get an available tab or create a new one.
        
        Args:
            browser_index: Index of the browser to get tab from
            context: Browser context to create tab in
            width: Viewport width
            height: Viewport height
            
        Returns:
            Tuple of (page, tab_info)
        """
        async with self._lock:
            # Try to reuse an existing tab if enabled
            if settings.enable_tab_reuse:
                tab_info = await self._get_available_tab(browser_index)
                if tab_info:
                    # Mark as busy and update usage
                    tab_info.is_busy = True
                    tab_info.last_used = time.time()
                    tab_info.usage_count += 1
                    
                    # Remove from available tabs
                    if tab_info in self._available_tabs:
                        self._available_tabs.remove(tab_info)
                    
                    # Update stats
                    self._stats["tabs_reused"] += 1
                    self._stats["available_tabs"] = len(self._available_tabs)
                    self._stats["busy_tabs"] = self._count_busy_tabs()
                    
                    self.logger.debug(f"Reusing tab for browser {browser_index}", {
                        "tab_usage_count": tab_info.usage_count,
                        "tab_age": time.time() - tab_info.created_at
                    })
                    
                    # Reset viewport size
                    await tab_info.page.set_viewport_size({"width": width, "height": height})
                    
                    return tab_info.page, tab_info
            
            # Create new tab if we haven't reached the limit
            if await self._can_create_tab(browser_index):
                tab_info = await self._create_new_tab(browser_index, context, width, height)
                if tab_info:
                    return tab_info.page, tab_info
            
            # If we can't create a new tab, wait for an available one
            self.logger.warning(f"Tab limit reached for browser {browser_index}, waiting for available tab")
            return await self._wait_for_available_tab(browser_index, width, height)
    
    async def release_tab(self, tab_info: TabInfo, is_healthy: bool = True):
        """Release a tab back to the pool.
        
        Args:
            tab_info: Tab information to release
            is_healthy: Whether the tab is in a healthy state
        """
        async with self._lock:
            if not is_healthy or not settings.enable_tab_reuse:
                # Close unhealthy tabs or if reuse is disabled
                await self._close_tab(tab_info)
                return
            
            # Check if tab is too old or has been used too many times
            tab_age = time.time() - tab_info.created_at
            if (tab_age > settings.tab_max_age or 
                tab_info.usage_count > 50):  # Limit reuse to prevent memory leaks
                await self._close_tab(tab_info)
                return
            
            # Reset tab state for reuse
            try:
                # Clear any existing routes or handlers
                await self._reset_tab_state(tab_info.page)
                
                # Mark as available
                tab_info.is_busy = False
                tab_info.last_used = time.time()
                
                # Add to available tabs
                self._available_tabs.append(tab_info)
                
                # Update stats
                self._stats["available_tabs"] = len(self._available_tabs)
                self._stats["busy_tabs"] = self._count_busy_tabs()
                
                self.logger.debug(f"Released tab for browser {tab_info.browser_index}", {
                    "tab_usage_count": tab_info.usage_count,
                    "available_tabs": len(self._available_tabs)
                })
                
            except Exception as e:
                self.logger.warning(f"Error resetting tab state, closing tab: {str(e)}")
                await self._close_tab(tab_info)
    
    async def _get_available_tab(self, browser_index: int) -> Optional[TabInfo]:
        """Get an available tab for the specified browser."""
        # Look for available tabs from the same browser first
        for tab_info in self._available_tabs:
            if tab_info.browser_index == browser_index and not tab_info.is_busy:
                return tab_info
        
        # If no tabs from the same browser, look for any available tab
        for tab_info in self._available_tabs:
            if not tab_info.is_busy:
                return tab_info
        
        return None
    
    async def _can_create_tab(self, browser_index: int) -> bool:
        """Check if we can create a new tab for the browser."""
        if browser_index not in self._browser_tabs:
            return True
        
        current_tabs = len(self._browser_tabs[browser_index])
        return current_tabs < settings.max_tabs_per_browser
    
    async def _create_new_tab(self, browser_index: int, context: BrowserContext, width: int, height: int) -> Optional[TabInfo]:
        """Create a new tab in the specified browser."""
        try:
            # Create new page
            page = await context.new_page()
            await page.set_viewport_size({"width": width, "height": height})
            
            # Create tab info
            tab_info = TabInfo(
                page=page,
                context=context,
                browser_index=browser_index,
                created_at=time.time(),
                last_used=time.time(),
                is_busy=True,
                usage_count=1
            )
            
            # Add to browser tabs
            if browser_index not in self._browser_tabs:
                self._browser_tabs[browser_index] = []
            self._browser_tabs[browser_index].append(tab_info)
            
            # Update stats
            self._stats["total_tabs"] += 1
            self._stats["tabs_created"] += 1
            self._stats["busy_tabs"] = self._count_busy_tabs()
            self._stats["browsers_with_tabs"] = len(self._browser_tabs)
            
            self.logger.debug(f"Created new tab for browser {browser_index}", {
                "total_tabs_for_browser": len(self._browser_tabs[browser_index]),
                "total_tabs_overall": self._stats["total_tabs"]
            })
            
            return tab_info
            
        except Exception as e:
            self.logger.error(f"Failed to create new tab for browser {browser_index}: {str(e)}")
            return None
    
    async def _wait_for_available_tab(self, browser_index: int, width: int, height: int) -> Tuple[Page, TabInfo]:
        """Wait for an available tab when limit is reached."""
        # This is a simplified implementation - in production you might want
        # to implement a proper queue with timeouts
        max_wait_time = 30  # seconds
        start_time = time.time()
        
        while time.time() - start_time < max_wait_time:
            await asyncio.sleep(0.1)
            
            async with self._lock:
                tab_info = await self._get_available_tab(browser_index)
                if tab_info:
                    tab_info.is_busy = True
                    tab_info.last_used = time.time()
                    tab_info.usage_count += 1
                    
                    if tab_info in self._available_tabs:
                        self._available_tabs.remove(tab_info)
                    
                    await tab_info.page.set_viewport_size({"width": width, "height": height})
                    return tab_info.page, tab_info
        
        raise Exception(f"Timeout waiting for available tab in browser {browser_index}")
    
    async def _reset_tab_state(self, page: Page):
        """Reset tab state for reuse."""
        try:
            # Navigate to about:blank to clear the page
            await page.goto("about:blank", wait_until="domcontentloaded", timeout=5000)
            
            # Clear any existing route handlers
            await page.unroute("**/*")
            
        except Exception as e:
            self.logger.debug(f"Error resetting tab state: {str(e)}")
            # Don't raise - we'll close the tab instead
            raise
    
    async def _close_tab(self, tab_info: TabInfo):
        """Close a tab and remove it from the pool."""
        try:
            if not tab_info.page.is_closed():
                await tab_info.page.close()
            
            # Remove from browser tabs
            if tab_info.browser_index in self._browser_tabs:
                if tab_info in self._browser_tabs[tab_info.browser_index]:
                    self._browser_tabs[tab_info.browser_index].remove(tab_info)
                
                # Clean up empty browser entries
                if not self._browser_tabs[tab_info.browser_index]:
                    del self._browser_tabs[tab_info.browser_index]
            
            # Remove from available tabs
            if tab_info in self._available_tabs:
                self._available_tabs.remove(tab_info)
            
            # Update stats
            self._stats["total_tabs"] -= 1
            self._stats["tabs_cleaned"] += 1
            self._stats["available_tabs"] = len(self._available_tabs)
            self._stats["busy_tabs"] = self._count_busy_tabs()
            self._stats["browsers_with_tabs"] = len(self._browser_tabs)
            
        except Exception as e:
            self.logger.warning(f"Error closing tab: {str(e)}")
    
    def _count_busy_tabs(self) -> int:
        """Count the number of busy tabs."""
        count = 0
        for tabs in self._browser_tabs.values():
            count += sum(1 for tab in tabs if tab.is_busy)
        return count
    
    def get_stats(self) -> Dict[str, Any]:
        """Get tab pool statistics."""
        return self._stats.copy()
    
    async def cleanup_browser_tabs(self, browser_index: int):
        """Clean up all tabs for a specific browser."""
        async with self._lock:
            if browser_index in self._browser_tabs:
                tabs_to_close = self._browser_tabs[browser_index].copy()
                for tab_info in tabs_to_close:
                    await self._close_tab(tab_info)
    
    def _start_cleanup_task(self):
        """Start the cleanup task."""
        if self._cleanup_task is None or self._cleanup_task.done():
            self._cleanup_task = asyncio.create_task(self._cleanup_loop())
    
    async def _cleanup_loop(self):
        """Periodic cleanup of idle and old tabs."""
        while True:
            try:
                await asyncio.sleep(settings.tab_cleanup_interval)
                await self._cleanup_idle_tabs()
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error(f"Error in tab cleanup loop: {str(e)}")
    
    async def _cleanup_idle_tabs(self):
        """Clean up idle and old tabs."""
        current_time = time.time()
        tabs_to_close = []
        
        async with self._lock:
            # Find tabs to close
            for tabs in self._browser_tabs.values():
                for tab_info in tabs:
                    if not tab_info.is_busy:
                        tab_age = current_time - tab_info.created_at
                        idle_time = current_time - tab_info.last_used
                        
                        if (tab_age > settings.tab_max_age or 
                            idle_time > settings.tab_idle_timeout):
                            tabs_to_close.append(tab_info)
        
        # Close tabs outside the lock
        for tab_info in tabs_to_close:
            await self._close_tab(tab_info)
        
        if tabs_to_close:
            self.logger.info(f"Cleaned up {len(tabs_to_close)} idle/old tabs")
    
    async def shutdown(self):
        """Shutdown the tab pool."""
        self.logger.info("Shutting down tab pool")
        
        # Cancel cleanup task
        if self._cleanup_task and not self._cleanup_task.done():
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
        
        # Close all tabs
        async with self._lock:
            all_tabs = []
            for tabs in self._browser_tabs.values():
                all_tabs.extend(tabs)
            
            for tab_info in all_tabs:
                await self._close_tab(tab_info)
        
        self.logger.info("Tab pool shutdown complete")


# Global tab pool instance
tab_pool = TabPool()
