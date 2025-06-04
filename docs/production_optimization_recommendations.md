# Production Optimization Recommendations for web2img

## 🚨 Critical Issues Identified

Based on stress testing and production logs analysis:

### **Primary Issue: Browser Context Creation Timeouts**
- All screenshot requests timing out (120-180 seconds)
- Browser context creation going through multiple timeout strategies
- Emergency context creation being triggered frequently

### **Secondary Issues:**
- Browser pool potentially saturated (64 max browsers)
- Resource exhaustion under load
- DNS/connectivity issues appearing under stress

## 🎯 Immediate Actions Required

### **1. Browser Pool Optimization**

**Current Configuration:**
```env
BROWSER_POOL_MIN_SIZE=16
BROWSER_POOL_MAX_SIZE=64
BROWSER_POOL_IDLE_TIMEOUT=180
BROWSER_POOL_MAX_AGE=1800
```

**Recommended Emergency Configuration:**
```env
# Reduce pool size to prevent resource exhaustion
BROWSER_POOL_MIN_SIZE=4
BROWSER_POOL_MAX_SIZE=16
BROWSER_POOL_IDLE_TIMEOUT=60
BROWSER_POOL_MAX_AGE=600
BROWSER_POOL_CLEANUP_INTERVAL=15

# Increase timeouts for context creation
CONTEXT_CREATION_TIMEOUT=60000
BROWSER_CONTEXT_TIMEOUT=60000
PAGE_CREATION_TIMEOUT=60000

# Enable emergency context creation by default
ENABLE_EMERGENCY_CONTEXT=true
```

### **2. Timeout Strategy Optimization**

**Current Timeouts (too aggressive):**
```env
NAVIGATION_TIMEOUT_REGULAR=20000
NAVIGATION_TIMEOUT_COMPLEX=45000
```

**Recommended Production Timeouts:**
```env
# Increase navigation timeouts for problematic pages
NAVIGATION_TIMEOUT_REGULAR=45000
NAVIGATION_TIMEOUT_COMPLEX=90000
SCREENSHOT_TIMEOUT=30000

# Reduce retries to fail faster
MAX_RETRIES_REGULAR=2
MAX_RETRIES_COMPLEX=3
```

### **3. Resource Management**

**Add these settings:**
```env
# Limit concurrent browser operations
MAX_CONCURRENT_CONTEXTS=8
MAX_CONCURRENT_SCREENSHOTS=4

# Enable aggressive cleanup
FORCE_BROWSER_RESTART_INTERVAL=300
MEMORY_CLEANUP_THRESHOLD=80

# Disable resource-heavy features temporarily
DISABLE_IMAGES=true
DISABLE_JAVASCRIPT=false  # Keep JS for mini-rsvp pages
```

## 🔧 Implementation Steps

### **Step 1: Emergency Configuration (Immediate)**

1. **Reduce browser pool size** to prevent resource exhaustion
2. **Increase context creation timeouts** to handle slow pages
3. **Enable emergency context creation** for all requests
4. **Restart the service** to clear any stuck browsers

### **Step 2: Monitoring Setup**

Add these monitoring endpoints to track:
- Browser pool utilization
- Context creation success rate
- Average response times by URL pattern
- Memory and CPU usage

### **Step 3: URL-Specific Handling**

Implement special handling for mini-rsvp URLs:
```python
# In screenshot service
if "mini-rsvp" in url:
    # Use extended timeouts
    navigation_timeout = settings.navigation_timeout_complex * 2
    # Force emergency context creation
    use_emergency_context = True
    # Disable certain optimizations
    disable_cache = True
```

## 📊 Expected Improvements

### **Short-term (1-2 hours):**
- Reduced timeout rate from 100% to <20%
- Faster failure detection (30s vs 180s)
- Better resource utilization

### **Medium-term (1-2 days):**
- Stable 95%+ success rate for control URLs
- 70%+ success rate for mini-rsvp URLs
- Response times <30s for successful requests

## 🔍 Monitoring Commands

Use these commands to monitor the improvements:

```bash
# Quick health check
./run_production_stress_test.sh health

# Test control URLs only
./run_production_stress_test.sh diagnostic

# Light load test
./run_production_stress_test.sh light

# Monitor timeout patterns
./run_production_stress_test.sh timeout-deep
```

## 🚨 Emergency Procedures

### **If Service Becomes Unresponsive:**

1. **Restart the service** to clear browser pool
2. **Apply emergency configuration** (reduced pool size)
3. **Monitor logs** for browser context creation patterns
4. **Scale horizontally** if single instance can't handle load

### **If Timeouts Persist:**

1. **Check server resources** (CPU, memory, disk)
2. **Verify network connectivity** to target URLs
3. **Consider URL blacklisting** for problematic mini-rsvp pages
4. **Implement circuit breaker** for failing URL patterns

## 📈 Performance Targets

### **Acceptable Performance:**
- Control URLs: 95%+ success rate, <10s response time
- Standard URLs: 90%+ success rate, <20s response time
- Mini-RSVP URLs: 70%+ success rate, <60s response time

### **Red Flags:**
- Any URL pattern with <50% success rate
- Response times >120s for any request
- Browser pool utilization >90% for extended periods

## 🔄 Next Steps

1. **Apply emergency configuration** immediately
2. **Run light stress test** to verify improvements
3. **Monitor production logs** for 24 hours
4. **Gradually increase load** as stability improves
5. **Implement URL-specific optimizations** for mini-rsvp pages

## 📞 Escalation

If issues persist after implementing these changes:
1. Consider **horizontal scaling** (multiple web2img instances)
2. Implement **load balancing** across instances
3. Add **caching layer** for frequently requested URLs
4. Consider **URL preprocessing** to identify problematic patterns
