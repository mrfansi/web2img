# Health Check Service

The web2img application now includes an automated health check service that periodically tests the `/screenshot` endpoint to ensure it remains healthy and responsive.

## Overview

The health check service:

- Runs every 5 minutes by default (configurable)
- Makes requests to the `/screenshot` endpoint with `cache=false`
- Uses a configurable test URL (defaults to `https://example.com`)
- Tracks success/failure rates and response times
- Integrates with the monitoring system
- Provides health statistics via the `/health` endpoint

## Configuration

The health check service can be configured using environment variables:

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HEALTH_CHECK_ENABLED` | `true` | Enable/disable the health check service |
| `HEALTH_CHECK_INTERVAL` | `300` | Interval between health checks in seconds (5 minutes) |
| `HEALTH_CHECK_URL` | `https://example.com` | URL to use for health check screenshots |
| `HEALTH_CHECK_TIMEOUT` | `60` | Timeout for health check requests in seconds |
| `HEALTH_CHECK_PORT` | `8000` | Port to use for health check requests (uses PORT env var) |

### Example Configuration

```bash
# Enable health checks every 3 minutes
HEALTH_CHECK_ENABLED=true
HEALTH_CHECK_INTERVAL=180

# Use a specific test URL
HEALTH_CHECK_URL=https://httpbin.org/html

# Set timeout to 30 seconds
HEALTH_CHECK_TIMEOUT=30
```

## Health Check Process

1. **Startup**: The service starts automatically when the application starts
2. **Initial Delay**: Waits 30 seconds after startup before first check
3. **Periodic Checks**: Makes requests every `HEALTH_CHECK_INTERVAL` seconds
4. **Request Format**:

   ```json
   POST /screenshot?cache=false
   {
     "url": "https://example.com",
     "format": "png", 
     "width": 1280,
     "height": 720
   }
   ```

5. **Success Criteria**: HTTP 200 response from the endpoint
6. **Failure Handling**: Logs errors and updates failure statistics

## Monitoring Integration

The health check service integrates with the existing monitoring system:

### Health Endpoint

The `/health` endpoint now includes health check statistics:

```json
{
  "status": "ok",
  "version": "1.0.0",
  "services": {
    "health_check": {
      "status": "ok",
      "enabled": true,
      "running": true,
      "last_check_success": true,
      "success_rate": 0.95,
      "check_count": 20,
      "interval": 300
    }
  }
}
```

### Metrics Collected

- **Check Count**: Total number of health checks performed
- **Success Count**: Number of successful health checks
- **Failure Count**: Number of failed health checks
- **Success Rate**: Percentage of successful checks
- **Last Check Time**: Timestamp of the last health check
- **Last Check Duration**: Duration of the last health check in seconds
- **Last Error**: Details of the most recent error (if any)

## Troubleshooting

### Common Issues

1. **Service Not Starting**
   - Check that `HEALTH_CHECK_ENABLED=true`
   - Verify the application has proper permissions
   - Check logs for startup errors

2. **Health Checks Failing**
   - Verify the test URL is accessible
   - Check network connectivity
   - Ensure the screenshot service is working properly
   - Review timeout settings

3. **High Failure Rate**
   - Consider increasing `HEALTH_CHECK_TIMEOUT`
   - Use a simpler test URL (e.g., `https://httpbin.org/html`)
   - Check server resources and load

### Logs

Health check activities are logged with the `health_checker` logger:

```
2025-06-09 09:41:44.873 | INFO | app.services.health_checker:start:41 - Starting health check service with 300s interval
2025-06-09 09:45:00.123 | INFO | app.services.health_checker:_perform_health_check:125 - Health check #1 successful
2025-06-09 09:50:00.456 | ERROR | app.services.health_checker:_handle_health_check_failure:175 - Health check #2 failed
```

## Disabling Health Checks

To disable health checks:

```bash
HEALTH_CHECK_ENABLED=false
```

Or remove the environment variable entirely (defaults to enabled).

## Production Recommendations

### For High-Load Environments

1. **Increase Interval**: Use longer intervals to reduce overhead

   ```bash
   HEALTH_CHECK_INTERVAL=600  # 10 minutes
   ```

2. **Use Simple Test URL**: Choose a lightweight page

   ```bash
   HEALTH_CHECK_URL=https://httpbin.org/html
   ```

3. **Monitor Success Rate**: Alert if success rate drops below 90%

### For Development

1. **Shorter Intervals**: Get faster feedback

   ```bash
   HEALTH_CHECK_INTERVAL=60  # 1 minute
   ```

2. **Local Test URL**: Use a local test page if available

   ```bash
   HEALTH_CHECK_URL=http://localhost:3000/test
   ```

## Integration with External Monitoring

The health check statistics can be consumed by external monitoring systems:

1. **Prometheus**: Scrape the `/health` endpoint
2. **Grafana**: Create dashboards showing success rates and response times
3. **Alerting**: Set up alerts for low success rates or service failures

## Security Considerations

- The health check service makes internal requests only
- No external data is exposed through health checks
- Test URLs should be publicly accessible or properly configured
- Consider using HTTPS URLs for production environments
