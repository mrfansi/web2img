# Troubleshooting Guide

## MaxRetriesExceededError

If you're encountering `MaxRetriesExceededError: Operation 'capture_screenshot' failed after X retries`, this guide will help you resolve the issue.

### Understanding the Error

This error occurs when the screenshot capture operation fails repeatedly and exhausts all retry attempts. The system uses an exponential backoff retry mechanism with circuit breakers to handle temporary failures gracefully.

### Quick Fixes

#### 1. Increase Retry Attempts

Add or modify these environment variables in your `.env` file:

```bash
# Increase the number of retry attempts
SCREENSHOT_MAX_RETRIES=10

# Increase delays between retries
SCREENSHOT_BASE_DELAY=2.0
SCREENSHOT_MAX_DELAY=20.0
```

#### 2. Adjust Circuit Breaker Settings

If the circuit breaker is opening too frequently:

```bash
# Allow more failures before opening the circuit
CIRCUIT_BREAKER_THRESHOLD=25

# Reduce reset time for faster recovery
CIRCUIT_BREAKER_RESET_TIME=60
```

#### 3. Increase Browser Pool Size

If you're experiencing high concurrency:

```bash
# Increase browser pool capacity
BROWSER_POOL_MAX_SIZE=15
BROWSER_POOL_MIN_SIZE=5
```

### Common Causes and Solutions

#### 1. **Network Issues**
- **Symptoms**: Timeouts, connection errors
- **Solution**: Increase timeouts and retry delays
```bash
NAVIGATION_TIMEOUT_REGULAR=45000
NAVIGATION_TIMEOUT_COMPLEX=90000
SCREENSHOT_BASE_DELAY=3.0
```

#### 2. **Resource Exhaustion**
- **Symptoms**: Memory errors, browser crashes
- **Solution**: Reduce concurrent operations and increase cleanup
```bash
BROWSER_POOL_MAX_SIZE=8
BROWSER_POOL_IDLE_TIMEOUT=180
THROTTLE_MAX_CONCURRENT=3
```

#### 3. **Complex Websites**
- **Symptoms**: Failures on specific sites with heavy JavaScript
- **Solution**: Increase timeouts for complex sites
```bash
NAVIGATION_TIMEOUT_COMPLEX=120000
MAX_RETRIES_COMPLEX=15
```

#### 4. **High Load**
- **Symptoms**: Failures during peak usage
- **Solution**: Implement better throttling and increase pool size
```bash
THROTTLE_MAX_CONCURRENT=8
THROTTLE_QUEUE_SIZE=100
BROWSER_POOL_MAX_SIZE=20
```

### Monitoring and Debugging

#### 1. Enable Debug Logging

```bash
LOG_LEVEL=DEBUG
```

#### 2. Check Browser Pool Health

Monitor these metrics in your logs:
- Browser pool utilization
- Circuit breaker state
- Retry statistics
- Error patterns

#### 3. System Resources

Ensure adequate resources:
- **Memory**: At least 2GB available
- **CPU**: Monitor CPU usage during peak loads
- **Disk Space**: Ensure `/tmp/web2img` has sufficient space

### Advanced Configuration

#### Adaptive Retry Strategy

For production environments, consider these settings:

```bash
# Conservative approach - fewer retries but longer delays
SCREENSHOT_MAX_RETRIES=8
SCREENSHOT_BASE_DELAY=2.0
SCREENSHOT_MAX_DELAY=30.0
SCREENSHOT_JITTER=0.5

# Aggressive approach - more retries with shorter delays
SCREENSHOT_MAX_RETRIES=12
SCREENSHOT_BASE_DELAY=0.5
SCREENSHOT_MAX_DELAY=15.0
SCREENSHOT_JITTER=0.2
```

#### Circuit Breaker Tuning

```bash
# For high-reliability environments
CIRCUIT_BREAKER_THRESHOLD=30
CIRCUIT_BREAKER_RESET_TIME=180

# For development/testing
CIRCUIT_BREAKER_THRESHOLD=10
CIRCUIT_BREAKER_RESET_TIME=30
```

### When to Contact Support

Contact support if:
1. Errors persist after trying the above solutions
2. System resources appear adequate but errors continue
3. Specific URLs consistently fail
4. Error patterns suggest underlying infrastructure issues

### Performance Optimization

#### 1. Browser Pool Optimization

```bash
# Optimize for your workload
BROWSER_POOL_MIN_SIZE=3
BROWSER_POOL_MAX_SIZE=12
BROWSER_POOL_IDLE_TIMEOUT=240
BROWSER_POOL_MAX_AGE=1800
```

#### 2. Throttling Configuration

```bash
# Balance throughput and stability
THROTTLE_MAX_CONCURRENT=6
THROTTLE_QUEUE_SIZE=75
```

### Environment-Specific Recommendations

#### Development
```bash
SCREENSHOT_MAX_RETRIES=3
CIRCUIT_BREAKER_THRESHOLD=5
LOG_LEVEL=DEBUG
```

#### Staging
```bash
SCREENSHOT_MAX_RETRIES=5
CIRCUIT_BREAKER_THRESHOLD=10
LOG_LEVEL=INFO
```

#### Production
```bash
SCREENSHOT_MAX_RETRIES=8
CIRCUIT_BREAKER_THRESHOLD=20
LOG_LEVEL=WARNING
```
