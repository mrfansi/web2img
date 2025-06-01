#!/usr/bin/env python3
"""
Configuration validation script for web2img.

This script helps validate that your configuration is properly set up
and shows you the current values being used.
"""

import os
import sys
from pathlib import Path

# Add the app directory to the Python path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.core.config import settings


def print_header(title: str):
    """Print a formatted header."""
    print(f"\n{'='*60}")
    print(f" {title}")
    print(f"{'='*60}")


def print_config_section(title: str, configs: dict):
    """Print a configuration section."""
    print(f"\n{title}:")
    print("-" * len(title))
    for key, value in configs.items():
        print(f"  {key}: {value}")


def validate_timeout_settings():
    """Validate timeout settings and provide recommendations."""
    print_header("TIMEOUT CONFIGURATION VALIDATION")
    
    timeout_configs = {
        "navigation_timeout_regular": settings.navigation_timeout_regular,
        "navigation_timeout_complex": settings.navigation_timeout_complex,
        "browser_launch_timeout": settings.browser_launch_timeout,
        "context_creation_timeout": settings.context_creation_timeout,
        "page_creation_timeout": settings.page_creation_timeout,
        "screenshot_timeout": settings.screenshot_timeout,
    }
    
    print_config_section("Current Timeout Settings (ms)", timeout_configs)
    
    # Provide recommendations
    print("\nRECOMMENDATIONS:")
    if settings.navigation_timeout_regular > 10000:
        print("  ⚠️  navigation_timeout_regular is high (>10s). Consider reducing to 8000ms for faster failure detection.")
    else:
        print("  ✅ navigation_timeout_regular is optimized for fast failure detection.")
    
    if settings.max_retries_regular > 2:
        print("  ⚠️  max_retries_regular is high (>2). Consider reducing to 1 for faster responses.")
    else:
        print("  ✅ max_retries_regular is optimized for fast responses.")


def validate_retry_settings():
    """Validate retry settings."""
    print_header("RETRY CONFIGURATION VALIDATION")
    
    retry_configs = {
        "max_retries_regular": settings.max_retries_regular,
        "max_retries_complex": settings.max_retries_complex,
        "retry_base_delay": settings.retry_base_delay,
        "retry_max_delay": settings.retry_max_delay,
        "retry_jitter": settings.retry_jitter,
    }
    
    print_config_section("Current Retry Settings", retry_configs)
    
    # Calculate total potential wait time
    total_wait = (settings.navigation_timeout_regular * settings.max_retries_regular) / 1000
    print(f"\nMaximum potential wait time per request: {total_wait:.1f} seconds")
    
    if total_wait > 20:
        print("  ⚠️  Total wait time is high. Consider reducing timeouts or retries.")
    else:
        print("  ✅ Total wait time is reasonable for production.")


def validate_performance_settings():
    """Validate performance optimization settings."""
    print_header("PERFORMANCE OPTIMIZATION VALIDATION")
    
    perf_configs = {
        "disable_images": settings.disable_images,
        "disable_javascript": settings.disable_javascript,
        "disable_css": settings.disable_css,
        "disable_fonts": settings.disable_fonts,
        "disable_media": settings.disable_media,
        "disable_analytics": settings.disable_analytics,
    }
    
    print_config_section("Current Performance Settings", perf_configs)
    
    print("\nRECOMMENDATIONS:")
    if not settings.disable_fonts:
        print("  ⚠️  Fonts are enabled. Disabling fonts can improve loading speed.")
    else:
        print("  ✅ Fonts are disabled for faster loading.")
    
    if not settings.disable_media:
        print("  ⚠️  Media files are enabled. Disabling media can reduce timeouts.")
    else:
        print("  ✅ Media files are disabled for faster loading.")
    
    if not settings.disable_analytics:
        print("  ⚠️  Analytics are enabled. Disabling analytics can improve performance.")
    else:
        print("  ✅ Analytics are disabled for better performance.")
    
    if settings.disable_images:
        print("  ⚠️  Images are disabled. This may affect screenshot quality.")
    else:
        print("  ✅ Images are enabled for proper screenshots.")


def validate_browser_pool_settings():
    """Validate browser pool settings."""
    print_header("BROWSER POOL CONFIGURATION VALIDATION")
    
    pool_configs = {
        "browser_pool_min_size": settings.browser_pool_min_size,
        "browser_pool_max_size": settings.browser_pool_max_size,
        "browser_pool_idle_timeout": settings.browser_pool_idle_timeout,
        "browser_pool_max_age": settings.browser_pool_max_age,
        "browser_pool_cleanup_interval": settings.browser_pool_cleanup_interval,
    }
    
    print_config_section("Current Browser Pool Settings", pool_configs)
    
    print("\nRECOMMENDATIONS:")
    if settings.browser_pool_max_size < 8:
        print("  ⚠️  Browser pool size is small. Consider increasing for higher concurrency.")
    elif settings.browser_pool_max_size > 15:
        print("  ⚠️  Browser pool size is large. This may consume too much memory.")
    else:
        print("  ✅ Browser pool size is well-balanced.")


def validate_circuit_breaker_settings():
    """Validate circuit breaker settings."""
    print_header("CIRCUIT BREAKER CONFIGURATION VALIDATION")
    
    cb_configs = {
        "circuit_breaker_threshold": settings.circuit_breaker_threshold,
        "circuit_breaker_reset_time": settings.circuit_breaker_reset_time,
    }
    
    print_config_section("Current Circuit Breaker Settings", cb_configs)
    
    print("\nRECOMMENDATIONS:")
    if settings.circuit_breaker_threshold < 5:
        print("  ⚠️  Circuit breaker threshold is low. May open too frequently.")
    elif settings.circuit_breaker_threshold > 15:
        print("  ⚠️  Circuit breaker threshold is high. May not protect against failures.")
    else:
        print("  ✅ Circuit breaker threshold is well-balanced.")


def show_environment_variables():
    """Show relevant environment variables."""
    print_header("ENVIRONMENT VARIABLES")
    
    env_vars = [
        "NAVIGATION_TIMEOUT_REGULAR",
        "MAX_RETRIES_REGULAR",
        "DISABLE_FONTS",
        "DISABLE_MEDIA",
        "DISABLE_ANALYTICS",
        "BROWSER_POOL_MAX_SIZE",
        "CIRCUIT_BREAKER_THRESHOLD",
    ]
    
    print("Environment variables (if set):")
    for var in env_vars:
        value = os.getenv(var)
        if value:
            print(f"  {var}={value}")
        else:
            print(f"  {var}=<not set, using default>")


def main():
    """Main validation function."""
    print_header("WEB2IMG CONFIGURATION VALIDATION")
    print("This script validates your current configuration and provides recommendations.")
    
    try:
        validate_timeout_settings()
        validate_retry_settings()
        validate_performance_settings()
        validate_browser_pool_settings()
        validate_circuit_breaker_settings()
        show_environment_variables()
        
        print_header("SUMMARY")
        print("✅ Configuration validation completed!")
        print("\nTo apply the optimized production configuration:")
        print("  cp .env.production .env")
        print("  docker-compose down && docker-compose up -d")
        
        print("\nTo monitor the improvements:")
        print("  docker logs -f web2img | grep 'Navigation succeeded\\|timeout\\|retry'")
        
    except Exception as e:
        print(f"❌ Error during validation: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
