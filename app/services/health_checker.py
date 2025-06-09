import asyncio
import time
from typing import Dict, Any, Optional
import httpx

from app.core.logging import get_logger
from app.core.config import settings
from app.schemas.screenshot import ScreenshotRequest


class HealthCheckService:
    """Service that periodically checks the health of the /screenshot endpoint.
    
    This service runs in the background and makes requests to the /screenshot endpoint
    every 5 minutes (configurable) with cache disabled to ensure the endpoint is working
    properly and can handle real requests.
    """

    def __init__(self):
        self.logger = get_logger("health_checker")
        self._is_running = False
        self._task: Optional[asyncio.Task] = None
        self._last_check_time: Optional[float] = None
        self._last_check_success: Optional[bool] = None
        self._last_check_duration: Optional[float] = None
        self._last_error: Optional[str] = None
        self._check_count = 0
        self._success_count = 0
        self._failure_count = 0

    async def start(self):
        """Start the health check service."""
        if self._is_running:
            self.logger.warning("Health check service is already running")
            return

        if not settings.health_check_enabled:
            self.logger.info("Health check service is disabled")
            return

        self.logger.info(f"Starting health check service with {settings.health_check_interval}s interval")
        self._is_running = True
        self._task = asyncio.create_task(self._health_check_loop())
        self._task.add_done_callback(self._handle_task_done)

    async def stop(self):
        """Stop the health check service."""
        if not self._is_running:
            return

        self.logger.info("Stopping health check service")
        self._is_running = False

        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    def get_stats(self) -> Dict[str, Any]:
        """Get health check statistics."""
        stats = {
            "enabled": settings.health_check_enabled,
            "running": self._is_running,
            "last_check_time": self._last_check_time,
            "last_check_success": self._last_check_success,
            "last_check_duration": self._last_check_duration,
            "last_error": self._last_error,
            "check_count": self._check_count,
            "success_count": self._success_count,
            "failure_count": self._failure_count,
            "success_rate": self._success_count / max(1, self._check_count),
            "interval": settings.health_check_interval,
            "test_url": settings.health_check_url
        }

        # Update monitoring metrics
        try:
            from app.core.monitoring import metrics_collector
            metrics_collector.update_health_check_stats(stats)
        except ImportError:
            pass  # Monitoring not available

        return stats

    def _handle_task_done(self, task: asyncio.Task):
        """Handle completion of the health check task."""
        if task.cancelled():
            self.logger.info("Health check task was cancelled")
        elif task.exception():
            self.logger.error(f"Health check task failed: {task.exception()}")
        else:
            self.logger.info("Health check task completed")

    async def _health_check_loop(self):
        """Main health check loop that runs periodically."""
        try:
            # Wait a bit before starting the first check to allow services to initialize
            await asyncio.sleep(30)
            
            while self._is_running:
                await self._perform_health_check()
                await asyncio.sleep(settings.health_check_interval)
        except asyncio.CancelledError:
            # Expected during shutdown
            pass
        except Exception as e:
            self.logger.exception(f"Error in health check loop: {str(e)}", {
                "error": str(e),
                "error_type": type(e).__name__
            })

    async def _perform_health_check(self):
        """Perform a single health check by calling the /screenshot endpoint."""
        start_time = time.time()
        self._check_count += 1
        
        try:
            self.logger.info(f"Performing health check #{self._check_count}")
            
            # Create the screenshot request
            request_data = {
                "url": settings.health_check_url,
                "format": "png",
                "width": 1280,
                "height": 720
            }
            
            # Make the request to the local /screenshot endpoint with cache disabled
            health_check_endpoint = f"http://localhost:{settings.health_check_port}/screenshot?cache=false"
            async with httpx.AsyncClient(timeout=settings.health_check_timeout) as client:
                response = await client.post(
                    health_check_endpoint,
                    json=request_data,
                    headers={"Content-Type": "application/json"}
                )
                
                # Check if the request was successful
                if response.status_code == 200:
                    self._last_check_success = True
                    self._success_count += 1
                    self._last_error = None
                    
                    duration = time.time() - start_time
                    self._last_check_duration = duration
                    
                    self.logger.info(f"Health check #{self._check_count} successful", {
                        "duration": duration,
                        "status_code": response.status_code,
                        "test_url": settings.health_check_url
                    })
                else:
                    self._handle_health_check_failure(
                        f"HTTP {response.status_code}: {response.text}",
                        start_time
                    )
                    
        except asyncio.TimeoutError:
            self._handle_health_check_failure("Request timeout", start_time)
        except httpx.ConnectError:
            self._handle_health_check_failure("Connection error - service may not be running", start_time)
        except Exception as e:
            self._handle_health_check_failure(f"Unexpected error: {str(e)}", start_time)
        
        self._last_check_time = time.time()

    def _handle_health_check_failure(self, error_message: str, start_time: float):
        """Handle a health check failure."""
        self._last_check_success = False
        self._failure_count += 1
        self._last_error = error_message
        self._last_check_duration = time.time() - start_time
        
        self.logger.error(f"Health check #{self._check_count} failed", {
            "error": error_message,
            "duration": self._last_check_duration,
            "test_url": settings.health_check_url,
            "success_rate": self._success_count / max(1, self._check_count)
        })


# Global health check service instance
health_check_service = HealthCheckService()
