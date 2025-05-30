#!/usr/bin/env python3
"""
Performance optimization script for web2img.

This script analyzes the current configuration and provides recommendations
for optimizing performance based on system resources and usage patterns.
"""

import os
import sys
import psutil
import asyncio
from pathlib import Path

# Add the project root to the Python path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("performance_optimizer")


class PerformanceOptimizer:
    """Analyzes system resources and provides optimization recommendations."""
    
    def __init__(self):
        self.cpu_count = psutil.cpu_count()
        self.memory_gb = psutil.virtual_memory().total / (1024**3)
        self.available_memory_gb = psutil.virtual_memory().available / (1024**3)
        
    def analyze_system_resources(self):
        """Analyze current system resources."""
        logger.info("Analyzing system resources...")
        
        system_info = {
            "cpu_count": self.cpu_count,
            "memory_total_gb": round(self.memory_gb, 2),
            "memory_available_gb": round(self.available_memory_gb, 2),
            "memory_usage_percent": psutil.virtual_memory().percent,
            "disk_usage_percent": psutil.disk_usage('/').percent
        }
        
        logger.info("System resources", system_info)
        return system_info
    
    def get_browser_pool_recommendations(self):
        """Get browser pool size recommendations based on system resources."""
        # Each browser instance typically uses 100-200MB of RAM
        # Reserve 2GB for the system and other processes
        available_for_browsers = max(0, self.available_memory_gb - 2)
        max_browsers_by_memory = int(available_for_browsers / 0.15)  # 150MB per browser
        
        # CPU-based recommendation (1-2 browsers per CPU core)
        max_browsers_by_cpu = self.cpu_count * 2
        
        # Take the minimum to avoid resource exhaustion
        recommended_max = min(max_browsers_by_memory, max_browsers_by_cpu, 20)
        recommended_min = max(2, min(recommended_max // 4, 5))
        
        return {
            "min_size": recommended_min,
            "max_size": recommended_max,
            "current_min": settings.browser_pool_min_size,
            "current_max": settings.browser_pool_max_size
        }
    
    def get_timeout_recommendations(self):
        """Get timeout recommendations based on system performance."""
        # Adjust timeouts based on available memory and CPU
        memory_factor = min(1.5, self.available_memory_gb / 4)  # Scale with available memory
        cpu_factor = min(1.5, self.cpu_count / 4)  # Scale with CPU count
        
        performance_factor = (memory_factor + cpu_factor) / 2
        
        base_navigation_timeout = 20000
        base_browser_timeout = 30000
        
        recommended_navigation = int(base_navigation_timeout * performance_factor)
        recommended_browser = int(base_browser_timeout * performance_factor)
        
        return {
            "navigation_timeout_regular": recommended_navigation,
            "navigation_timeout_complex": recommended_navigation * 2,
            "browser_launch_timeout": recommended_browser,
            "context_creation_timeout": recommended_browser // 2,
            "screenshot_timeout": recommended_navigation
        }
    
    def get_worker_recommendations(self):
        """Get worker process recommendations."""
        # For I/O bound applications like web2img, we can use more workers
        # than CPU cores, but not too many to avoid context switching overhead
        recommended_workers = min(self.cpu_count * 2, 8)
        
        return {
            "recommended_workers": recommended_workers,
            "current_workers": settings.workers
        }
    
    def generate_optimized_env(self):
        """Generate an optimized .env file based on system analysis."""
        browser_pool = self.get_browser_pool_recommendations()
        timeouts = self.get_timeout_recommendations()
        workers = self.get_worker_recommendations()
        
        env_content = f"""# Optimized web2img Configuration
# Generated based on system analysis

# Server Configuration
WORKERS={workers['recommended_workers']}

# Browser Pool Configuration - Optimized for your system
BROWSER_POOL_MIN_SIZE={browser_pool['min_size']}
BROWSER_POOL_MAX_SIZE={browser_pool['max_size']}
BROWSER_POOL_IDLE_TIMEOUT=300
BROWSER_POOL_MAX_AGE=3600
BROWSER_POOL_CLEANUP_INTERVAL=60

# Timeout Configuration - Optimized for your system performance
NAVIGATION_TIMEOUT_REGULAR={timeouts['navigation_timeout_regular']}
NAVIGATION_TIMEOUT_COMPLEX={timeouts['navigation_timeout_complex']}
BROWSER_LAUNCH_TIMEOUT={timeouts['browser_launch_timeout']}
CONTEXT_CREATION_TIMEOUT={timeouts['context_creation_timeout']}
SCREENSHOT_TIMEOUT={timeouts['screenshot_timeout']}

# Retry Configuration - Optimized for better performance
MAX_RETRIES_REGULAR=3
MAX_RETRIES_COMPLEX=5
RETRY_BASE_DELAY=0.5
RETRY_MAX_DELAY=10.0
RETRY_JITTER=0.1

# Circuit Breaker Configuration - Optimized for better resilience
CIRCUIT_BREAKER_THRESHOLD=5
CIRCUIT_BREAKER_RESET_TIME=300

# Cache Configuration
CACHE_ENABLED=True
CACHE_TTL_SECONDS=3600
CACHE_MAX_ITEMS=100
"""
        
        return env_content
    
    def print_recommendations(self):
        """Print optimization recommendations."""
        system_info = self.analyze_system_resources()
        browser_pool = self.get_browser_pool_recommendations()
        timeouts = self.get_timeout_recommendations()
        workers = self.get_worker_recommendations()
        
        print("\n" + "="*60)
        print("WEB2IMG PERFORMANCE OPTIMIZATION RECOMMENDATIONS")
        print("="*60)
        
        print(f"\n📊 SYSTEM ANALYSIS:")
        print(f"   CPU Cores: {system_info['cpu_count']}")
        print(f"   Total Memory: {system_info['memory_total_gb']:.1f} GB")
        print(f"   Available Memory: {system_info['memory_available_gb']:.1f} GB")
        print(f"   Memory Usage: {system_info['memory_usage_percent']:.1f}%")
        
        print(f"\n🔧 BROWSER POOL RECOMMENDATIONS:")
        print(f"   Current: min={browser_pool['current_min']}, max={browser_pool['current_max']}")
        print(f"   Recommended: min={browser_pool['min_size']}, max={browser_pool['max_size']}")
        
        print(f"\n⏱️  TIMEOUT RECOMMENDATIONS:")
        print(f"   Navigation (regular): {timeouts['navigation_timeout_regular']}ms")
        print(f"   Navigation (complex): {timeouts['navigation_timeout_complex']}ms")
        print(f"   Browser launch: {timeouts['browser_launch_timeout']}ms")
        
        print(f"\n👥 WORKER RECOMMENDATIONS:")
        print(f"   Current workers: {workers['current_workers']}")
        print(f"   Recommended workers: {workers['recommended_workers']}")
        
        print(f"\n💡 OPTIMIZATION TIPS:")
        print("   1. Use the optimized .env configuration")
        print("   2. Monitor memory usage during peak loads")
        print("   3. Adjust browser pool size based on actual usage")
        print("   4. Enable caching for better performance")
        print("   5. Use load balancing for high-traffic scenarios")
        
        print("\n" + "="*60)


async def main():
    """Main function to run performance optimization analysis."""
    optimizer = PerformanceOptimizer()
    
    # Print recommendations
    optimizer.print_recommendations()
    
    # Generate optimized configuration
    optimized_env = optimizer.generate_optimized_env()
    
    # Ask user if they want to save the optimized configuration
    response = input("\nWould you like to save the optimized configuration to .env.optimized? (y/n): ")
    if response.lower() in ['y', 'yes']:
        with open('.env.optimized', 'w') as f:
            f.write(optimized_env)
        print("✅ Optimized configuration saved to .env.optimized")
        print("   Review the file and copy relevant settings to your .env file")
    
    print("\n🚀 Performance optimization analysis complete!")


if __name__ == "__main__":
    asyncio.run(main())
