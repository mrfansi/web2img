"""
Tests for all-content browser cache functionality
"""

import pytest
from unittest.mock import Mock, patch
from app.services.browser_cache import BrowserCacheService
from app.core.config import Settings


class TestAllContentCache:
    """Test all-content caching functionality."""

    def test_selective_caching_mode(self):
        """Test selective caching mode (default behavior)."""
        # Mock settings with selective caching
        mock_settings = Mock()
        mock_settings.browser_cache_enabled = True
        mock_settings.browser_cache_all_content = False
        mock_settings.browser_cache_max_size_mb = 500
        mock_settings.browser_cache_max_file_size_mb = 10
        mock_settings.browser_cache_ttl_hours = 24
        mock_settings.screenshot_dir = "/tmp/test_screenshots"

        with patch('app.services.browser_cache.settings', mock_settings), \
             patch('app.services.browser_cache.os.makedirs'):
            cache_service = BrowserCacheService()
            
            # Test CSS files are cacheable
            assert cache_service._is_cacheable_resource("https://example.com/style.css")
            
            # Test JS files are cacheable
            assert cache_service._is_cacheable_resource("https://example.com/script.js")
            
            # Test images are cacheable
            assert cache_service._is_cacheable_resource("https://example.com/image.png")
            
            # Test HTML files are now cacheable in selective mode (due to expanded patterns)
            assert cache_service._is_cacheable_resource("https://example.com/index.html")

            # Test JSON files are now cacheable in selective mode (due to expanded patterns)
            assert cache_service._is_cacheable_resource("https://example.com/data.json")

    def test_all_content_caching_mode(self):
        """Test all-content caching mode."""
        # Mock settings with all-content caching
        mock_settings = Mock()
        mock_settings.browser_cache_enabled = True
        mock_settings.browser_cache_all_content = True
        mock_settings.browser_cache_max_size_mb = 500
        mock_settings.browser_cache_max_file_size_mb = 10
        mock_settings.browser_cache_ttl_hours = 24
        mock_settings.screenshot_dir = "/tmp/test_screenshots"

        with patch('app.services.browser_cache.settings', mock_settings), \
             patch('app.services.browser_cache.os.makedirs'):
            cache_service = BrowserCacheService()
            
            # Test traditional cacheable files still work
            assert cache_service._is_cacheable_resource("https://example.com/style.css")
            assert cache_service._is_cacheable_resource("https://example.com/script.js")
            assert cache_service._is_cacheable_resource("https://example.com/image.png")
            
            # Test additional content types are now cacheable
            assert cache_service._is_cacheable_resource("https://example.com/index.html")
            assert cache_service._is_cacheable_resource("https://example.com/data.json")
            assert cache_service._is_cacheable_resource("https://example.com/document.pdf")
            assert cache_service._is_cacheable_resource("https://example.com/config.xml")
            assert cache_service._is_cacheable_resource("https://example.com/data.csv")
            assert cache_service._is_cacheable_resource("https://example.com/archive.zip")

    def test_excluded_patterns_in_all_content_mode(self):
        """Test that excluded patterns are not cached even in all-content mode."""
        # Mock settings with all-content caching
        mock_settings = Mock()
        mock_settings.browser_cache_enabled = True
        mock_settings.browser_cache_all_content = True
        mock_settings.browser_cache_max_size_mb = 500
        mock_settings.browser_cache_max_file_size_mb = 10
        mock_settings.browser_cache_ttl_hours = 24
        mock_settings.screenshot_dir = "/tmp/test_screenshots"

        with patch('app.services.browser_cache.settings', mock_settings), \
             patch('app.services.browser_cache.os.makedirs'):
            cache_service = BrowserCacheService()
            
            # Test API endpoints are excluded
            assert not cache_service._is_cacheable_resource("https://example.com/api/users")
            assert not cache_service._is_cacheable_resource("https://example.com/graphql")
            
            # Test authentication endpoints are excluded
            assert not cache_service._is_cacheable_resource("https://example.com/auth/login")
            assert not cache_service._is_cacheable_resource("https://example.com/logout")
            
            # Test real-time endpoints are excluded
            assert not cache_service._is_cacheable_resource("https://example.com/ws/chat")
            assert not cache_service._is_cacheable_resource("https://example.com/websocket")
            
            # Test analytics endpoints are excluded
            assert not cache_service._is_cacheable_resource("https://example.com/analytics")
            assert not cache_service._is_cacheable_resource("https://example.com/track")
            
            # Test admin endpoints are excluded
            assert not cache_service._is_cacheable_resource("https://example.com/admin/dashboard")

    def test_dynamic_query_parameters_excluded(self):
        """Test that URLs with dynamic query parameters are excluded."""
        # Mock settings with all-content caching
        mock_settings = Mock()
        mock_settings.browser_cache_enabled = True
        mock_settings.browser_cache_all_content = True
        mock_settings.browser_cache_max_size_mb = 500
        mock_settings.browser_cache_max_file_size_mb = 10
        mock_settings.browser_cache_ttl_hours = 24
        mock_settings.screenshot_dir = "/tmp/test_screenshots"

        with patch('app.services.browser_cache.settings', mock_settings), \
             patch('app.services.browser_cache.os.makedirs'):
            cache_service = BrowserCacheService()

            # Test URLs with dynamic parameters are excluded
            assert not cache_service._is_cacheable_resource("https://example.com/data.json?timestamp=1234567890")
            assert not cache_service._is_cacheable_resource("https://example.com/api.php?time=now")
            assert not cache_service._is_cacheable_resource("https://example.com/content?rand=abc123")
            assert not cache_service._is_cacheable_resource("https://example.com/page?token=xyz789")
            assert not cache_service._is_cacheable_resource("https://example.com/data?session=sess123")
            
            # Test URLs with static parameters are still cacheable
            assert cache_service._is_cacheable_resource("https://example.com/data.json?version=1.0")
            assert cache_service._is_cacheable_resource("https://example.com/content?lang=en")

    def test_priority_domains_always_cached(self):
        """Test that priority domains are always cached regardless of mode."""
        # Mock settings with selective caching
        mock_settings = Mock()
        mock_settings.browser_cache_enabled = True
        mock_settings.browser_cache_all_content = False
        mock_settings.browser_cache_max_size_mb = 500
        mock_settings.browser_cache_max_file_size_mb = 10
        mock_settings.browser_cache_ttl_hours = 24
        mock_settings.screenshot_dir = "/tmp/test_screenshots"

        with patch('app.services.browser_cache.settings', mock_settings), \
             patch('app.services.browser_cache.os.makedirs'):
            cache_service = BrowserCacheService()

            # Test priority domains are cached even in selective mode
            assert cache_service._is_cacheable_resource("https://cdnjs.cloudflare.com/ajax/libs/jquery/3.6.0/jquery.min.js")
            assert cache_service._is_cacheable_resource("https://fonts.googleapis.com/css2?family=Roboto")
            assert cache_service._is_cacheable_resource("https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css")

    def test_cache_configuration_properties(self):
        """Test that cache configuration properties are set correctly."""
        # Mock settings with all-content caching
        mock_settings = Mock()
        mock_settings.browser_cache_enabled = True
        mock_settings.browser_cache_all_content = True
        mock_settings.browser_cache_max_size_mb = 1000
        mock_settings.browser_cache_max_file_size_mb = 20
        mock_settings.browser_cache_ttl_hours = 48
        mock_settings.screenshot_dir = "/tmp/test_screenshots"

        with patch('app.services.browser_cache.settings', mock_settings), \
             patch('app.services.browser_cache.os.makedirs'):
            cache_service = BrowserCacheService()

            # Test configuration properties
            assert cache_service.enabled == True
            assert cache_service.cache_all_content == True
            assert cache_service.max_cache_size == 1000 * 1024 * 1024
            assert cache_service.max_file_size == 20 * 1024 * 1024
            assert cache_service.cache_ttl == 48 * 3600

    def test_additional_resource_types_in_patterns(self):
        """Test that additional resource types are included in cacheable patterns."""
        # Mock settings
        mock_settings = Mock()
        mock_settings.browser_cache_enabled = True
        mock_settings.browser_cache_all_content = False
        mock_settings.browser_cache_max_size_mb = 500
        mock_settings.browser_cache_max_file_size_mb = 10
        mock_settings.browser_cache_ttl_hours = 24
        mock_settings.screenshot_dir = "/tmp/test_screenshots"

        with patch('app.services.browser_cache.settings', mock_settings), \
             patch('app.services.browser_cache.os.makedirs'):
            cache_service = BrowserCacheService()

            # Test that new patterns are included
            assert 'documents' in cache_service.cacheable_patterns
            assert 'data' in cache_service.cacheable_patterns
            assert 'archives' in cache_service.cacheable_patterns
            assert 'other' in cache_service.cacheable_patterns
            
            # Test specific extensions
            assert '.html' in cache_service.cacheable_patterns['documents']
            assert '.json' in cache_service.cacheable_patterns['documents']
            assert '.csv' in cache_service.cacheable_patterns['data']
            assert '.zip' in cache_service.cacheable_patterns['archives']
            assert '.wasm' in cache_service.cacheable_patterns['other']

    def test_expanded_resource_types_in_selective_mode(self):
        """Test that expanded resource types work in selective mode too."""
        # Mock settings with selective caching
        mock_settings = Mock()
        mock_settings.browser_cache_enabled = True
        mock_settings.browser_cache_all_content = False
        mock_settings.browser_cache_max_size_mb = 500
        mock_settings.browser_cache_max_file_size_mb = 10
        mock_settings.browser_cache_ttl_hours = 24
        mock_settings.screenshot_dir = "/tmp/test_screenshots"

        with patch('app.services.browser_cache.settings', mock_settings), \
             patch('app.services.browser_cache.os.makedirs'):
            cache_service = BrowserCacheService()

            # Test that new file extensions are cacheable in selective mode
            assert cache_service._is_cacheable_resource("https://example.com/document.pdf")
            assert cache_service._is_cacheable_resource("https://example.com/data.json")
            assert cache_service._is_cacheable_resource("https://example.com/config.xml")
            assert cache_service._is_cacheable_resource("https://example.com/data.csv")
            assert cache_service._is_cacheable_resource("https://example.com/archive.zip")
            assert cache_service._is_cacheable_resource("https://example.com/app.wasm")
