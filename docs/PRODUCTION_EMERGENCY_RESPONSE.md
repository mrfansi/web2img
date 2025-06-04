# 🚨 Production Emergency Response for web2img

## Current Situation Analysis

Based on stress testing your production environment at `https://system-web2img.2wczxa.easypanel.host`, we've identified critical issues:

### **🔴 Critical Issues Detected:**
- **100% timeout rate** on screenshot endpoint
- **Browser context creation failures** (multiple timeout strategies failing)
- **Resource exhaustion** under load
- **Service becoming unresponsive** after sustained load

### **📊 Test Results:**
- Control URLs (example.com): **0% success rate**
- Problematic URLs (mini-rsvp): **0% success rate**
- Average timeout: **120-180 seconds**
- Error pattern: **58.3% timeout errors**

## 🚨 IMMEDIATE ACTION REQUIRED

### **Step 1: Apply Emergency Configuration (NOW)**

```bash
# Generate emergency configuration
python3 generate_emergency_config.py

# This creates emergency.env with optimized settings
```

**Key Emergency Settings:**
```env
# Reduce browser pool to prevent resource exhaustion
BROWSER_POOL_MAX_SIZE=16  # Down from 64
BROWSER_POOL_MIN_SIZE=4   # Down from 16

# Increase context creation timeouts
CONTEXT_CREATION_TIMEOUT=60000  # Up from 30000
BROWSER_CONTEXT_TIMEOUT=60000   # Up from 30000

# Enable emergency context creation
ENABLE_EMERGENCY_CONTEXT=true
FORCE_EMERGENCY_ON_TIMEOUT=true
```

### **Step 2: Restart Service**
Apply the emergency.env configuration to your production environment and restart the web2img service.

### **Step 3: Verify Recovery**

```bash
# Check basic connectivity
./run_production_stress_test.sh health

# Run comprehensive diagnostic
./run_production_stress_test.sh diagnostic

# Test timeout patterns
./run_production_stress_test.sh timeout-deep
```

## 📊 Monitoring and Verification

### **Continuous Monitoring**
```bash
# Start continuous health monitoring (3-minute intervals)
./run_production_stress_test.sh monitor
```

### **Progressive Load Testing**
```bash
# After emergency config is applied and service is stable:

# 1. Light load test (25 concurrent)
./run_production_stress_test.sh light

# 2. Moderate load test (50 concurrent) - only if light test passes
./run_production_stress_test.sh moderate

# 3. Gradual ramp-up - only if moderate test passes
./run_production_stress_test.sh ramp-up
```

## 🎯 Expected Improvements

### **Immediate (1-2 hours):**
- Timeout rate: **100% → <20%**
- Response time: **180s → <30s**
- Service stability: **Improved**

### **Short-term (24 hours):**
- Control URLs: **>95% success rate**
- Standard URLs: **>90% success rate**
- Mini-RSVP URLs: **>70% success rate**

## 📈 Success Metrics

### **Green Indicators:**
- Health check: ✅ Responding
- Control URLs: >95% success rate
- Response times: <20s average
- No timeout errors in logs

### **Yellow Indicators:**
- Control URLs: 80-95% success rate
- Response times: 20-60s average
- Occasional timeout errors

### **Red Indicators:**
- Control URLs: <80% success rate
- Response times: >60s average
- Frequent timeout errors
- Service unresponsive

## 🛠️ Available Tools

### **Diagnostic Tools:**
```bash
./run_production_stress_test.sh health          # Quick health check
./run_production_stress_test.sh diagnostic      # Comprehensive diagnostic
./run_production_stress_test.sh timeout-deep    # Deep timeout analysis
./run_production_stress_test.sh monitor         # Continuous monitoring
```

### **Load Testing Tools:**
```bash
./run_production_stress_test.sh light           # 25 concurrent, 250 requests
./run_production_stress_test.sh moderate        # 50 concurrent, 500 requests
./run_production_stress_test.sh heavy           # 100 concurrent, 1000 requests
./run_production_stress_test.sh ramp-up         # Gradual increase
```

### **Configuration Tools:**
```bash
python3 generate_emergency_config.py            # Generate optimized configs
python3 monitor_production_health.py            # Standalone monitoring
```

## 🔧 Configuration Files Generated

### **emergency.env** - Apply immediately
- Reduced browser pool size (16 max)
- Increased timeouts (60s context creation)
- Emergency context creation enabled
- Conservative resource limits

### **optimized.env** - Apply after emergency works
- Balanced browser pool size (32 max)
- Optimized timeouts (45s context creation)
- Performance optimizations
- Higher throughput settings

## 📋 Implementation Checklist

### **Immediate (Next 30 minutes):**
- [ ] Run `python3 generate_emergency_config.py`
- [ ] Apply emergency.env to production
- [ ] Restart web2img service
- [ ] Run `./run_production_stress_test.sh health`
- [ ] Run `./run_production_stress_test.sh diagnostic`

### **Short-term (Next 2 hours):**
- [ ] Start continuous monitoring
- [ ] Run light load test
- [ ] Monitor production logs for improvements
- [ ] Document any remaining issues

### **Medium-term (Next 24 hours):**
- [ ] Apply optimized.env if emergency config works
- [ ] Run moderate and heavy load tests
- [ ] Implement URL-specific optimizations
- [ ] Set up automated monitoring

## 🚨 Escalation Procedures

### **If Emergency Config Doesn't Help:**
1. **Check server resources** (CPU, memory, disk)
2. **Verify network connectivity** to target URLs
3. **Consider horizontal scaling** (multiple instances)
4. **Implement circuit breaker** for failing URLs

### **If Service Remains Unresponsive:**
1. **Restart with minimal config** (pool size = 2)
2. **Check for resource leaks** in browser processes
3. **Consider service replacement** or rollback
4. **Implement emergency maintenance mode**

## 📞 Support Information

### **Log Monitoring:**
Watch for these improvements in production logs:
- ✅ More "Successfully launched browser" messages
- ✅ Fewer "Timeout with normal strategy" messages
- ✅ Reduced "Emergency context creation" usage
- ✅ Faster screenshot completion times

### **Key Metrics to Track:**
- Browser pool utilization
- Context creation success rate
- Average response times by URL pattern
- Memory and CPU usage trends

## 🎯 Next Steps After Recovery

1. **Implement URL-specific handling** for mini-rsvp pages
2. **Add comprehensive monitoring** and alerting
3. **Consider caching layer** for frequently requested URLs
4. **Plan horizontal scaling** for sustained high load
5. **Implement circuit breaker** patterns for failing URLs

---

**Remember:** The goal is to get your service stable first, then optimize for performance. Apply the emergency configuration immediately and monitor the results closely.
