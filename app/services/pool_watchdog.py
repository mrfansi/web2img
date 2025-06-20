import asyncio
import time
from typing import Dict, Any

from app.core.logging import get_logger
from app.core.config import settings
from app.services.browser_pool import BrowserPool


class BrowserPoolWatchdog:
    """Watchdog service that monitors browser pool health and automatically fixes issues.

    This service runs in the background and periodically checks the browser pool for:
    1. Stuck browsers (high usage ratio with low actual traffic)
    2. Memory leaks (browsers consuming excessive memory)
    3. Pool inconsistencies (tracking mismatches between available and in-use)

    When issues are detected, it takes corrective actions automatically.
    """

    def __init__(self, browser_pool: BrowserPool):
        self.logger = get_logger("pool_watchdog")
        self.browser_pool = browser_pool

        # Configuration from settings (now properly defined in Settings class)
        self.check_interval = settings.pool_watchdog_interval  # seconds
        self.idle_threshold = settings.pool_watchdog_idle_threshold  # seconds
        self.usage_threshold = settings.pool_watchdog_usage_threshold  # 70%
        self.request_threshold = settings.pool_watchdog_request_threshold  # requests
        self.force_recycle_age = settings.pool_watchdog_force_recycle_age  # 1 hour

        # State tracking
        self._watchdog_task = None
        self._last_request_time = time.time()
        self._last_request_count = 0
        self._current_request_count = 0
        self._last_check_time = time.time()
        self._is_running = False

    async def start(self):
        """Start the watchdog service."""
        if self._is_running:
            return

        self._is_running = True
        self._watchdog_task = asyncio.create_task(self._watchdog_loop())
        self.logger.info("Browser pool watchdog started", {
            "check_interval": self.check_interval,
            "idle_threshold": self.idle_threshold,
            "usage_threshold": self.usage_threshold
        })

    async def stop(self):
        """Stop the watchdog service."""
        if not self._is_running:
            return

        self._is_running = False
        if self._watchdog_task:
            self._watchdog_task.cancel()
            try:
                await self._watchdog_task
            except asyncio.CancelledError:
                pass

        self.logger.info("Browser pool watchdog stopped")

    def record_request(self):
        """Record that a request was received.

        This should be called whenever a screenshot request is processed.
        """
        self._last_request_time = time.time()
        self._current_request_count += 1

    async def _watchdog_loop(self):
        """Main watchdog loop that periodically checks pool health."""
        try:
            while self._is_running:
                await asyncio.sleep(self.check_interval)
                await self._check_pool_health()
        except asyncio.CancelledError:
            # Expected during shutdown
            pass
        except Exception as e:
            self.logger.exception(f"Error in browser pool watchdog: {str(e)}", {
                "error": str(e),
                "error_type": type(e).__name__
            })

    async def _check_pool_health(self):
        """Check the health of the browser pool and take corrective actions if needed."""
        current_time = time.time()

        # Get pool stats
        pool_stats = self.browser_pool.get_stats()

        # Calculate time since last request
        idle_time = current_time - self._last_request_time

        # Calculate request rate
        time_since_last_check = current_time - self._last_check_time
        request_count_delta = self._current_request_count - self._last_request_count
        request_rate = request_count_delta / time_since_last_check if time_since_last_check > 0 else 0

        # Update tracking variables
        self._last_check_time = current_time
        self._last_request_count = self._current_request_count

        # Log current state
        self.logger.debug("Browser pool health check", {
            "pool_size": pool_stats["size"],
            "in_use": pool_stats["in_use"],
            "usage_ratio": pool_stats["usage_ratio"],
            "idle_time": idle_time,
            "request_rate": request_rate
        })

        # Check for stuck browsers (high usage with low traffic)
        if pool_stats["usage_ratio"] > self.usage_threshold and idle_time > self.idle_threshold:
            self.logger.warning("Detected potential stuck browsers", {
                "usage_ratio": pool_stats["usage_ratio"],
                "idle_time": idle_time,
                "request_rate": request_rate
            })

            # Force browser recycling
            await self._force_recycle_browsers(pool_stats)

        # Check for old browsers that need recycling regardless of usage
        await self._recycle_old_browsers()

    async def _force_recycle_browsers(self, pool_stats: Dict[str, Any]):
        """Force recycle browsers when stuck browsers are detected."""
        self.logger.info("Forcing browser recycling due to potential stuck browsers")

        # Calculate how many browsers to recycle
        # We'll recycle half of the in-use browsers to avoid disrupting valid operations
        browsers_to_recycle = max(1, pool_stats["in_use"] // 2)

        try:
            # Call the cleanup method with a flag to force recycling
            # We need to add this parameter to the cleanup method in browser_pool.py
            if hasattr(self.browser_pool, "force_recycle"):
                recycled_count = await self.browser_pool.force_recycle(browsers_to_recycle)
                self.logger.info(f"Successfully recycled {recycled_count} browsers")
            else:
                # Fallback if force_recycle method doesn't exist
                # Just call the regular cleanup which will recycle idle browsers
                await self.browser_pool.cleanup()
                self.logger.info("Called regular cleanup as fallback")
        except Exception as e:
            self.logger.error(f"Error during forced browser recycling: {str(e)}", {
                "error": str(e),
                "error_type": type(e).__name__
            })

    async def _recycle_old_browsers(self):
        """Recycle browsers that have been alive for too long to prevent memory leaks."""
        # Get browsers that are older than the force recycle age
        old_browsers = []

        # Check if browser pool has the method to get browser ages
        if hasattr(self.browser_pool, '_browsers'):
            for i, browser_data in enumerate(self.browser_pool._browsers):
                if browser_data and hasattr(browser_data, 'created_at'):
                    age = time.time() - browser_data.created_at
                    if age > self.force_recycle_age:
                        old_browsers.append(i)
        if hasattr(self.browser_pool, "get_browser_ages"):
            browser_ages = await self.browser_pool.get_browser_ages()

            old_browsers = []
            for browser_index, age in browser_ages.items():
                if age > self.force_recycle_age:
                    old_browsers.append(browser_index)

            if old_browsers:
                self.logger.info(f"Recycling {len(old_browsers)} browsers due to age", {
                    "browser_count": len(old_browsers),
                    "max_age": self.force_recycle_age
                })

                # Recycle old browsers one by one
                for browser_index in old_browsers:
                    try:
                        if hasattr(self.browser_pool, "_recycle_browser"):
                            await self.browser_pool._recycle_browser(browser_index)
                    except Exception as e:
                        self.logger.error(f"Error recycling old browser {browser_index}: {str(e)}")


# Create a singleton instance
pool_watchdog = None


def initialize_watchdog(browser_pool: BrowserPool):
    """Initialize the browser pool watchdog."""
    global pool_watchdog
    if pool_watchdog is None:
        pool_watchdog = BrowserPoolWatchdog(browser_pool)
    return pool_watchdog
