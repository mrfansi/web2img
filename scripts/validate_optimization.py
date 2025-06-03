#!/usr/bin/env python3
"""
Web2img Optimization Validation Script

This script validates that the timeout prevention optimizations are properly configured
without requiring browser dependencies to be running.
"""

import os
import sys
import psutil
from pathlib import Path

# Add the app directory to the Python path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.core.config import settings


class OptimizationValidator:
    """Validates optimization configurations."""
    
    def __init__(self):
        self.issues = []
        self.recommendations = []
        self.optimizations_validated = []
    
    def validate_all(self):
        """Validate all optimization configurations."""
        print("🔍 Validating Web2img Timeout Prevention Optimizations")
        print("=" * 60)
        
        self._validate_browser_pool()
        self._validate_cache_settings()
        self._validate_resource_blocking()
        self._validate_timeout_settings()
        self._validate_system_resources()
        self._validate_retry_settings()
        
        self._print_results()
    
    def _validate_browser_pool(self):
        """Validate browser pool configuration."""
        print("\n📊 Browser Pool Configuration")
        print("-" * 30)
        
        min_size = settings.browser_pool_min_size
        max_size = settings.browser_pool_max_size
        idle_timeout = settings.browser_pool_idle_timeout
        max_age = settings.browser_pool_max_age
        
        print(f"Min size: {min_size}")
        print(f"Max size: {max_size}")
        print(f"Idle timeout: {idle_timeout}s")
        print(f"Max age: {max_age}s")
        
        # Validate for high concurrency
        if max_size < 32:
            self.issues.append(f"Browser pool max size ({max_size}) is low for 2000+ concurrent requests")
            self.recommendations.append("Set BROWSER_POOL_MAX_SIZE=64 or higher")
        else:
            self.optimizations_validated.append("✅ Browser pool max size optimized for high concurrency")
        
        if min_size < 8:
            self.issues.append(f"Browser pool min size ({min_size}) is low for high concurrency")
            self.recommendations.append("Set BROWSER_POOL_MIN_SIZE=16 or higher")
        else:
            self.optimizations_validated.append("✅ Browser pool min size optimized")
        
        if idle_timeout > 300:
            self.issues.append(f"Browser idle timeout ({idle_timeout}s) is high, may cause memory issues")
            self.recommendations.append("Set BROWSER_POOL_IDLE_TIMEOUT=180 or lower")
        else:
            self.optimizations_validated.append("✅ Browser idle timeout optimized")
    
    def _validate_cache_settings(self):
        """Validate cache configuration."""
        print("\n💾 Cache Configuration")
        print("-" * 22)
        
        cache_enabled = settings.browser_cache_enabled
        cache_all_content = getattr(settings, 'browser_cache_all_content', False)
        cache_max_size = getattr(settings, 'browser_cache_max_size_mb', 500)
        
        print(f"Cache enabled: {cache_enabled}")
        print(f"Cache all content: {cache_all_content}")
        print(f"Max cache size: {cache_max_size}MB")
        
        if not cache_enabled:
            self.issues.append("Browser cache is disabled")
            self.recommendations.append("Set BROWSER_CACHE_ENABLED=true to prevent resource loading timeouts")
        else:
            self.optimizations_validated.append("✅ Browser cache enabled")
        
        if not cache_all_content:
            self.issues.append("Browser cache all content is disabled")
            self.recommendations.append("Set BROWSER_CACHE_ALL_CONTENT=true to prevent domcontentloaded timeouts")
        else:
            self.optimizations_validated.append("✅ Aggressive caching enabled (prevents domcontentloaded timeouts)")
        
        if cache_max_size < 500:
            self.issues.append(f"Cache size ({cache_max_size}MB) may be too small for high concurrency")
            self.recommendations.append("Set BROWSER_CACHE_MAX_SIZE_MB=1000 or higher")
        else:
            self.optimizations_validated.append("✅ Cache size optimized for high concurrency")
    
    def _validate_resource_blocking(self):
        """Validate resource blocking configuration."""
        print("\n🚫 Resource Blocking Configuration")
        print("-" * 35)
        
        blocking_config = {
            "fonts": getattr(settings, 'disable_fonts', False),
            "media": getattr(settings, 'disable_media', False),
            "analytics": getattr(settings, 'disable_analytics', False),
            "third_party": getattr(settings, 'disable_third_party_scripts', False),
            "ads": getattr(settings, 'disable_ads', False),
            "social": getattr(settings, 'disable_social_widgets', False)
        }
        
        for resource_type, enabled in blocking_config.items():
            status = "✅ Enabled" if enabled else "❌ Disabled"
            print(f"{resource_type.capitalize()} blocking: {status}")
        
        # Check critical blocking for timeout prevention
        critical_blocks = ['fonts', 'media', 'analytics', 'third_party', 'ads']
        missing_blocks = [block for block in critical_blocks if not blocking_config[block]]
        
        if missing_blocks:
            self.issues.append(f"Critical resource blocking disabled: {', '.join(missing_blocks)}")
            for block in missing_blocks:
                self.recommendations.append(f"Set DISABLE_{block.upper()}=true to prevent timeouts")
        else:
            self.optimizations_validated.append("✅ Critical resource blocking enabled (prevents third-party timeouts)")
    
    def _validate_timeout_settings(self):
        """Validate timeout configuration."""
        print("\n⏱️  Timeout Configuration")
        print("-" * 25)
        
        nav_timeout = settings.navigation_timeout_regular
        screenshot_timeout = settings.screenshot_timeout
        context_timeout = settings.browser_context_timeout
        
        print(f"Navigation timeout: {nav_timeout}ms")
        print(f"Screenshot timeout: {screenshot_timeout}ms")
        print(f"Context timeout: {context_timeout}ms")
        
        # These timeouts are kept reasonable, not increased
        if nav_timeout <= 30000:
            self.optimizations_validated.append("✅ Navigation timeout kept reasonable (not artificially increased)")
        
        if screenshot_timeout <= 30000:
            self.optimizations_validated.append("✅ Screenshot timeout kept reasonable")
        
        if context_timeout <= 30000:
            self.optimizations_validated.append("✅ Context timeout kept reasonable")
    
    def _validate_retry_settings(self):
        """Validate retry configuration."""
        print("\n🔄 Retry Configuration")
        print("-" * 21)
        
        max_retries = settings.max_retries_regular
        base_delay = settings.retry_base_delay
        max_delay = settings.retry_max_delay
        
        print(f"Max retries: {max_retries}")
        print(f"Base delay: {base_delay}s")
        print(f"Max delay: {max_delay}s")
        
        if max_retries <= 5:
            self.optimizations_validated.append("✅ Retry count optimized (fast failure detection)")
        
        if base_delay <= 1.0:
            self.optimizations_validated.append("✅ Retry delay optimized for responsiveness")
    
    def _validate_system_resources(self):
        """Validate system resources."""
        print("\n🖥️  System Resources")
        print("-" * 18)
        
        try:
            # Memory check
            memory = psutil.virtual_memory()
            available_gb = memory.available / (1024**3)
            total_gb = memory.total / (1024**3)
            
            print(f"Total memory: {total_gb:.1f} GB")
            print(f"Available memory: {available_gb:.1f} GB")
            
            if available_gb < 4:
                self.issues.append(f"Low available memory ({available_gb:.1f} GB)")
                self.recommendations.append("Consider increasing memory for high concurrency")
            elif available_gb >= 8:
                self.optimizations_validated.append("✅ Sufficient memory for high concurrency")
            
            # CPU check
            cpu_count = psutil.cpu_count()
            print(f"CPU cores: {cpu_count}")
            
            if cpu_count < 4:
                self.issues.append(f"Low CPU core count ({cpu_count})")
                self.recommendations.append("Consider increasing CPU cores for high concurrency")
            elif cpu_count >= 8:
                self.optimizations_validated.append("✅ Sufficient CPU cores for high concurrency")
            
            # Disk space check
            disk = psutil.disk_usage('/')
            free_gb = disk.free / (1024**3)
            print(f"Free disk space: {free_gb:.1f} GB")
            
            if free_gb < 10:
                self.issues.append(f"Low disk space ({free_gb:.1f} GB)")
                self.recommendations.append("Ensure sufficient disk space for cache and temp files")
            else:
                self.optimizations_validated.append("✅ Sufficient disk space")
                
        except Exception as e:
            print(f"Could not check system resources: {e}")
    
    def _print_results(self):
        """Print validation results."""
        print("\n" + "=" * 60)
        print("📋 VALIDATION RESULTS")
        print("=" * 60)
        
        print(f"\n✅ Optimizations Validated ({len(self.optimizations_validated)}):")
        for opt in self.optimizations_validated:
            print(f"  {opt}")
        
        if self.issues:
            print(f"\n⚠️  Issues Found ({len(self.issues)}):")
            for issue in self.issues:
                print(f"  ❌ {issue}")
        
        if self.recommendations:
            print(f"\n💡 Recommendations ({len(self.recommendations)}):")
            for rec in self.recommendations:
                print(f"  🔧 {rec}")
        
        # Overall assessment
        print(f"\n🎯 OVERALL ASSESSMENT:")
        total_checks = len(self.optimizations_validated) + len(self.issues)
        success_rate = len(self.optimizations_validated) / max(total_checks, 1) * 100
        
        if success_rate >= 90:
            print("🟢 EXCELLENT - System is well optimized for high concurrency")
        elif success_rate >= 75:
            print("🟡 GOOD - Most optimizations applied, minor improvements needed")
        elif success_rate >= 50:
            print("🟠 FAIR - Some optimizations applied, significant improvements recommended")
        else:
            print("🔴 POOR - Major optimizations needed for high concurrency")
        
        print(f"Success rate: {success_rate:.1f}%")
        
        if not self.issues:
            print("\n🚀 Ready for high concurrency deployment!")
        else:
            print(f"\n📝 Apply {len(self.recommendations)} recommendations for optimal performance")


def main():
    """Main validation function."""
    validator = OptimizationValidator()
    validator.validate_all()


if __name__ == "__main__":
    main()
