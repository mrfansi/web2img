# Navigation Timeout Fixes for web2img

## Problem Analysis

You're experiencing persistent navigation timeout errors like:
```
All retry attempts exhausted for navigate_to_url. Consider increasing max_retries (current: 3) or checking for underlying issues.
```

The issue is **NOT** solved by increasing `max_retries` because:
1. It makes responses slower without fixing the root cause
2. The problem is with the navigation strategy, not retry count
3. Long timeouts waste resources and degrade user experience

## Root Causes

1. **Inefficient Navigation Strategy**: Using `networkidle` waits for all network requests to finish, which can hang on slow/broken resources
2. **Overly Long Timeouts**: Long timeouts don't help if a site is fundamentally unreachable
3. **Resource Loading**: Loading unnecessary resources (fonts, analytics, media) slows down navigation
4. **Single Strategy Approach**: No fallback when the primary strategy fails

## Solutions Implemented

### 1. Multi-Strategy Navigation with Fallbacks

The optimized code now uses multiple navigation strategies in order:

```javascript
strategies = [
    ("domcontentloaded", page_timeout),     // Wait for DOM only
    ("load", page_timeout * 0.8),           // Wait for load event (shorter timeout)
    ("commit", page_timeout * 0.6)          // Wait for navigation commit (shortest timeout)
]
```

**Benefits:**
- `domcontentloaded` is much faster and more reliable than `networkidle`
- Automatic fallback to simpler strategies if the first fails
- Progressive timeout reduction for faster failure detection

### 2. Aggressive Timeout Reduction

**Before:**
```env
NAVIGATION_TIMEOUT_REGULAR=20000  # 20 seconds
MAX_RETRIES_REGULAR=3             # 3 retries = 60+ seconds total
```

**After:**
```env
NAVIGATION_TIMEOUT_REGULAR=8000   # 8 seconds
MAX_RETRIES_REGULAR=1             # 1 retry = 16 seconds total
```

**Benefits:**
- 75% faster failure detection
- Prevents hanging on problematic sites
- Better resource utilization

### 3. Enhanced Resource Blocking

The optimized configuration blocks:
- Media files (mp3, mp4, wav, etc.)
- Fonts (woff, ttf, etc.) - for speed
- Analytics and tracking scripts
- Documents (pdf, doc, etc.)

**Benefits:**
- Faster page loading
- Reduced network requests
- Lower chance of timeouts

### 4. Adaptive Timeout Strategy

```javascript
// Always use 60% of original timeout
adaptive_timeout = int(page_timeout * 0.6)

// Further reduce under high load
if pool_load > 0.7:
    additional_reduction = min(0.5, (pool_load - 0.7) * 1.67)
    adaptive_timeout = int(adaptive_timeout * (1 - additional_reduction))
```

**Benefits:**
- Faster responses under load
- Prevents resource exhaustion
- Better scalability

## Quick Fix Implementation

### Option 1: Use the Production Config (Recommended)

1. Copy the optimized configuration:
```bash
cp .env.production .env
```

2. Restart your service:
```bash
docker-compose down && docker-compose up -d
```

### Option 2: Manual Environment Variables

Add these to your environment:

```bash
# Critical timeout fixes
NAVIGATION_TIMEOUT_REGULAR=8000
MAX_RETRIES_REGULAR=1
RETRY_BASE_DELAY=0.2
RETRY_MAX_DELAY=2.0

# Circuit breaker adjustments
CIRCUIT_BREAKER_THRESHOLD=10
CIRCUIT_BREAKER_RESET_TIME=60
```

### Option 3: Docker Compose Override

Create `docker-compose.override.yml`:

```yaml
version: '3.8'
services:
  web2img:
    environment:
      - NAVIGATION_TIMEOUT_REGULAR=8000
      - MAX_RETRIES_REGULAR=1
      - RETRY_BASE_DELAY=0.2
      - CIRCUIT_BREAKER_THRESHOLD=10
```

## Expected Results

After implementing these fixes, you should see:

1. **Faster Responses**: 60-75% reduction in response times
2. **Fewer Timeouts**: Multi-strategy navigation handles more sites successfully
3. **Better Error Messages**: Clear indication when sites are genuinely unreachable
4. **Improved Throughput**: More requests processed per minute

## Monitoring and Validation

### Check if fixes are working:

1. **Monitor logs for strategy usage:**
```bash
docker logs web2img | grep "Navigation succeeded with fallback strategy"
```

2. **Check timeout reduction:**
```bash
docker logs web2img | grep "Using adaptive timeout"
```

3. **Verify faster failures:**
```bash
# Should see much shorter durations
docker logs web2img | grep "All retry attempts exhausted" | tail -5
```

### Performance Metrics to Track:

- Average response time (should decrease by 60-75%)
- Success rate (should increase)
- Timeout frequency (should decrease significantly)
- Resource usage (CPU/memory should be more stable)

## Troubleshooting

### If you still see timeouts:

1. **Check if using new config:**
```bash
docker exec web2img env | grep NAVIGATION_TIMEOUT_REGULAR
# Should show: NAVIGATION_TIMEOUT_REGULAR=8000
```

2. **Verify code deployment:**
```bash
docker exec web2img grep -n "domcontentloaded" /app/app/services/screenshot.py
# Should show the new navigation strategy
```

3. **Monitor specific failing URLs:**
```bash
# Check which URLs are still failing
docker logs web2img | grep "All strategies failed" | tail -10
```

### If response times are still slow:

1. **Reduce timeouts further:**
```env
NAVIGATION_TIMEOUT_REGULAR=5000  # 5 seconds
MAX_RETRIES_REGULAR=0            # No retries
```

2. **Increase browser pool:**
```env
BROWSER_POOL_MAX_SIZE=15
BROWSER_POOL_MIN_SIZE=5
```

3. **Enable more aggressive resource blocking:**
```env
DISABLE_FONTS=true
DISABLE_ANALYTICS=true
```

## Advanced Optimizations

For extremely high-load environments:

1. **Implement request queuing with priorities**
2. **Use multiple browser pools for different site types**
3. **Implement caching for frequently requested URLs**
4. **Add health checks to remove problematic URLs from retry**

## Support

If issues persist after implementing these fixes:

1. Share logs with the specific error patterns
2. Provide information about the types of URLs causing issues
3. Include your current environment configuration
4. Monitor resource usage (CPU, memory, network) during failures
