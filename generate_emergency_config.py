#!/usr/bin/env python3
"""
Emergency Configuration Generator for web2img Production Issues
Generates optimized environment variables based on stress test results
"""

from typing import Dict, Any

class EmergencyConfigGenerator:
    def __init__(self):
        self.current_issues = [
            "100% timeout rate on screenshot endpoint",
            "Browser context creation timeouts",
            "Resource exhaustion under load",
            "DNS/connectivity issues under stress"
        ]
    
    def generate_emergency_config(self) -> Dict[str, Any]:
        """Generate emergency configuration to resolve timeout issues."""
        return {
            # Browser Pool - Reduced to prevent resource exhaustion
            "BROWSER_POOL_MIN_SIZE": "4",
            "BROWSER_POOL_MAX_SIZE": "16",  # Reduced from 64
            "BROWSER_POOL_IDLE_TIMEOUT": "60",  # Reduced from 180
            "BROWSER_POOL_MAX_AGE": "600",  # Reduced from 1800
            "BROWSER_POOL_CLEANUP_INTERVAL": "15",  # Reduced from 30
            
            # Context Creation - Increased timeouts
            "CONTEXT_CREATION_TIMEOUT": "60000",  # Increased from 30000
            "BROWSER_CONTEXT_TIMEOUT": "60000",  # Increased from 30000
            "PAGE_CREATION_TIMEOUT": "60000",  # Increased from 30000
            "BROWSER_LAUNCH_TIMEOUT": "45000",  # Increased from 30000
            
            # Navigation - Increased for problematic pages
            "NAVIGATION_TIMEOUT_REGULAR": "45000",  # Increased from 20000
            "NAVIGATION_TIMEOUT_COMPLEX": "90000",  # Increased from 45000
            "SCREENSHOT_TIMEOUT": "30000",  # Increased from 20000
            
            # Retries - Reduced to fail faster
            "MAX_RETRIES_REGULAR": "2",  # Reduced from 3
            "MAX_RETRIES_COMPLEX": "3",  # Keep same
            "RETRY_BASE_DELAY": "2000",  # Increased from 1000
            "RETRY_MAX_DELAY": "10000",  # Increased from 5000
            
            # Circuit Breaker - More tolerant
            "CIRCUIT_BREAKER_THRESHOLD": "10",  # Increased from 8
            "CIRCUIT_BREAKER_RESET_TIME": "300",  # Increased from 180
            
            # Resource Management
            "DISABLE_IMAGES": "false",  # Keep images for accuracy
            "DISABLE_JAVASCRIPT": "false",  # Keep JS for mini-rsvp pages
            "BROWSER_CACHE_ALL_CONTENT": "true",  # Enable aggressive caching
            
            # Concurrency Control - NEW IMPLEMENTATION
            "MAX_CONCURRENT_SCREENSHOTS": "8",  # Limit concurrent screenshot operations
            "MAX_CONCURRENT_CONTEXTS": "16",    # Limit concurrent browser contexts

            # Performance Optimizations
            "WORKERS": "4",  # Limit workers to prevent overload

            # Emergency Features - ENHANCED IMPLEMENTATION
            "ENABLE_EMERGENCY_CONTEXT": "true",
            "FORCE_EMERGENCY_ON_TIMEOUT": "true",
            "EMERGENCY_CONTEXT_TIMEOUT": "10000",  # 10 seconds for emergency context
            
            # Logging
            "LOG_LEVEL": "INFO",
            "ENABLE_PERFORMANCE_LOGGING": "true",
            "LOG_BROWSER_POOL_STATS": "true"
        }
    
    def generate_optimized_config(self) -> Dict[str, Any]:
        """Generate optimized configuration for better performance."""
        return {
            # Browser Pool - Balanced for performance
            "BROWSER_POOL_MIN_SIZE": "8",
            "BROWSER_POOL_MAX_SIZE": "32",  # Moderate size
            "BROWSER_POOL_IDLE_TIMEOUT": "120",
            "BROWSER_POOL_MAX_AGE": "1200",
            "BROWSER_POOL_CLEANUP_INTERVAL": "20",
            
            # Context Creation - Balanced timeouts
            "CONTEXT_CREATION_TIMEOUT": "45000",
            "BROWSER_CONTEXT_TIMEOUT": "45000",
            "PAGE_CREATION_TIMEOUT": "45000",
            "BROWSER_LAUNCH_TIMEOUT": "40000",
            
            # Navigation - Optimized for mixed workload
            "NAVIGATION_TIMEOUT_REGULAR": "30000",
            "NAVIGATION_TIMEOUT_COMPLEX": "60000",
            "SCREENSHOT_TIMEOUT": "25000",
            
            # Retries - Balanced approach
            "MAX_RETRIES_REGULAR": "3",
            "MAX_RETRIES_COMPLEX": "4",
            "RETRY_BASE_DELAY": "1500",
            "RETRY_MAX_DELAY": "8000",
            
            # Circuit Breaker - Responsive
            "CIRCUIT_BREAKER_THRESHOLD": "6",
            "CIRCUIT_BREAKER_RESET_TIME": "240",
            
            # Resource Management
            "DISABLE_IMAGES": "false",
            "DISABLE_JAVASCRIPT": "false",
            "BROWSER_CACHE_ALL_CONTENT": "true",
            
            # Concurrency Control - OPTIMIZED
            "MAX_CONCURRENT_SCREENSHOTS": "12",  # Higher limit for optimized performance
            "MAX_CONCURRENT_CONTEXTS": "24",     # Higher limit for optimized performance

            # Performance
            "WORKERS": "6",

            # Emergency Features - OPTIMIZED
            "ENABLE_EMERGENCY_CONTEXT": "true",
            "FORCE_EMERGENCY_ON_TIMEOUT": "false",
            "EMERGENCY_CONTEXT_TIMEOUT": "15000",  # 15 seconds for optimized emergency context
            
            # Logging
            "LOG_LEVEL": "INFO",
            "ENABLE_PERFORMANCE_LOGGING": "true",
            "LOG_BROWSER_POOL_STATS": "true"
        }
    
    def print_config(self, config: Dict[str, Any], title: str):
        """Print configuration in a readable format."""
        print(f"\n{'='*60}")
        print(f"{title}")
        print(f"{'='*60}")
        
        categories = {
            "Browser Pool": ["BROWSER_POOL_", "BROWSER_LAUNCH_", "BROWSER_CONTEXT_"],
            "Timeouts": ["TIMEOUT", "CONTEXT_CREATION", "PAGE_CREATION"],
            "Retries": ["RETRY", "MAX_RETRIES"],
            "Circuit Breaker": ["CIRCUIT_BREAKER"],
            "Concurrency Control": ["MAX_CONCURRENT_SCREENSHOTS", "MAX_CONCURRENT_CONTEXTS"],
            "Performance": ["WORKERS", "DISABLE_"],
            "Emergency Features": ["ENABLE_EMERGENCY", "FORCE_EMERGENCY", "EMERGENCY_CONTEXT"],
            "Caching": ["CACHE", "BROWSER_CACHE"],
            "Logging": ["LOG_", "ENABLE_PERFORMANCE"]
        }
        
        for category, prefixes in categories.items():
            category_vars = []
            for key, value in config.items():
                if any(key.startswith(prefix) for prefix in prefixes):
                    category_vars.append((key, value))
            
            if category_vars:
                print(f"\n# {category}")
                for key, value in sorted(category_vars):
                    print(f"{key}={value}")
    
    def generate_docker_env_file(self, config: Dict[str, Any], filename: str):
        """Generate a .env file for Docker deployment."""
        with open(filename, 'w') as f:
            f.write("# Emergency Configuration for web2img Production Issues\n")
            f.write("# Generated to resolve timeout and browser context creation issues\n\n")
            
            for key, value in sorted(config.items()):
                f.write(f"{key}={value}\n")
        
        print(f"\n✅ Configuration saved to {filename}")
        print(f"💡 Apply this configuration to your production environment")
        print(f"🔄 Restart the service after applying the configuration")

def main():
    generator = EmergencyConfigGenerator()
    
    print("🚨 web2img Production Emergency Configuration Generator")
    print("\nCurrent Issues Detected:")
    for issue in generator.current_issues:
        print(f"  ❌ {issue}")
    
    # Generate emergency configuration
    emergency_config = generator.generate_emergency_config()
    generator.print_config(emergency_config, "🚨 EMERGENCY CONFIGURATION (Apply Immediately)")
    
    # Generate optimized configuration
    optimized_config = generator.generate_optimized_config()
    generator.print_config(optimized_config, "⚡ OPTIMIZED CONFIGURATION (Apply After Emergency)")
    
    # Generate .env files
    generator.generate_docker_env_file(emergency_config, "emergency.env")
    generator.generate_docker_env_file(optimized_config, "optimized.env")
    
    print(f"\n{'='*60}")
    print("📋 IMPLEMENTATION STEPS")
    print(f"{'='*60}")
    print("1. 🚨 Apply emergency.env configuration immediately")
    print("2. 🔄 Restart your web2img service")
    print("3. 🧪 Run: ./run_production_stress_test.sh health")
    print("4. 🧪 Run: ./run_production_stress_test.sh light")
    print("5. 📊 Monitor for 1-2 hours")
    print("6. ⚡ Apply optimized.env if emergency config works")
    print("7. 📈 Gradually increase load testing")
    
    print(f"\n{'='*60}")
    print("🎯 EXPECTED IMPROVEMENTS")
    print(f"{'='*60}")
    print("• Timeout rate: 100% → <20%")
    print("• Response time: 180s → <30s")
    print("• Browser pool stability: Improved")
    print("• Resource utilization: Optimized")
    
    print(f"\n{'='*60}")
    print("⚠️  MONITORING")
    print(f"{'='*60}")
    print("Watch for these improvements in production logs:")
    print("• Fewer 'Timeout with normal strategy' messages")
    print("• More 'Successfully launched browser' messages")
    print("• Reduced 'Emergency context creation' usage")
    print("• Faster screenshot completion times")

if __name__ == "__main__":
    main()
