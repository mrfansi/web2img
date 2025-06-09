import pytest
import asyncio
from unittest.mock import AsyncMock, patch, MagicMock
import httpx

from app.services.health_checker import HealthCheckService
from app.core.config import settings


class TestHealthCheckService:
    """Test cases for the HealthCheckService."""

    @pytest.fixture
    def health_service(self):
        """Create a health check service instance for testing."""
        return HealthCheckService()

    @pytest.mark.asyncio
    async def test_service_initialization(self, health_service):
        """Test that the service initializes correctly."""
        assert not health_service._is_running
        assert health_service._task is None
        assert health_service._check_count == 0
        assert health_service._success_count == 0
        assert health_service._failure_count == 0

    @pytest.mark.asyncio
    async def test_get_stats_initial(self, health_service):
        """Test getting stats from a newly initialized service."""
        stats = health_service.get_stats()
        
        assert stats["enabled"] == settings.health_check_enabled
        assert stats["running"] == False
        assert stats["check_count"] == 0
        assert stats["success_count"] == 0
        assert stats["failure_count"] == 0
        assert stats["success_rate"] == 0
        assert stats["interval"] == settings.health_check_interval
        assert stats["test_url"] == settings.health_check_url

    @pytest.mark.asyncio
    async def test_start_service_disabled(self, health_service):
        """Test starting the service when health checks are disabled."""
        with patch.object(settings, 'health_check_enabled', False):
            await health_service.start()
            assert not health_service._is_running
            assert health_service._task is None

    @pytest.mark.asyncio
    async def test_start_service_enabled(self, health_service):
        """Test starting the service when health checks are enabled."""
        with patch.object(settings, 'health_check_enabled', True):
            await health_service.start()
            assert health_service._is_running
            assert health_service._task is not None
            
            # Clean up
            await health_service.stop()

    @pytest.mark.asyncio
    async def test_stop_service(self, health_service):
        """Test stopping the service."""
        with patch.object(settings, 'health_check_enabled', True):
            await health_service.start()
            assert health_service._is_running
            
            await health_service.stop()
            assert not health_service._is_running

    @pytest.mark.asyncio
    async def test_successful_health_check(self, health_service):
        """Test a successful health check."""
        # Mock successful HTTP response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "OK"
        
        with patch('httpx.AsyncClient') as mock_client:
            mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
            
            await health_service._perform_health_check()
            
            assert health_service._check_count == 1
            assert health_service._success_count == 1
            assert health_service._failure_count == 0
            assert health_service._last_check_success == True
            assert health_service._last_error is None

    @pytest.mark.asyncio
    async def test_failed_health_check_http_error(self, health_service):
        """Test a failed health check due to HTTP error."""
        # Mock failed HTTP response
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error"
        
        with patch('httpx.AsyncClient') as mock_client:
            mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
            
            await health_service._perform_health_check()
            
            assert health_service._check_count == 1
            assert health_service._success_count == 0
            assert health_service._failure_count == 1
            assert health_service._last_check_success == False
            assert "HTTP 500" in health_service._last_error

    @pytest.mark.asyncio
    async def test_failed_health_check_timeout(self, health_service):
        """Test a failed health check due to timeout."""
        with patch('httpx.AsyncClient') as mock_client:
            mock_client.return_value.__aenter__.return_value.post = AsyncMock(
                side_effect=asyncio.TimeoutError()
            )
            
            await health_service._perform_health_check()
            
            assert health_service._check_count == 1
            assert health_service._success_count == 0
            assert health_service._failure_count == 1
            assert health_service._last_check_success == False
            assert "timeout" in health_service._last_error.lower()

    @pytest.mark.asyncio
    async def test_failed_health_check_connection_error(self, health_service):
        """Test a failed health check due to connection error."""
        with patch('httpx.AsyncClient') as mock_client:
            mock_client.return_value.__aenter__.return_value.post = AsyncMock(
                side_effect=httpx.ConnectError("Connection failed")
            )
            
            await health_service._perform_health_check()
            
            assert health_service._check_count == 1
            assert health_service._success_count == 0
            assert health_service._failure_count == 1
            assert health_service._last_check_success == False
            assert "connection error" in health_service._last_error.lower()

    @pytest.mark.asyncio
    async def test_success_rate_calculation(self, health_service):
        """Test that success rate is calculated correctly."""
        # Simulate multiple checks with mixed results
        health_service._check_count = 10
        health_service._success_count = 7
        health_service._failure_count = 3
        
        stats = health_service.get_stats()
        assert stats["success_rate"] == 0.7

    @pytest.mark.asyncio
    async def test_health_check_request_format(self, health_service):
        """Test that the health check request is formatted correctly."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        
        with patch('httpx.AsyncClient') as mock_client:
            mock_post = AsyncMock(return_value=mock_response)
            mock_client.return_value.__aenter__.return_value.post = mock_post
            
            await health_service._perform_health_check()
            
            # Verify the request was made correctly
            mock_post.assert_called_once()
            call_args = mock_post.call_args
            
            # Check URL includes cache=false
            expected_url = f"http://localhost:{settings.health_check_port}/screenshot?cache=false"
            assert call_args[0][0] == expected_url
            
            # Check request data
            request_data = call_args[1]["json"]
            assert request_data["url"] == settings.health_check_url
            assert request_data["format"] == "png"
            assert request_data["width"] == 1280
            assert request_data["height"] == 720
            
            # Check headers
            headers = call_args[1]["headers"]
            assert headers["Content-Type"] == "application/json"

    @pytest.mark.asyncio
    async def test_monitoring_integration(self, health_service):
        """Test that health check stats are integrated with monitoring."""
        with patch('app.core.monitoring.metrics_collector') as mock_metrics:
            stats = health_service.get_stats()

            # Verify that update_health_check_stats was called
            mock_metrics.update_health_check_stats.assert_called_once_with(stats)

    @pytest.mark.asyncio
    async def test_service_restart_handling(self, health_service):
        """Test that the service can be restarted properly."""
        with patch.object(settings, 'health_check_enabled', True):
            # Start service
            await health_service.start()
            assert health_service._is_running
            
            # Try to start again (should not create duplicate tasks)
            await health_service.start()
            assert health_service._is_running
            
            # Stop service
            await health_service.stop()
            assert not health_service._is_running
            
            # Start again
            await health_service.start()
            assert health_service._is_running
            
            # Clean up
            await health_service.stop()
