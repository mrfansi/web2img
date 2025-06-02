#!/usr/bin/env python3
"""
Unit Tests for URL Transformer
Tests the URL transformation logic without making actual HTTP requests
"""

import pytest
import sys
import os

# Add the app directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.utils.url_transformer import URLTransformer, transform_url, is_transformable_domain


class TestURLTransformer:
    """Test cases for URL transformation functionality."""
    
    def setup_method(self):
        """Set up test fixtures."""
        self.transformer = URLTransformer()
    
    def test_viding_co_transformation(self):
        """Test viding.co URL transformation."""
        test_cases = [
            ("https://viding.co", "http://viding-co_website-revamp"),
            ("https://www.viding.co", "http://viding-co_website-revamp"),
            ("http://viding.co", "http://viding-co_website-revamp"),
            ("https://viding.co/", "http://viding-co_website-revamp/"),
            ("https://viding.co/about", "http://viding-co_website-revamp/about"),
            ("https://viding.co/contact?ref=test", "http://viding-co_website-revamp/contact?ref=test"),
            ("https://viding.co/page#section", "http://viding-co_website-revamp/page#section"),
        ]
        
        for original, expected in test_cases:
            result = self.transformer.transform_url(original)
            assert result == expected, f"Failed for {original}: expected {expected}, got {result}"
    
    def test_viding_org_transformation(self):
        """Test viding.org URL transformation."""
        test_cases = [
            ("https://viding.org", "http://viding-org_website-revamp"),
            ("https://www.viding.org", "http://viding-org_website-revamp"),
            ("http://viding.org", "http://viding-org_website-revamp"),
            ("https://viding.org/", "http://viding-org_website-revamp/"),
            ("https://viding.org/services", "http://viding-org_website-revamp/services"),
            ("https://viding.org/contact?email=test", "http://viding-org_website-revamp/contact?email=test"),
            ("https://viding.org/page#footer", "http://viding-org_website-revamp/page#footer"),
        ]
        
        for original, expected in test_cases:
            result = self.transformer.transform_url(original)
            assert result == expected, f"Failed for {original}: expected {expected}, got {result}"
    
    def test_no_transformation_needed(self):
        """Test URLs that should not be transformed."""
        test_cases = [
            "https://example.com",
            "https://google.com",
            "https://github.com",
            "https://stackoverflow.com",
            "https://viding.net",  # Different TLD
            "https://myviding.co",  # Subdomain
            "https://viding.co.uk",  # Different TLD
            "http://localhost:8000",
            "https://192.168.1.1",
        ]
        
        for url in test_cases:
            result = self.transformer.transform_url(url)
            assert result == url, f"URL {url} should not be transformed, but got {result}"
    
    def test_is_transformable_domain(self):
        """Test domain transformation detection."""
        transformable_cases = [
            "https://viding.co",
            "https://www.viding.co",
            "https://viding.org",
            "https://www.viding.org",
            "http://viding.co/path",
            "http://viding.org/path",
        ]
        
        non_transformable_cases = [
            "https://example.com",
            "https://google.com",
            "https://viding.net",
            "https://myviding.co",
            "https://viding.co.uk",
        ]
        
        for url in transformable_cases:
            assert self.transformer.is_transformable_domain(url), f"Should be transformable: {url}"
        
        for url in non_transformable_cases:
            assert not self.transformer.is_transformable_domain(url), f"Should not be transformable: {url}"
    
    def test_get_original_domain(self):
        """Test domain extraction."""
        test_cases = [
            ("https://viding.co", "viding.co"),
            ("https://www.viding.co", "www.viding.co"),
            ("https://example.com/path", "example.com"),
            ("http://localhost:8000", "localhost:8000"),
        ]
        
        for url, expected_domain in test_cases:
            result = self.transformer.get_original_domain(url)
            assert result == expected_domain, f"Failed for {url}: expected {expected_domain}, got {result}"
    
    def test_add_transformation_rule(self):
        """Test adding custom transformation rules."""
        # Add a new rule
        self.transformer.add_transformation_rule("test.com", "test-com_revamp", "https")
        
        # Test the new rule
        result = self.transformer.transform_url("https://test.com/page")
        expected = "https://test-com_revamp/page"
        assert result == expected, f"Custom rule failed: expected {expected}, got {result}"
        
        # Test that it's detected as transformable
        assert self.transformer.is_transformable_domain("https://test.com")
    
    def test_remove_transformation_rule(self):
        """Test removing transformation rules."""
        # Remove viding.co rule
        self.transformer.remove_transformation_rule("viding.co")
        
        # Test that it's no longer transformed
        result = self.transformer.transform_url("https://viding.co")
        assert result == "https://viding.co", "Rule should be removed"
        
        # Test that it's no longer detected as transformable
        assert not self.transformer.is_transformable_domain("https://viding.co")
    
    def test_list_transformation_rules(self):
        """Test listing transformation rules."""
        rules = self.transformer.list_transformation_rules()
        
        # Should contain the default rules
        assert "viding.co" in rules
        assert "viding.org" in rules
        
        # Check rule structure
        assert rules["viding.co"]["new_domain"] == "viding-co_website-revamp"
        assert rules["viding.co"]["protocol"] == "http"
        assert rules["viding.org"]["new_domain"] == "viding-org_website-revamp"
        assert rules["viding.org"]["protocol"] == "http"
    
    def test_malformed_urls(self):
        """Test handling of malformed URLs."""
        malformed_urls = [
            "not-a-url",
            "ftp://invalid",
            "",
            "https://",
            "://missing-protocol",
        ]
        
        for url in malformed_urls:
            # Should not crash and should return original URL
            result = self.transformer.transform_url(url)
            assert result == url, f"Malformed URL {url} should be returned as-is"
    
    def test_convenience_functions(self):
        """Test the convenience functions."""
        # Test transform_url function
        result = transform_url("https://viding.co")
        assert result == "http://viding-co_website-revamp"
        
        # Test is_transformable_domain function
        assert is_transformable_domain("https://viding.co")
        assert not is_transformable_domain("https://example.com")


def test_url_transformer_integration():
    """Integration test to ensure the transformer works as expected."""
    test_urls = [
        ("https://viding.co", "http://viding-co_website-revamp"),
        ("https://viding.org", "http://viding-org_website-revamp"),
        ("https://example.com", "https://example.com"),  # No change
    ]
    
    for original, expected in test_urls:
        result = transform_url(original)
        assert result == expected, f"Integration test failed for {original}"


if __name__ == "__main__":
    # Run the tests
    import unittest
    
    # Create a test suite
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromTestCase(TestURLTransformer)
    
    # Run the tests
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    
    # Run integration test
    print("\n" + "="*50)
    print("Running Integration Test...")
    try:
        test_url_transformer_integration()
        print("✅ Integration test passed!")
    except AssertionError as e:
        print(f"❌ Integration test failed: {e}")
    
    # Print summary
    print("\n" + "="*50)
    print("URL Transformer Unit Tests Summary:")
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
