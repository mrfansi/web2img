#!/usr/bin/env python3
"""
Simple test to verify the TabContextManager works correctly.
"""

import asyncio


class MockScreenshotService:
    """Mock screenshot service for testing."""
    
    def __init__(self):
        self.logger = MockLogger()
    
    async def _get_tab(self, width, height):
        """Mock get tab method."""
        return "mock_page", 1, "mock_tab_info"
    
    async def _return_tab(self, page, browser_index, tab_info, is_healthy=True):
        """Mock return tab method."""
        print(f"Returning tab: page={page}, browser_index={browser_index}, is_healthy={is_healthy}")


class MockLogger:
    """Mock logger for testing."""
    
    def error(self, message, context=None):
        print(f"ERROR: {message}")
        if context:
            print(f"Context: {context}")


class TabContextManager:
    """Async context manager for tab operations."""
    
    def __init__(self, screenshot_service, width: int, height: int):
        self.screenshot_service = screenshot_service
        self.width = width
        self.height = height
        self.page = None
        self.browser_index = None
        self.tab_info = None
    
    async def __aenter__(self):
        """Enter the async context manager."""
        try:
            # Get a tab from the pool
            self.page, self.browser_index, self.tab_info = await self.screenshot_service._get_tab(
                self.width, self.height
            )
            if self.page is None or self.browser_index is None or self.tab_info is None:
                raise RuntimeError("Failed to get tab from pool")
            
            print(f"Got tab: page={self.page}, browser_index={self.browser_index}")
            return self.page, self.browser_index, self.tab_info
        except Exception as e:
            # Clean up if needed
            if self.page is not None and self.browser_index is not None and self.tab_info is not None:
                try:
                    await self.screenshot_service._return_tab(
                        self.page, self.browser_index, self.tab_info, is_healthy=False
                    )
                except Exception as cleanup_error:
                    self.screenshot_service.logger.error(
                        f"Error returning tab during exception handling: {str(cleanup_error)}"
                    )
            raise
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Exit the async context manager."""
        if self.page is not None and self.browser_index is not None and self.tab_info is not None:
            try:
                # Determine if the tab is healthy based on whether an exception occurred
                is_healthy = exc_type is None
                await self.screenshot_service._return_tab(
                    self.page, self.browser_index, self.tab_info, is_healthy=is_healthy
                )
                print(f"Successfully returned tab")
            except Exception as e:
                self.screenshot_service.logger.error(f"Error returning tab during cleanup: {str(e)}", {
                    "error": str(e),
                    "error_type": type(e).__name__,
                    "browser_index": self.browser_index
                })


class MockScreenshotServiceWithManagedTab(MockScreenshotService):
    """Mock screenshot service with managed_tab method."""
    
    def managed_tab(self, width: int = 1280, height: int = 720):
        """Context manager for safely using a tab from the tab pool."""
        return TabContextManager(self, width, height)


async def test_context_manager():
    """Test the TabContextManager."""
    print("🧪 Testing TabContextManager")
    print("=" * 50)
    
    service = MockScreenshotServiceWithManagedTab()
    
    try:
        # Test normal usage
        print("📑 Testing normal usage...")
        async with service.managed_tab(width=1280, height=720) as (page, browser_index, tab_info):
            print(f"✅ Inside context: page={page}, browser_index={browser_index}, tab_info={tab_info}")
            # Simulate some work
            await asyncio.sleep(0.1)
        
        print("✅ Normal usage test passed")
        
        # Test exception handling
        print("\n📑 Testing exception handling...")
        try:
            async with service.managed_tab(width=1280, height=720) as (page, browser_index, tab_info):
                print(f"✅ Inside context: page={page}, browser_index={browser_index}, tab_info={tab_info}")
                # Simulate an error
                raise ValueError("Test exception")
        except ValueError as e:
            print(f"✅ Exception handled correctly: {e}")
        
        print("✅ Exception handling test passed")
        
        return True
        
    except Exception as e:
        print(f"❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


async def test_async_context_manager_protocol():
    """Test that the context manager implements the async context manager protocol correctly."""
    print("\n🔍 Testing async context manager protocol")
    print("=" * 50)
    
    service = MockScreenshotServiceWithManagedTab()
    context_manager = service.managed_tab(1280, 720)
    
    # Check if it has the required methods
    has_aenter = hasattr(context_manager, '__aenter__')
    has_aexit = hasattr(context_manager, '__aexit__')
    
    print(f"Has __aenter__: {has_aenter}")
    print(f"Has __aexit__: {has_aexit}")
    
    if has_aenter and has_aexit:
        print("✅ Context manager has required async methods")
        
        # Test that the methods are callable
        aenter_callable = callable(getattr(context_manager, '__aenter__'))
        aexit_callable = callable(getattr(context_manager, '__aexit__'))
        
        print(f"__aenter__ is callable: {aenter_callable}")
        print(f"__aexit__ is callable: {aexit_callable}")
        
        if aenter_callable and aexit_callable:
            print("✅ Async context manager protocol test passed")
            return True
        else:
            print("❌ Methods are not callable")
            return False
    else:
        print("❌ Missing required async context manager methods")
        return False


async def main():
    """Run all tests."""
    print("🚀 Starting TabContextManager Tests")
    print("=" * 50)
    
    # Test basic functionality
    basic_test_passed = await test_context_manager()
    
    # Test async context manager protocol
    protocol_test_passed = await test_async_context_manager_protocol()
    
    print("\n" + "=" * 50)
    print("📋 Test Summary")
    print("=" * 50)
    print(f"Basic functionality: {'✅ PASSED' if basic_test_passed else '❌ FAILED'}")
    print(f"Async context manager protocol: {'✅ PASSED' if protocol_test_passed else '❌ FAILED'}")
    
    if basic_test_passed and protocol_test_passed:
        print("\n🎉 All tests passed! TabContextManager is working correctly.")
        print("\n💡 The async context manager should work with 'async with' statements.")
        return 0
    else:
        print("\n❌ Some tests failed. Please check the implementation.")
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    exit(exit_code)
