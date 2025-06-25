#!/usr/bin/env python3
"""
Simple script to check configuration values.
"""

import os
import sys
from pathlib import Path

# Add the app directory to the Python path
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv

# Load environment variables
load_dotenv()

print("=== Environment Variables ===")
config_vars = [
    "BROWSER_POOL_MIN_SIZE",
    "BROWSER_POOL_MAX_SIZE", 
    "MAX_TABS_PER_BROWSER",
    "MAX_CONCURRENT_SCREENSHOTS",
    "DISABLE_BROWSER_CLEANUP",
    "DISABLE_BROWSER_RECYCLING",
]

for var in config_vars:
    value = os.getenv(var, "NOT_SET")
    print(f"{var}: {value}")

print("\n=== Settings Object ===")
try:
    from app.core.config import settings
    print(f"browser_pool_min_size: {settings.browser_pool_min_size}")
    print(f"browser_pool_max_size: {settings.browser_pool_max_size}")
    print(f"max_tabs_per_browser: {settings.max_tabs_per_browser}")
    print(f"max_concurrent_screenshots: {settings.max_concurrent_screenshots}")
    print(f"disable_browser_cleanup: {settings.disable_browser_cleanup}")
    print(f"disable_browser_recycling: {settings.disable_browser_recycling}")
except Exception as e:
    print(f"Error loading settings: {e}")
