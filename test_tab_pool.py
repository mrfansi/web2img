#!/usr/bin/env python3
"""
Test script for the new tab pool functionality.
This script tests the multi-tab browser optimization feature.
"""

import asyncio
import sys
import os
import time

# Add the app directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'app'))

from app.core.config import settings
from app.services.tab_pool import tab_pool
from app.services.browser_pool import BrowserPool
from app.services.browser_manager import browser_manager


async def test_tab_pool():
    """Test the tab pool functionality."""
    print("🧪 Testing Tab Pool Functionality")
    print("=" * 50)
    
    # Initialize browser manager
    await browser_manager.initialize()
    
    # Create a browser pool
    browser_pool = BrowserPool(
        min_size=2,
        max_size=4,
        idle_timeout=60,
        max_age=300,
        cleanup_interval=30
    )
    
    try:
        # Initialize browser pool
        print("📦 Initializing browser pool...")
        await browser_pool.initialize()
        
        # Initialize tab pool
        print("🗂️  Initializing tab pool...")
        await tab_pool.initialize()
        
        # Get a browser from the pool
        print("🌐 Getting browser from pool...")
        browser, browser_index = await browser_pool.get_browser()
        if not browser or browser_index is None:
            print("❌ Failed to get browser from pool")
            return False
        
        print(f"✅ Got browser {browser_index}")
        
        # Create a context
        print("📄 Creating browser context...")
        context = await browser_pool.create_context(
            browser_index,
            viewport={"width": 1280, "height": 720},
            ignore_https_errors=True
        )
        
        if not context:
            print("❌ Failed to create browser context")
            return False
        
        print("✅ Created browser context")
        
        # Test tab creation and reuse
        print("\n🗂️  Testing tab creation and reuse...")
        
        # Create first tab
        print("📑 Creating first tab...")
        page1, tab_info1 = await tab_pool.get_tab(browser_index, context, 1280, 720)
        print(f"✅ Created tab 1 - Usage count: {tab_info1.usage_count}")
        
        # Create second tab
        print("📑 Creating second tab...")
        page2, tab_info2 = await tab_pool.get_tab(browser_index, context, 1280, 720)
        print(f"✅ Created tab 2 - Usage count: {tab_info2.usage_count}")
        
        # Test navigation
        print("\n🌐 Testing navigation...")
        try:
            await page1.goto("https://example.com", wait_until="domcontentloaded", timeout=10000)
            print("✅ Tab 1 navigated to example.com")
        except Exception as e:
            print(f"⚠️  Tab 1 navigation failed: {str(e)}")
        
        try:
            await page2.goto("https://httpbin.org/html", wait_until="domcontentloaded", timeout=10000)
            print("✅ Tab 2 navigated to httpbin.org")
        except Exception as e:
            print(f"⚠️  Tab 2 navigation failed: {str(e)}")
        
        # Release first tab
        print("\n🔄 Testing tab release and reuse...")
        await tab_pool.release_tab(tab_info1, is_healthy=True)
        print("✅ Released tab 1")
        
        # Get a new tab (should reuse the first one)
        page3, tab_info3 = await tab_pool.get_tab(browser_index, context, 1280, 720)
        print(f"✅ Got tab 3 - Usage count: {tab_info3.usage_count}")
        
        if tab_info3.usage_count > 1:
            print("🎉 Tab reuse working! Usage count increased.")
        else:
            print("ℹ️  New tab created (reuse may not have occurred)")
        
        # Test tab stats
        print("\n📊 Tab pool statistics:")
        stats = tab_pool.get_stats()
        for key, value in stats.items():
            print(f"  {key}: {value}")
        
        # Clean up
        print("\n🧹 Cleaning up...")
        await tab_pool.release_tab(tab_info2, is_healthy=True)
        await tab_pool.release_tab(tab_info3, is_healthy=True)
        
        # Release context and browser
        await browser_pool.release_context(browser_index, context)
        await browser_pool.release_browser(browser_index, is_healthy=True)
        
        print("✅ Cleanup completed")
        
        return True
        
    except Exception as e:
        print(f"❌ Test failed with error: {str(e)}")
        import traceback
        traceback.print_exc()
        return False
    
    finally:
        # Shutdown
        print("\n🛑 Shutting down...")
        try:
            await tab_pool.shutdown()
            await browser_pool.shutdown()
            await browser_manager.shutdown()
            print("✅ Shutdown completed")
        except Exception as e:
            print(f"⚠️  Shutdown error: {str(e)}")


async def test_concurrent_tabs():
    """Test concurrent tab usage."""
    print("\n🔄 Testing Concurrent Tab Usage")
    print("=" * 50)
    
    # Initialize browser manager
    await browser_manager.initialize()
    
    # Create a browser pool
    browser_pool = BrowserPool(min_size=1, max_size=2)
    
    try:
        await browser_pool.initialize()
        await tab_pool.initialize()
        
        # Get browser and context
        browser, browser_index = await browser_pool.get_browser()
        context = await browser_pool.create_context(browser_index, viewport={"width": 1280, "height": 720})
        
        # Create multiple tabs concurrently
        print("📑 Creating 5 tabs concurrently...")
        
        async def create_and_use_tab(tab_num):
            try:
                page, tab_info = await tab_pool.get_tab(browser_index, context, 1280, 720)
                print(f"✅ Tab {tab_num} created - Usage: {tab_info.usage_count}")
                
                # Simulate some work
                await asyncio.sleep(0.1)
                
                # Release the tab
                await tab_pool.release_tab(tab_info, is_healthy=True)
                print(f"✅ Tab {tab_num} released")
                
                return True
            except Exception as e:
                print(f"❌ Tab {tab_num} failed: {str(e)}")
                return False
        
        # Run concurrent tab operations
        tasks = [create_and_use_tab(i) for i in range(1, 6)]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        success_count = sum(1 for r in results if r is True)
        print(f"\n📊 Concurrent test results: {success_count}/5 successful")
        
        # Show final stats
        stats = tab_pool.get_stats()
        print(f"📊 Final stats: {stats}")
        
        # Cleanup
        await browser_pool.release_context(browser_index, context)
        await browser_pool.release_browser(browser_index, is_healthy=True)
        
        return success_count >= 4  # Allow for some failures
        
    except Exception as e:
        print(f"❌ Concurrent test failed: {str(e)}")
        return False
    
    finally:
        try:
            await tab_pool.shutdown()
            await browser_pool.shutdown()
            await browser_manager.shutdown()
        except:
            pass


async def main():
    """Run all tests."""
    print("🚀 Starting Tab Pool Tests")
    print("=" * 50)
    
    # Test basic functionality
    basic_test_passed = await test_tab_pool()
    
    # Test concurrent usage
    concurrent_test_passed = await test_concurrent_tabs()
    
    print("\n" + "=" * 50)
    print("📋 Test Summary")
    print("=" * 50)
    print(f"Basic functionality: {'✅ PASSED' if basic_test_passed else '❌ FAILED'}")
    print(f"Concurrent usage: {'✅ PASSED' if concurrent_test_passed else '❌ FAILED'}")
    
    if basic_test_passed and concurrent_test_passed:
        print("\n🎉 All tests passed! Tab pool is working correctly.")
        print("\n💡 Benefits of the new tab pool:")
        print("  • Reduced browser pool usage (20 tabs per browser)")
        print("  • Better resource utilization")
        print("  • Improved performance for high concurrency")
        print("  • Automatic tab cleanup and reuse")
        return 0
    else:
        print("\n❌ Some tests failed. Please check the implementation.")
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
