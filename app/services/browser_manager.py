"""
Browser Manager for Multi-Browser Support

This module provides a unified interface for managing different browser engines
(Chromium, Firefox, WebKit) with engine-specific optimizations.
"""

import asyncio
from typing import Dict, List, Optional, Any
from playwright.async_api import async_playwright, Browser, BrowserType

from app.core.config import settings
from app.core.logging import get_logger


class BrowserManager:
    """Manages browser instances across different engines with optimized configurations."""
    
    def __init__(self):
        self.logger = get_logger("browser_manager")
        self._playwright = None
        self._browser_types: Dict[str, BrowserType] = {}
        
    async def initialize(self):
        """Initialize Playwright and browser types."""
        if self._playwright is None:
            self._playwright = await async_playwright().start()
            self._browser_types = {
                "chromium": self._playwright.chromium,
                "firefox": self._playwright.firefox,
                "webkit": self._playwright.webkit
            }
            self.logger.info("Browser manager initialized with all engines")
    
    async def shutdown(self):
        """Shutdown the browser manager."""
        if self._playwright:
            await self._playwright.stop()
            self._playwright = None
            self._browser_types = {}
            self.logger.info("Browser manager shutdown complete")
    
    def get_browser_launch_args(self, engine: str) -> Dict[str, Any]:
        """Get optimized launch arguments for each browser engine."""
        
        # Common arguments that work across all browsers
        common_args = {
            "headless": True,
            "timeout": 60000  # 60 seconds timeout
        }
        
        if engine == "chromium":
            return {
                **common_args,
                "args": [
                    '--disable-gpu',  # Disable GPU hardware acceleration
                    '--disable-dev-shm-usage',  # Overcome limited resource problems
                    '--disable-setuid-sandbox',  # Disable setuid sandbox (performance)
                    '--no-sandbox',  # Disable sandbox for better performance
                    '--no-zygote',  # Disable zygote process
                    '--disable-extensions',  # Disable extensions for performance
                    '--disable-features=site-per-process',  # Disable site isolation
                    '--disable-notifications',  # Disable notifications
                    '--disable-popup-blocking',  # Disable popup blocking
                    '--disable-sync',  # Disable sync
                    '--disable-translate',  # Disable translate
                    '--disable-web-security',  # Disable web security for complex sites
                    '--disable-background-networking',  # Reduce background activity
                    '--disable-default-apps',  # Disable default apps
                    '--disable-prompt-on-repost',  # Disable prompt on repost
                    '--disable-domain-reliability',  # Disable domain reliability
                    '--metrics-recording-only',  # Metrics recording only
                    '--mute-audio',  # Mute audio
                    '--no-first-run',  # No first run dialog
                ]
            }
        
        elif engine == "firefox":
            return {
                **common_args,
                "args": [
                    '-headless',  # Firefox headless mode
                    '--no-remote',  # Don't use existing Firefox instance
                    '--safe-mode',  # Start in safe mode (no extensions)
                ]
            }
        
        elif engine == "webkit":
            return {
                **common_args,
                "args": [
                    '--headless',  # WebKit headless mode
                ]
            }
        
        else:
            # Default to chromium args
            return self.get_browser_launch_args("chromium")
    
    async def launch_browser(self, engine: str) -> Optional[Browser]:
        """Launch a browser instance for the specified engine."""
        try:
            await self.initialize()
            
            # Validate engine
            valid_engine = settings.validate_browser_engine() if engine == settings.browser_engine else engine
            if valid_engine not in self._browser_types:
                self.logger.error(f"Unsupported browser engine: {engine}")
                return None
            
            # Get browser type and launch args
            browser_type = self._browser_types[valid_engine]
            launch_args = self.get_browser_launch_args(valid_engine)
            
            # Launch browser
            browser = await browser_type.launch(**launch_args)
            
            self.logger.info(f"Successfully launched {valid_engine} browser", {
                "engine": valid_engine,
                "launch_args": launch_args
            })
            
            return browser
            
        except Exception as e:
            self.logger.error(f"Failed to launch {engine} browser: {str(e)}", {
                "engine": engine,
                "error": str(e),
                "error_type": type(e).__name__
            })
            return None
    
    def get_engine_capabilities(self, engine: str) -> Dict[str, Any]:
        """Get capabilities and limitations for each browser engine."""
        capabilities = {
            "chromium": {
                "name": "Chromium",
                "rendering_engine": "Blink",
                "supports_extensions": True,
                "supports_pdf": True,
                "supports_webgl": True,
                "memory_usage": "high",
                "performance": "excellent",
                "web_standards": "latest",
                "mobile_emulation": True,
                "devtools": True
            },
            "firefox": {
                "name": "Firefox",
                "rendering_engine": "Gecko",
                "supports_extensions": False,  # In Playwright context
                "supports_pdf": True,
                "supports_webgl": True,
                "memory_usage": "medium",
                "performance": "good",
                "web_standards": "good",
                "mobile_emulation": True,
                "devtools": True
            },
            "webkit": {
                "name": "WebKit",
                "rendering_engine": "WebKit",
                "supports_extensions": False,
                "supports_pdf": True,
                "supports_webgl": True,
                "memory_usage": "low",
                "performance": "good",
                "web_standards": "good",
                "mobile_emulation": True,
                "devtools": True
            }
        }
        
        return capabilities.get(engine, capabilities["chromium"])
    
    def get_recommended_engine_for_url(self, url: str) -> str:
        """Get recommended browser engine based on URL characteristics."""
        # This is a simple heuristic - can be enhanced with more sophisticated logic
        url_lower = url.lower()
        
        # Apple/Safari-specific sites might work better with WebKit
        if any(domain in url_lower for domain in ['apple.com', 'icloud.com', 'safari']):
            return "webkit"
        
        # Mozilla/Firefox-specific sites
        if any(domain in url_lower for domain in ['mozilla.org', 'firefox.com']):
            return "firefox"
        
        # For most sites, Chromium provides the best compatibility
        return "chromium"
    
    async def get_browser_info(self, engine: str) -> Dict[str, Any]:
        """Get detailed information about a browser engine."""
        try:
            await self.initialize()
            
            if engine not in self._browser_types:
                return {"error": f"Unsupported engine: {engine}"}
            
            browser_type = self._browser_types[engine]
            capabilities = self.get_engine_capabilities(engine)
            
            return {
                "engine": engine,
                "name": capabilities["name"],
                "rendering_engine": capabilities["rendering_engine"],
                "capabilities": capabilities,
                "available": True,
                "launch_args": self.get_browser_launch_args(engine)
            }
            
        except Exception as e:
            return {
                "engine": engine,
                "available": False,
                "error": str(e)
            }


# Global browser manager instance
browser_manager = BrowserManager()
