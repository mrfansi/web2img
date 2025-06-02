#!/usr/bin/env python3
"""
Unit Tests for Browser Cache Service
Tests the browser cache functionality without making actual HTTP requests
"""

import pytest
import asyncio
import tempfile
import shutil
import os
import sys

# Add the app directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.services.browser_cache import BrowserCacheService


class TestBrowserCacheService:
    """Test cases for browser cache service."""
    
    def setup_method(self):
        """Set up test fixtures."""
        # Create a temporary directory for testing
        self.temp_dir = tempfile.mkdtemp()
        
        # Create a test cache service
        self.cache_service = BrowserCacheService()
        self.cache_service.cache_dir = os.path.join(self.temp_dir, "test_cache")
        self.cache_service.enabled = True
        self.cache_service.max_cache_size = 10 * 1024 * 1024  # 10MB for testing
        self.cache_service.max_file_size = 1 * 1024 * 1024    # 1MB for testing
        self.cache_service.cache_ttl = 3600  # 1 hour for testing
        
        # Initialize cache directory
        self.cache_service._initialize_cache_dir()
    
    def teardown_method(self):
        """Clean up test fixtures."""
        # Remove temporary directory
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_cache_key_generation(self):
        """Test cache key generation."""
        url1 = "https://example.com/style.css"
        url2 = "https://example.com/script.js"
        url3 = "https://example.com/style.css"  # Same as url1
        
        key1 = self.cache_service._get_cache_key(url1)
        key2 = self.cache_service._get_cache_key(url2)
        key3 = self.cache_service._get_cache_key(url3)
        
        # Keys should be consistent
        assert key1 == key3, "Same URL should generate same cache key"
        assert key1 != key2, "Different URLs should generate different cache keys"
        assert len(key1) == 64, "Cache key should be SHA256 hash (64 chars)"
    
    def test_cacheable_resource_detection(self):
        """Test detection of cacheable resources."""
        # CSS files
        assert self.cache_service._is_cacheable_resource("https://example.com/style.css")
        assert self.cache_service._is_cacheable_resource("https://cdn.example.com/bootstrap.min.css")
        
        # JavaScript files
        assert self.cache_service._is_cacheable_resource("https://example.com/script.js")
        assert self.cache_service._is_cacheable_resource("https://example.com/module.mjs")
        
        # Font files
        assert self.cache_service._is_cacheable_resource("https://fonts.gstatic.com/font.woff2")
        assert self.cache_service._is_cacheable_resource("https://example.com/font.ttf")
        
        # Image files
        assert self.cache_service._is_cacheable_resource("https://example.com/image.png")
        assert self.cache_service._is_cacheable_resource("https://example.com/logo.svg")
        
        # Priority domains
        assert self.cache_service._is_cacheable_resource("https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.0/jquery.min.js")
        assert self.cache_service._is_cacheable_resource("https://fonts.googleapis.com/css2?family=Inter")
        
        # Non-cacheable resources
        assert not self.cache_service._is_cacheable_resource("https://example.com/page.html")
        assert not self.cache_service._is_cacheable_resource("https://example.com/api/data")
        assert not self.cache_service._is_cacheable_resource("https://example.com/document.pdf")
    
    @pytest.mark.asyncio
    async def test_cache_store_and_retrieve(self):
        """Test storing and retrieving from cache."""
        url = "https://example.com/test.css"
        content = b"body { color: red; }"
        headers = {"content-type": "text/css", "cache-control": "max-age=3600"}
        
        # Store in cache
        store_result = await self.cache_service._store_in_cache(url, content, headers)
        assert store_result, "Should successfully store in cache"
        
        # Retrieve from cache
        cached_result = await self.cache_service._get_from_cache(url)
        assert cached_result is not None, "Should retrieve from cache"
        
        cached_content, cached_headers = cached_result
        assert cached_content == content, "Cached content should match original"
        assert cached_headers == headers, "Cached headers should match original"
        
        # Check cache statistics
        stats = self.cache_service.get_cache_stats()
        assert stats["stores"] == 1, "Should have 1 store operation"
        assert stats["hits"] == 1, "Should have 1 cache hit"
        assert stats["cached_items"] == 1, "Should have 1 cached item"
    
    @pytest.mark.asyncio
    async def test_cache_miss(self):
        """Test cache miss for non-existent items."""
        url = "https://example.com/nonexistent.css"
        
        # Try to retrieve non-existent item
        cached_result = await self.cache_service._get_from_cache(url)
        assert cached_result is None, "Should return None for cache miss"
        
        # Check cache statistics
        stats = self.cache_service.get_cache_stats()
        assert stats["misses"] == 1, "Should have 1 cache miss"
    
    @pytest.mark.asyncio
    async def test_cache_size_limit(self):
        """Test cache size limits."""
        # Create content larger than max file size
        large_content = b"x" * (2 * 1024 * 1024)  # 2MB (larger than 1MB limit)
        url = "https://example.com/large.css"
        headers = {"content-type": "text/css"}
        
        # Try to store large file
        store_result = await self.cache_service._store_in_cache(url, large_content, headers)
        assert not store_result, "Should not store files larger than max size"
        
        # Verify it's not in cache
        cached_result = await self.cache_service._get_from_cache(url)
        assert cached_result is None, "Large file should not be cached"
    
    @pytest.mark.asyncio
    async def test_cache_cleanup(self):
        """Test cache cleanup functionality."""
        # Store some items in cache
        for i in range(5):
            url = f"https://example.com/file{i}.css"
            content = f"/* File {i} */".encode()
            headers = {"content-type": "text/css"}
            await self.cache_service._store_in_cache(url, content, headers)
        
        # Verify items are cached
        stats_before = self.cache_service.get_cache_stats()
        assert stats_before["cached_items"] == 5, "Should have 5 cached items"
        
        # Set a very short TTL to force expiration
        self.cache_service.cache_ttl = 0.1  # 0.1 seconds
        await asyncio.sleep(0.2)  # Wait for expiration
        
        # Run cleanup
        cleanup_result = await self.cache_service.cleanup_cache()
        assert cleanup_result["removed"] == 5, "Should remove all expired items"
        
        # Verify cache is empty
        stats_after = self.cache_service.get_cache_stats()
        assert stats_after["cached_items"] == 0, "Should have 0 cached items after cleanup"
    
    @pytest.mark.asyncio
    async def test_cache_clear(self):
        """Test clearing all cache."""
        # Store some items in cache
        for i in range(3):
            url = f"https://example.com/file{i}.js"
            content = f"console.log('File {i}');".encode()
            headers = {"content-type": "application/javascript"}
            await self.cache_service._store_in_cache(url, content, headers)
        
        # Verify items are cached
        stats_before = self.cache_service.get_cache_stats()
        assert stats_before["cached_items"] == 3, "Should have 3 cached items"
        
        # Clear cache
        clear_result = await self.cache_service.clear_cache()
        assert clear_result["removed"] == 3, "Should remove all items"
        
        # Verify cache is empty
        stats_after = self.cache_service.get_cache_stats()
        assert stats_after["cached_items"] == 0, "Should have 0 cached items after clear"
        assert stats_after["total_size"] == 0, "Total size should be 0 after clear"
    
    def test_cache_stats(self):
        """Test cache statistics."""
        stats = self.cache_service.get_cache_stats()
        
        # Check required fields
        required_fields = [
            "hits", "misses", "stores", "errors", "total_size",
            "hit_rate", "cache_size_mb", "max_cache_size_mb",
            "cached_items", "enabled", "cache_dir"
        ]
        
        for field in required_fields:
            assert field in stats, f"Stats should include {field}"
        
        # Check initial values
        assert stats["hits"] == 0, "Initial hits should be 0"
        assert stats["misses"] == 0, "Initial misses should be 0"
        assert stats["stores"] == 0, "Initial stores should be 0"
        assert stats["hit_rate"] == 0, "Initial hit rate should be 0"
        assert stats["enabled"] == True, "Cache should be enabled"
    
    def test_disabled_cache(self):
        """Test behavior when cache is disabled."""
        # Disable cache
        self.cache_service.enabled = False
        
        # Test cacheable resource detection
        assert not self.cache_service._is_cacheable_resource("https://example.com/style.css")
        
        # Test cache operations return appropriate values
        asyncio.run(self._test_disabled_cache_operations())
    
    async def _test_disabled_cache_operations(self):
        """Helper method for testing disabled cache operations."""
        url = "https://example.com/test.css"
        content = b"body { color: blue; }"
        headers = {"content-type": "text/css"}
        
        # Store should return False
        store_result = await self.cache_service._store_in_cache(url, content, headers)
        assert not store_result, "Store should return False when disabled"
        
        # Get should return None
        cached_result = await self.cache_service._get_from_cache(url)
        assert cached_result is None, "Get should return None when disabled"
    
    def test_priority_domains(self):
        """Test priority domain detection."""
        priority_urls = [
            "https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.0/jquery.min.js",
            "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap",
            "https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css",
            "https://use.fontawesome.com/releases/v5.15.4/css/all.css"
        ]
        
        for url in priority_urls:
            assert self.cache_service._is_cacheable_resource(url), f"Priority domain URL should be cacheable: {url}"
    
    @pytest.mark.asyncio
    async def test_cache_path_generation(self):
        """Test cache file path generation."""
        url = "https://example.com/test.css"
        cache_key = self.cache_service._get_cache_key(url)
        cache_path = self.cache_service._get_cache_path(cache_key)
        
        # Path should be in cache directory
        assert cache_path.startswith(self.cache_service.cache_dir)
        assert cache_path.endswith(".cache")
        assert cache_key in cache_path

    def test_url_reverse_transformation(self):
        """Test URL reverse transformation for transformed domains."""
        # Test viding.co transformation
        transformed_url = 'https://viding-co_website-revamp/mini-invitation/materials/image.png'
        expected_original = 'https://viding.co/mini-invitation/materials/image.png'
        result = self.cache_service._reverse_transform_url(transformed_url)
        assert result == expected_original

        # Test viding.org transformation
        transformed_url2 = 'http://viding-org_website-revamp/some/path/style.css'
        expected_original2 = 'https://viding.org/some/path/style.css'
        result2 = self.cache_service._reverse_transform_url(transformed_url2)
        assert result2 == expected_original2

        # Test non-transformed URL (should remain unchanged)
        normal_url = 'https://example.com/image.png'
        result3 = self.cache_service._reverse_transform_url(normal_url)
        assert result3 == normal_url

        # Test URL with query parameters and fragments
        complex_url = 'https://viding-co_website-revamp/api/data?param=value&test=1#section'
        expected_complex = 'https://viding.co/api/data?param=value&test=1#section'
        result4 = self.cache_service._reverse_transform_url(complex_url)
        assert result4 == expected_complex


def test_browser_cache_integration():
    """Integration test to ensure the cache service works as expected."""
    # This test doesn't require async
    cache_service = BrowserCacheService()
    
    # Test basic functionality
    assert hasattr(cache_service, 'cache_dir')
    assert hasattr(cache_service, 'enabled')
    assert hasattr(cache_service, 'max_cache_size')
    
    # Test configuration
    stats = cache_service.get_cache_stats()
    assert isinstance(stats, dict)
    assert 'enabled' in stats


if __name__ == "__main__":
    # Run the tests
    import unittest
    
    # Create a test suite
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromTestCase(TestBrowserCacheService)
    
    # Run the tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    # Run integration test
    print("\n" + "="*50)
    print("Running Integration Test...")
    try:
        test_browser_cache_integration()
        print("✅ Integration test passed!")
    except Exception as e:
        print(f"❌ Integration test failed: {e}")
    
    # Print summary
    print("\n" + "="*50)
    print("Browser Cache Unit Tests Summary:")
    print(f"Tests run: {result.testsRun}")
    print(f"Failures: {len(result.failures)}")
    print(f"Errors: {len(result.errors)}")
    
    if result.failures:
        print("\nFailures:")
        for test, traceback in result.failures:
            print(f"- {test}: {traceback}")
    
    if result.errors:
        print("\nErrors:")
        for test, traceback in result.errors:
            print(f"- {test}: {traceback}")
    
    success = len(result.failures) == 0 and len(result.errors) == 0
    print(f"\n{'✅ All tests passed!' if success else '❌ Some tests failed!'}")
