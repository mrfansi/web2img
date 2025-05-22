import os
import sys
import pytest
from fastapi.testclient import TestClient

# Add the project root directory to the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# Now we can import from the app package
from app.main import app

@pytest.fixture
def client():
    """Create a test client for the app."""
    return TestClient(app)
