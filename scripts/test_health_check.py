#!/usr/bin/env python3
"""
Test script for the health check service.

This script can be used to manually test the health check functionality
and verify that it's working correctly.
"""

import asyncio
import time
import sys
import os

# Add the app directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.services.health_checker import HealthCheckService
from app.core.config import settings


async def test_health_check_service():
    """Test the health check service functionality."""
    print("🔍 Testing Health Check Service")
    print("=" * 50)
    
    # Create health check service instance
    health_service = HealthCheckService()
    
    print(f"📋 Configuration:")
    print(f"  - Enabled: {settings.health_check_enabled}")
    print(f"  - Interval: {settings.health_check_interval} seconds")
    print(f"  - Test URL: {settings.health_check_url}")
    print(f"  - Timeout: {settings.health_check_timeout} seconds")
    print(f"  - Port: {settings.health_check_port}")
    print()
    
    # Test initial stats
    print("📊 Initial Statistics:")
    initial_stats = health_service.get_stats()
    for key, value in initial_stats.items():
        print(f"  - {key}: {value}")
    print()
    
    # Test service startup
    print("🚀 Starting health check service...")
    await health_service.start()
    
    if health_service._is_running:
        print("✅ Health check service started successfully")
    else:
        print("❌ Health check service failed to start")
        return
    
    # Wait a moment and check stats
    print("\n⏳ Waiting 2 seconds...")
    await asyncio.sleep(2)
    
    running_stats = health_service.get_stats()
    print("📊 Running Statistics:")
    for key, value in running_stats.items():
        print(f"  - {key}: {value}")
    print()
    
    # Perform a manual health check
    print("🔧 Performing manual health check...")
    start_time = time.time()
    
    try:
        await health_service._perform_health_check()
        duration = time.time() - start_time
        print(f"✅ Manual health check completed in {duration:.2f} seconds")
    except Exception as e:
        print(f"❌ Manual health check failed: {str(e)}")
    
    # Check updated stats
    print("\n📊 Updated Statistics:")
    updated_stats = health_service.get_stats()
    for key, value in updated_stats.items():
        print(f"  - {key}: {value}")
    print()
    
    # Test service shutdown
    print("🛑 Stopping health check service...")
    await health_service.stop()
    
    if not health_service._is_running:
        print("✅ Health check service stopped successfully")
    else:
        print("❌ Health check service failed to stop")
    
    print("\n🎉 Health check service test completed!")


async def test_multiple_health_checks():
    """Test multiple health checks to verify success rate calculation."""
    print("\n🔄 Testing Multiple Health Checks")
    print("=" * 50)
    
    health_service = HealthCheckService()
    
    print("🚀 Starting service for multiple checks...")
    await health_service.start()
    
    # Perform multiple health checks
    num_checks = 5
    print(f"🔧 Performing {num_checks} health checks...")
    
    for i in range(num_checks):
        print(f"  Check {i+1}/{num_checks}...", end=" ")
        try:
            await health_service._perform_health_check()
            print("✅")
        except Exception as e:
            print(f"❌ ({str(e)})")
        
        # Small delay between checks
        await asyncio.sleep(1)
    
    # Show final statistics
    print("\n📊 Final Statistics:")
    final_stats = health_service.get_stats()
    for key, value in final_stats.items():
        print(f"  - {key}: {value}")
    
    # Calculate and display success rate
    success_rate = final_stats['success_rate'] * 100
    print(f"\n📈 Success Rate: {success_rate:.1f}%")
    
    if success_rate >= 80:
        print("✅ Health check service is performing well!")
    elif success_rate >= 50:
        print("⚠️  Health check service has some issues")
    else:
        print("❌ Health check service needs attention")
    
    await health_service.stop()
    print("\n🎉 Multiple health checks test completed!")


async def main():
    """Main test function."""
    print("🏥 Web2img Health Check Service Test")
    print("=" * 60)
    print()
    
    try:
        # Test basic functionality
        await test_health_check_service()
        
        # Test multiple checks
        await test_multiple_health_checks()
        
    except KeyboardInterrupt:
        print("\n\n⚠️  Test interrupted by user")
    except Exception as e:
        print(f"\n\n❌ Test failed with error: {str(e)}")
        import traceback
        traceback.print_exc()
    
    print("\n" + "=" * 60)
    print("Test completed. Check the logs above for results.")


if __name__ == "__main__":
    asyncio.run(main())
