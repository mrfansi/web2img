#!/usr/bin/env python3
"""
Test for TargetClosedError handling in the retry service.

This module tests that TargetClosedError is properly handled as a retryable error.
"""

import pytest
from unittest.mock import MagicMock

from app.services.retry import RetryManager, RetryConfig
from app.core.errors import classify_exception, BrowserError

# Import TargetClosedError for testing
try:
    from playwright._impl._errors import TargetClosedError
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    # Create a mock TargetClosedError for testing if Playwright is not available
    class TargetClosedError(Exception):
        pass
    PLAYWRIGHT_AVAILABLE = False


class TestTargetClosedErrorHandling:
    """Test TargetClosedError handling in retry logic."""

    def setup_method(self):
        """Set up test fixtures."""
        self.retry_config = RetryConfig(
            max_retries=3,
            base_delay=0.1,
            max_delay=1.0,
            jitter=0.1
        )
        self.retry_manager = RetryManager(
            retry_config=self.retry_config,
            name="test_retry_manager"
        )

    def test_target_closed_error_should_retry(self):
        """Test that TargetClosedError is marked as retryable."""
        # Create a TargetClosedError
        error = TargetClosedError("Target closed")
        
        # Test that it should be retried
        should_retry = self.retry_manager._should_retry_error(error, retry_count=0)
        assert should_retry, "TargetClosedError should be retryable"
        
        # Test that it should be retried even on subsequent attempts
        should_retry = self.retry_manager._should_retry_error(error, retry_count=1)
        assert should_retry, "TargetClosedError should be retryable on retry attempts"

    def test_target_closed_error_by_name(self):
        """Test that errors with 'TargetClosedError' name are retryable."""
        # Create a custom error class with TargetClosedError name
        class MockTargetClosedError(Exception):
            pass
        MockTargetClosedError.__name__ = "TargetClosedError"

        error = MockTargetClosedError("Target closed")

        # Test that it should be retried
        should_retry = self.retry_manager._should_retry_error(error, retry_count=0)
        assert should_retry, "Error with TargetClosedError name should be retryable"

    def test_target_closed_error_by_message_pattern(self):
        """Test that errors with 'target closed' message are retryable."""
        # Create an error with target closed message
        error = Exception("The target closed unexpectedly")
        
        # Test that it should be retried
        should_retry = self.retry_manager._should_retry_error(error, retry_count=0)
        assert should_retry, "Error with 'target closed' message should be retryable"

    def test_target_closed_error_classification(self):
        """Test that TargetClosedError is classified as BrowserError."""
        # Create a TargetClosedError
        error = TargetClosedError("Target closed")
        
        # Test classification
        error_class = classify_exception(error)
        assert error_class == BrowserError, "TargetClosedError should be classified as BrowserError"

    def test_target_closed_error_message_classification(self):
        """Test that errors with 'target closed' message are classified as BrowserError."""
        # Create an error with target closed message
        error = Exception("The target closed unexpectedly")
        
        # Test classification
        error_class = classify_exception(error)
        assert error_class == BrowserError, "Error with 'target closed' message should be classified as BrowserError"

    @pytest.mark.asyncio
    async def test_target_closed_error_retry_execution(self):
        """Test that TargetClosedError triggers retry in execution."""
        call_count = 0
        
        async def failing_operation():
            nonlocal call_count
            call_count += 1
            if call_count <= 2:  # Fail first 2 attempts
                raise TargetClosedError("Target closed")
            return "success"
        
        # Execute with retry
        result = await self.retry_manager.execute(
            failing_operation,
            operation_name="test_target_closed_retry"
        )
        
        # Verify it succeeded after retries
        assert result == "success"
        assert call_count == 3, "Should have retried 2 times before succeeding"
        
        # Check retry stats
        stats = self.retry_manager.get_stats()
        assert stats["retries"] == 2, "Should have recorded 2 retries"
        assert stats["successes"] == 1, "Should have recorded 1 success"

    def test_other_errors_still_work(self):
        """Test that other error types are still handled correctly."""
        # Test permanent error (should not retry)
        permanent_error = ValueError("Invalid value")
        should_retry = self.retry_manager._should_retry_error(permanent_error, retry_count=0)
        assert not should_retry, "ValueError should not be retryable"

        # Test transient error (should retry)
        class MockTimeoutError(Exception):
            pass
        MockTimeoutError.__name__ = "TimeoutError"

        transient_error = MockTimeoutError("Connection timeout")
        should_retry = self.retry_manager._should_retry_error(transient_error, retry_count=0)
        assert should_retry, "TimeoutError should be retryable"

        # Test unknown error (should retry with limit)
        unknown_error = Exception("Unknown error")
        should_retry = self.retry_manager._should_retry_error(unknown_error, retry_count=0)
        assert should_retry, "Unknown error should be retryable initially"

        should_retry = self.retry_manager._should_retry_error(unknown_error, retry_count=3)
        assert not should_retry, "Unknown error should not be retryable after 3 attempts"


if __name__ == "__main__":
    pytest.main([__file__])
