import asyncio
import os
import sys
import json
from fastapi.testclient import TestClient

# Add the app directory to the path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.main import app
from app.core.errors import (
    WebToImgError,
    BrowserError,
    NavigationError,
    ScreenshotError,
    BrowserPoolExhaustedError,
    CircuitBreakerOpenError,
    MaxRetriesExceededError
)

# Create a test client
client = TestClient(app)


def test_error_reporting():
    """Test the improved error reporting system."""
    print("\n=== Testing Improved Error Reporting ===\n")
    
    # Test 1: Invalid URL format
    print("Test 1: Invalid URL format")
    response = client.post(
        "/screenshot",
        json={
            "url": "invalid-url",  # Invalid URL format
            "width": 800,
            "height": 600,
            "format": "png"
        }
    )
    print(f"Status code: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}\n")
    
    # Test 2: Invalid screenshot format
    print("Test 2: Invalid screenshot format")
    response = client.post(
        "/screenshot",
        json={
            "url": "https://example.com",
            "width": 800,
            "height": 600,
            "format": "invalid-format"  # Invalid format
        }
    )
    print(f"Status code: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}\n")
    
    # Test 3: Non-existent batch job
    print("Test 3: Non-existent batch job")
    response = client.get("/batch/screenshots/non-existent-job-id")
    print(f"Status code: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}\n")
    
    print("=== Error Reporting Test Complete ===\n")


def test_custom_errors():
    """Test custom error classes directly."""
    print("\n=== Testing Custom Error Classes ===\n")
    
    # Test BrowserPoolExhaustedError
    error = BrowserPoolExhaustedError(context={"pool_size": 10, "max_size": 10})
    print(f"BrowserPoolExhaustedError: {error.message}")
    print(f"Error details: {json.dumps(error.to_dict(), indent=2)}\n")
    
    # Test NavigationError
    error = NavigationError(
        url="https://example.com",
        context={"timeout": 30, "wait_until": "networkidle"},
        original_exception=Exception("Timeout exceeded")
    )
    print(f"NavigationError: {error.message}")
    print(f"Error details: {json.dumps(error.to_dict(), indent=2)}\n")
    
    # Test CircuitBreakerOpenError
    error = CircuitBreakerOpenError(name="browser_operations")
    print(f"CircuitBreakerOpenError: {error.message}")
    print(f"Error details: {json.dumps(error.to_dict(), indent=2)}\n")
    
    # Test MaxRetriesExceededError
    error = MaxRetriesExceededError(
        operation="screenshot_capture",
        retries=3,
        context={"url": "https://example.com"},
        original_exception=Exception("Browser context has been closed")
    )
    print(f"MaxRetriesExceededError: {error.message}")
    print(f"Error details: {json.dumps(error.to_dict(), indent=2)}\n")
    
    print("=== Custom Error Classes Test Complete ===\n")


if __name__ == "__main__":
    # Run the tests
    test_custom_errors()
    test_error_reporting()
