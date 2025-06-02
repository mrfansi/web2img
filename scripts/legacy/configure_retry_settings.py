#!/usr/bin/env python3
"""
Script to configure retry settings for web2img based on load requirements.
This script helps optimize retry configurations for different concurrency levels.
"""

import os
import sys
from typing import Dict, Any


def get_retry_config_for_load(concurrent_users: int) -> Dict[str, Any]:
    """Get optimized retry configuration based on expected concurrent load."""
    
    if concurrent_users <= 100:
        # Light load configuration
        return {
            "SCREENSHOT_MAX_RETRIES": "5",
            "SCREENSHOT_BASE_DELAY": "1.0",
            "SCREENSHOT_MAX_DELAY": "10.0",
            "SCREENSHOT_JITTER": "0.3",
            "CIRCUIT_BREAKER_THRESHOLD": "5",
            "CIRCUIT_BREAKER_RESET_TIME": "120",
            "MAX_RETRIES_REGULAR": "3",
            "MAX_RETRIES_COMPLEX": "5"
        }
    elif concurrent_users <= 500:
        # Medium load configuration
        return {
            "SCREENSHOT_MAX_RETRIES": "8",
            "SCREENSHOT_BASE_DELAY": "1.5",
            "SCREENSHOT_MAX_DELAY": "15.0",
            "SCREENSHOT_JITTER": "0.4",
            "CIRCUIT_BREAKER_THRESHOLD": "8",
            "CIRCUIT_BREAKER_RESET_TIME": "180",
            "MAX_RETRIES_REGULAR": "5",
            "MAX_RETRIES_COMPLEX": "8"
        }
    elif concurrent_users <= 1000:
        # High load configuration
        return {
            "SCREENSHOT_MAX_RETRIES": "12",
            "SCREENSHOT_BASE_DELAY": "2.0",
            "SCREENSHOT_MAX_DELAY": "20.0",
            "SCREENSHOT_JITTER": "0.5",
            "CIRCUIT_BREAKER_THRESHOLD": "12",
            "CIRCUIT_BREAKER_RESET_TIME": "240",
            "MAX_RETRIES_REGULAR": "8",
            "MAX_RETRIES_COMPLEX": "12"
        }
    else:
        # Very high load configuration (2000+ concurrent)
        return {
            "SCREENSHOT_MAX_RETRIES": "15",
            "SCREENSHOT_BASE_DELAY": "3.0",
            "SCREENSHOT_MAX_DELAY": "30.0",
            "SCREENSHOT_JITTER": "0.6",
            "CIRCUIT_BREAKER_THRESHOLD": "15",
            "CIRCUIT_BREAKER_RESET_TIME": "300",
            "MAX_RETRIES_REGULAR": "10",
            "MAX_RETRIES_COMPLEX": "15"
        }


def update_env_file(config: Dict[str, str], env_file: str = ".env"):
    """Update environment file with new configuration."""
    
    # Read existing .env file
    env_vars = {}
    if os.path.exists(env_file):
        with open(env_file, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    env_vars[key] = value
    
    # Update with new config
    env_vars.update(config)
    
    # Write back to file
    with open(env_file, 'w') as f:
        f.write("# Web2img Configuration\n")
        f.write("# Auto-generated retry settings\n\n")
        
        # Group related settings
        retry_settings = [k for k in env_vars.keys() if any(x in k for x in ['RETRY', 'SCREENSHOT', 'CIRCUIT'])]
        other_settings = [k for k in env_vars.keys() if k not in retry_settings]
        
        if retry_settings:
            f.write("# Retry and Circuit Breaker Settings\n")
            for key in sorted(retry_settings):
                f.write(f"{key}={env_vars[key]}\n")
            f.write("\n")
        
        if other_settings:
            f.write("# Other Settings\n")
            for key in sorted(other_settings):
                f.write(f"{key}={env_vars[key]}\n")


def print_config_summary(config: Dict[str, str], concurrent_users: int):
    """Print a summary of the configuration."""
    print(f"\n🔧 Retry Configuration for {concurrent_users} Concurrent Users")
    print("=" * 60)
    
    print("\n📊 Screenshot Retry Settings:")
    print(f"  Max Retries: {config['SCREENSHOT_MAX_RETRIES']}")
    print(f"  Base Delay: {config['SCREENSHOT_BASE_DELAY']}s")
    print(f"  Max Delay: {config['SCREENSHOT_MAX_DELAY']}s")
    print(f"  Jitter: {config['SCREENSHOT_JITTER']}")
    
    print("\n🔄 Circuit Breaker Settings:")
    print(f"  Failure Threshold: {config['CIRCUIT_BREAKER_THRESHOLD']}")
    print(f"  Reset Time: {config['CIRCUIT_BREAKER_RESET_TIME']}s")
    
    print("\n⚙️ General Retry Settings:")
    print(f"  Regular Max Retries: {config['MAX_RETRIES_REGULAR']}")
    print(f"  Complex Max Retries: {config['MAX_RETRIES_COMPLEX']}")
    
    # Calculate total retry time estimates
    max_retries = int(config['SCREENSHOT_MAX_RETRIES'])
    base_delay = float(config['SCREENSHOT_BASE_DELAY'])
    max_delay = float(config['SCREENSHOT_MAX_DELAY'])
    
    total_time = 0
    for i in range(max_retries):
        delay = min(max_delay, base_delay * (2 ** i))
        total_time += delay
    
    print(f"\n⏱️ Estimated max retry time: {total_time:.1f}s")
    print(f"💡 This configuration should handle {concurrent_users} concurrent users")


def main():
    """Main function to configure retry settings."""
    if len(sys.argv) != 2:
        print("Usage: python configure_retry_settings.py <concurrent_users>")
        print("Example: python configure_retry_settings.py 2000")
        sys.exit(1)
    
    try:
        concurrent_users = int(sys.argv[1])
    except ValueError:
        print("Error: concurrent_users must be a number")
        sys.exit(1)
    
    if concurrent_users <= 0:
        print("Error: concurrent_users must be positive")
        sys.exit(1)
    
    # Get configuration for the specified load
    config = get_retry_config_for_load(concurrent_users)
    
    # Print summary
    print_config_summary(config, concurrent_users)
    
    # Ask for confirmation
    response = input("\n❓ Apply this configuration to .env file? (y/N): ")
    if response.lower() in ['y', 'yes']:
        update_env_file(config)
        print("✅ Configuration applied to .env file")
        print("🔄 Restart the service for changes to take effect")
    else:
        print("❌ Configuration not applied")
    
    print("\n📝 Manual Environment Variables:")
    print("You can also set these manually in your environment:")
    for key, value in config.items():
        print(f"export {key}={value}")


if __name__ == "__main__":
    main()
