#!/usr/bin/env python3
"""
Dynamic browser pool scaling script to eliminate waiting.
This script monitors browser pool usage and automatically scales capacity.
"""

import asyncio
import sys
import time
import os
from pathlib import Path

# Add the app directory to the Python path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.core.config import settings
from app.services.browser_pool import BrowserPool
from app.core.logging import get_logger

logger = get_logger("browser_pool_scaler")

class BrowserPoolScaler:
    """Intelligent browser pool scaling to eliminate waiting."""
    
    def __init__(self):
        self.pool = None
        self.target_utilization = 0.7  # Keep utilization below 70%
        self.scale_up_threshold = 0.8   # Scale up at 80%
        self.scale_down_threshold = 0.3 # Scale down below 30%
        self.min_browsers = 20
        self.max_browsers = 200  # Adjust based on your server capacity
        
    async def initialize(self):
        """Initialize the browser pool."""
        self.pool = BrowserPool()
        await self.pool.initialize()
        logger.info("Browser pool scaler initialized")
        
    async def get_current_metrics(self):
        """Get current browser pool metrics."""
        if not self.pool:
            return None
            
        stats = self.pool.get_stats()
        health = self.pool.get_health_status()
        
        return {
            "total_browsers": stats["size"],
            "available_browsers": stats["available"],
            "in_use_browsers": stats["in_use"],
            "utilization": stats["usage_ratio"],
            "wait_events": stats["wait_events"],
            "pool_exhaustions": stats["pool_exhaustions"],
            "health_score": health["health_score"],
            "avg_wait_time": stats["avg_wait_time"]
        }
    
    async def should_scale_up(self, metrics):
        """Determine if we should scale up the browser pool."""
        if not metrics:
            return False
            
        # Scale up if:
        # 1. Utilization is too high
        # 2. There are wait events
        # 3. Pool exhaustions occurred
        # 4. We haven't reached max capacity
        
        conditions = [
            metrics["utilization"] > self.scale_up_threshold,
            metrics["wait_events"] > 0,
            metrics["pool_exhaustions"] > 0,
            metrics["avg_wait_time"] > 0.5,  # More than 0.5s average wait
            metrics["total_browsers"] < self.max_browsers
        ]
        
        return any(conditions) and metrics["total_browsers"] < self.max_browsers
    
    async def should_scale_down(self, metrics):
        """Determine if we should scale down the browser pool."""
        if not metrics:
            return False
            
        # Scale down if:
        # 1. Utilization is very low
        # 2. No wait events recently
        # 3. Above minimum capacity
        
        conditions = [
            metrics["utilization"] < self.scale_down_threshold,
            metrics["wait_events"] == 0,
            metrics["pool_exhaustions"] == 0,
            metrics["avg_wait_time"] == 0,
            metrics["total_browsers"] > self.min_browsers
        ]
        
        return all(conditions)
    
    async def scale_up(self, metrics):
        """Scale up the browser pool."""
        current_size = metrics["total_browsers"]
        
        # Calculate new size based on current load
        if metrics["pool_exhaustions"] > 0:
            # Aggressive scaling if pool exhausted
            new_size = min(current_size * 2, self.max_browsers)
        elif metrics["utilization"] > 0.9:
            # Moderate scaling for high utilization
            new_size = min(int(current_size * 1.5), self.max_browsers)
        else:
            # Conservative scaling
            new_size = min(current_size + 10, self.max_browsers)
        
        if new_size > current_size:
            logger.info(f"Scaling UP browser pool: {current_size} -> {new_size}")
            
            # Update environment variable
            os.environ["BROWSER_POOL_MAX_SIZE"] = str(new_size)
            
            # Force pool to recognize new size
            self.pool._max_size = new_size
            
            # Pre-create browsers to reach new capacity
            await self._precreate_browsers(new_size - current_size)
            
            return True
        return False
    
    async def scale_down(self, metrics):
        """Scale down the browser pool."""
        current_size = metrics["total_browsers"]
        new_size = max(current_size - 5, self.min_browsers)
        
        if new_size < current_size:
            logger.info(f"Scaling DOWN browser pool: {current_size} -> {new_size}")
            
            # Update environment variable
            os.environ["BROWSER_POOL_MAX_SIZE"] = str(new_size)
            
            # Update pool size
            self.pool._max_size = new_size
            
            return True
        return False
    
    async def _precreate_browsers(self, count):
        """Pre-create browsers to reach target capacity."""
        try:
            for i in range(count):
                # Create browser instances in background
                asyncio.create_task(self._create_browser_async())
                await asyncio.sleep(0.1)  # Small delay to prevent overwhelming
        except Exception as e:
            logger.error(f"Error pre-creating browsers: {e}")
    
    async def _create_browser_async(self):
        """Create a browser instance asynchronously."""
        try:
            browser_data = await self.pool._create_browser_instance()
            if browser_data:
                async with self.pool._lock:
                    self.pool._browsers.append(browser_data)
                    self.pool._available_browsers.append(len(self.pool._browsers) - 1)
                    self.pool._stats["current_size"] = len(self.pool._browsers)
        except Exception as e:
            logger.error(f"Error creating browser instance: {e}")
    
    async def monitor_and_scale(self, interval=30):
        """Monitor browser pool and scale as needed."""
        logger.info(f"Starting browser pool monitoring (interval: {interval}s)")
        
        while True:
            try:
                metrics = await self.get_current_metrics()
                
                if metrics:
                    logger.info(f"Pool metrics: {metrics['total_browsers']} browsers, "
                              f"{metrics['utilization']:.2f} utilization, "
                              f"{metrics['wait_events']} wait events, "
                              f"health: {metrics['health_score']}")
                    
                    # Check if scaling is needed
                    if await self.should_scale_up(metrics):
                        await self.scale_up(metrics)
                    elif await self.should_scale_down(metrics):
                        await self.scale_down(metrics)
                
                await asyncio.sleep(interval)
                
            except Exception as e:
                logger.error(f"Error in monitoring loop: {e}")
                await asyncio.sleep(interval)
    
    async def shutdown(self):
        """Shutdown the scaler."""
        if self.pool:
            await self.pool.shutdown()
        logger.info("Browser pool scaler shutdown")

async def main():
    """Run the browser pool scaler."""
    scaler = BrowserPoolScaler()
    
    try:
        await scaler.initialize()
        await scaler.monitor_and_scale()
    except KeyboardInterrupt:
        logger.info("Received shutdown signal")
    finally:
        await scaler.shutdown()

if __name__ == "__main__":
    asyncio.run(main())
