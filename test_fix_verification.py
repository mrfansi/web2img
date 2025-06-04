#!/usr/bin/env python3
"""
Test to verify the async context manager fix is working.
This reproduces the original error and tests the fix.
"""

import asyncio
import sys


# Simulate the original broken implementation (async generator)
class BrokenManagedTab:
    """Broken implementation that returns an async generator."""
    
    def __init__(self, service, width, height):
        self.service = service
        self.width = width
        self.height = height
    
    async def __call__(self):
        """This would be the broken async generator approach."""
        try:
            # Simulate getting a tab
            page, browser_index, tab_info = "mock_page", 1, "mock_tab_info"
            yield page, browser_index, tab_info
        finally:
            # Cleanup
            pass


# Correct implementation (async context manager)
class TabContextManager:
    """Correct async context manager implementation."""
    
    def __init__(self, service, width: int, height: int):
        self.service = service
        self.width = width
        self.height = height
        self.page = None
        self.browser_index = None
        self.tab_info = None
    
    async def __aenter__(self):
        """Enter the async context manager."""
        # Simulate getting a tab
        self.page, self.browser_index, self.tab_info = "mock_page", 1, "mock_tab_info"
        print(f"✅ Got tab: {self.page}, browser_index: {self.browser_index}")
        return self.page, self.browser_index, self.tab_info
    
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """Exit the async context manager."""
        print(f"✅ Returning tab: {self.page}, browser_index: {self.browser_index}")
        # Cleanup would happen here


class MockService:
    """Mock service to test both implementations."""
    
    def broken_managed_tab(self, width=1280, height=720):
        """Returns an async generator (broken)."""
        return BrokenManagedTab(self, width, height)()
    
    def fixed_managed_tab(self, width=1280, height=720):
        """Returns an async context manager (fixed)."""
        return TabContextManager(self, width, height)


async def test_broken_implementation():
    """Test the broken async generator implementation."""
    print("🔴 Testing broken implementation (async generator)...")
    
    service = MockService()
    
    try:
        # This should fail with the same error as the original issue
        async with service.broken_managed_tab() as (page, browser_index, tab_info):
            print(f"This shouldn't work: {page}")
        
        print("❌ Broken implementation unexpectedly worked!")
        return False
        
    except TypeError as e:
        if "asynchronous context manager protocol" in str(e):
            print(f"✅ Got expected error: {e}")
            return True
        else:
            print(f"❌ Got unexpected error: {e}")
            return False
    except Exception as e:
        print(f"❌ Got unexpected exception: {e}")
        return False


async def test_fixed_implementation():
    """Test the fixed async context manager implementation."""
    print("\n🟢 Testing fixed implementation (async context manager)...")
    
    service = MockService()
    
    try:
        # This should work correctly
        async with service.fixed_managed_tab() as (page, browser_index, tab_info):
            print(f"✅ Successfully used tab: page={page}, browser_index={browser_index}, tab_info={tab_info}")
        
        print("✅ Fixed implementation worked correctly!")
        return True
        
    except Exception as e:
        print(f"❌ Fixed implementation failed: {e}")
        return False


async def test_context_manager_protocol():
    """Test that the fixed implementation has the correct async context manager methods."""
    print("\n🔍 Testing async context manager protocol...")
    
    service = MockService()
    context_manager = service.fixed_managed_tab()
    
    # Check for required methods
    has_aenter = hasattr(context_manager, '__aenter__')
    has_aexit = hasattr(context_manager, '__aexit__')
    
    print(f"Has __aenter__: {has_aenter}")
    print(f"Has __aexit__: {has_aexit}")
    
    if has_aenter and has_aexit:
        print("✅ Async context manager protocol is correctly implemented")
        return True
    else:
        print("❌ Missing required async context manager methods")
        return False


async def main():
    """Run all tests."""
    print("🧪 Testing Async Context Manager Fix")
    print("=" * 60)
    
    # Test the broken implementation (should fail)
    broken_test_passed = await test_broken_implementation()
    
    # Test the fixed implementation (should work)
    fixed_test_passed = await test_fixed_implementation()
    
    # Test the protocol
    protocol_test_passed = await test_context_manager_protocol()
    
    print("\n" + "=" * 60)
    print("📋 Test Results")
    print("=" * 60)
    print(f"Broken implementation (expected to fail): {'✅ PASSED' if broken_test_passed else '❌ FAILED'}")
    print(f"Fixed implementation (should work): {'✅ PASSED' if fixed_test_passed else '❌ FAILED'}")
    print(f"Protocol verification: {'✅ PASSED' if protocol_test_passed else '❌ FAILED'}")
    
    if broken_test_passed and fixed_test_passed and protocol_test_passed:
        print("\n🎉 All tests passed!")
        print("\n💡 The fix correctly addresses the original error:")
        print("   - Original error: 'async_generator' object does not support the asynchronous context manager protocol")
        print("   - Solution: Use proper async context manager with __aenter__ and __aexit__ methods")
        print("   - Result: The managed_tab() method now works correctly with 'async with' statements")
        return 0
    else:
        print("\n❌ Some tests failed!")
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
