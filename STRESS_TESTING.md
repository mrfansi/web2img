# Production Stress Testing for web2img

This document describes how to perform comprehensive stress testing on your production web2img deployment at `https://system-web2img.2wczxa.easypanel.host`.

## Overview

The stress testing suite includes:
- **Production-specific test scenarios** including URL transformation testing
- **Multiple concurrency levels** from light to extreme load
- **Comprehensive metrics and reporting**
- **Safety measures** to prevent overwhelming your production system
- **Health checks** before running tests

## Quick Start

### 1. Using the Shell Script (Recommended)

The easiest way to run stress tests:

```bash
# Light load test (25 concurrent, 250 requests)
./run_production_stress_test.sh light

# Moderate load test (50 concurrent, 500 requests)
./run_production_stress_test.sh moderate

# Heavy load test (100 concurrent, 1000 requests)
./run_production_stress_test.sh heavy

# Gradual ramp-up test
./run_production_stress_test.sh ramp-up

# Custom test
./run_production_stress_test.sh custom --concurrency 75 --requests 750

# Health check only
./run_production_stress_test.sh health
```

### 2. Using Python Script Directly

```bash
# Basic stress test
python3 tests/production_stress_test.py

# Custom parameters
python3 tests/production_stress_test.py \
    --concurrency 100 \
    --requests 1000 \
    --duration 300

# Ramp-up test
python3 tests/production_stress_test.py --ramp-up
```

## Test Scenarios

### URL Test Cases

The stress test includes these URL scenarios that test your URL transformation logic:

1. **viding.co URLs** → Transformed to `http://viding-co_website-revamp`
2. **viding.org URLs** → Transformed to `http://viding-org_website-revamp`
3. **Standard URLs** → No transformation (example.com, google.com, etc.)

### Load Levels

| Level | Concurrency | Requests | Use Case |
|-------|-------------|----------|----------|
| Light | 25 | 250 | Basic functionality test |
| Moderate | 50 | 500 | Normal production load |
| Heavy | 100 | 1000 | Peak traffic simulation |
| Extreme | 200 | 2000 | Stress limit testing |

## Metrics and Reporting

The stress test provides comprehensive metrics:

### Performance Metrics
- **Success Rate** - Percentage of successful requests
- **Requests per Second** - Throughput measurement
- **Response Times** - Average, min, max, 95th percentile, median
- **Error Breakdown** - Detailed error analysis

### Assessment Criteria
- **Success Rate**: 99%+ Excellent, 95%+ Good, 90%+ Fair, <90% Poor
- **Response Times**: ≤5s Excellent, ≤10s Good, ≤20s Fair, >20s Poor

## Safety Features

### Built-in Protections
1. **Health Check** - Verifies service is responding before testing
2. **Warmup Test** - Single request to ensure basic functionality
3. **Confirmation Prompts** - For high-concurrency tests (>100)
4. **Batch Processing** - Requests processed in batches to avoid overwhelming
5. **Timeout Protection** - Longer timeouts for production environment

### Production Considerations
- Tests use realistic screenshot parameters (1280x720 PNG)
- Includes proper error handling and retry logic
- Monitors both successful and failed requests
- Provides actionable performance assessments

## Understanding Results

### Sample Output
```
📊 PRODUCTION STRESS TEST RESULTS
================================================================================
🎯 Target URL:          https://system-web2img.2wczxa.easypanel.host
📊 Total Requests:      500
✅ Successful:          485 (97.0%)
❌ Failed:              15 (3.0%)
⏱️  Total Time:          45.23s
🚀 Requests/Second:     11.05
🔄 Concurrency:         50

📈 RESPONSE TIME ANALYSIS:
   Average:             4.12s
   Minimum:             1.23s
   Maximum:             12.45s
   95th Percentile:     8.90s
   Median:              3.87s

🎯 PERFORMANCE ASSESSMENT:
   ✅ Good - High success rate
   ✅ Good response times
```

### Key Metrics to Monitor

1. **Success Rate** - Should be >95% for production readiness
2. **95th Percentile Response Time** - Critical for user experience
3. **Error Types** - Identify bottlenecks and issues
4. **Requests/Second** - Measure throughput capacity

## Troubleshooting

### Common Issues

**High Error Rate**
- Check server resources (CPU, memory, disk)
- Verify browser pool configuration
- Monitor network connectivity

**Slow Response Times**
- Check browser cache effectiveness
- Monitor screenshot service performance
- Verify storage (R2/local) performance

**Timeout Errors**
- Increase timeout values if needed
- Check for domcontentloaded issues
- Monitor browser pool health

### Optimization Tips

1. **Browser Pool Tuning**
   - Adjust pool size based on CPU cores
   - Monitor browser lifecycle management
   - Optimize browser cache settings

2. **Storage Optimization**
   - Monitor R2/local storage performance
   - Check imgproxy configuration
   - Verify network bandwidth

3. **System Resources**
   - Monitor CPU usage during tests
   - Check memory consumption
   - Verify disk I/O performance

## Advanced Usage

### Custom Test Scenarios

Create custom test scenarios by modifying the test URLs in `production_stress_test.py`:

```python
# Add your specific URLs
self.test_urls = [
    "https://your-specific-site.com",
    "https://viding.co/custom-page",
    # ... more URLs
]
```

### Integration with CI/CD

Add stress testing to your deployment pipeline:

```bash
# In your deployment script
./run_production_stress_test.sh light
if [ $? -eq 0 ]; then
    echo "Stress test passed, deployment successful"
else
    echo "Stress test failed, rolling back"
    exit 1
fi
```

## Dependencies

Required Python packages:
```bash
pip install aiohttp asyncio
```

## Files

- `tests/production_stress_test.py` - Main stress testing script
- `run_production_stress_test.sh` - Convenient shell wrapper
- `STRESS_TESTING.md` - This documentation

## Support

For issues or questions about stress testing:
1. Check the error output for specific issues
2. Verify your production service is healthy
3. Monitor server resources during testing
4. Adjust concurrency levels based on your server capacity
