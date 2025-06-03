# Real IP Configuration for web2img

## Problem

When deploying web2img behind proxies, load balancers, or container orchestration platforms like Easypanel, the application logs show internal network IPs (like `10.11.0.48:60100`) instead of the real visitor IP addresses.

This happens because:
1. Your web2img application runs inside a Docker container
2. Easypanel/Docker networking creates an internal network
3. Requests go through proxy layers before reaching your application
4. The direct client IP (`request.client.host`) is the internal proxy IP, not the visitor's IP

## Solution

We've implemented a comprehensive real IP extraction system that:

1. **Checks common proxy headers** to find the real visitor IP
2. **Supports multiple proxy types** (Nginx, Cloudflare, load balancers, etc.)
3. **Provides configuration options** for security and debugging
4. **Validates IP addresses** to prevent header spoofing
5. **Falls back gracefully** if no proxy headers are found

## How It Works

### Proxy Headers Checked (in order of priority)

1. **`X-Forwarded-For`** - Most common, can contain multiple IPs
2. **`X-Real-IP`** - Nginx and other proxies
3. **`CF-Connecting-IP`** - Cloudflare
4. **`X-Client-IP`** - Some proxies
5. **`X-Forwarded`** - Less common
6. **`Forwarded-For`** - Less common
7. **`Forwarded`** - RFC 7239 standard

### IP Extraction Logic

```python
# For X-Forwarded-For: "203.0.113.1, 198.51.100.1, 192.0.2.1"
# Takes the first (leftmost) IP: "203.0.113.1"

# For other headers: uses the value directly
# Validates that the IP looks like a real IP address
# Ignores "unknown" values
```

## Configuration Options

Add these to your `.env` file or environment variables:

```bash
# Enable trust of proxy headers (default: true)
TRUST_PROXY_HEADERS=true

# Comma-separated list of trusted proxy IPs (optional)
TRUSTED_PROXY_IPS=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16

# Enable proxy header debugging (default: false)
LOG_PROXY_HEADERS=false
```

### Configuration Details

- **`TRUST_PROXY_HEADERS`**: Set to `false` to disable proxy header trust and only use direct client IP
- **`TRUSTED_PROXY_IPS`**: Currently for documentation (future feature for IP validation)
- **`LOG_PROXY_HEADERS`**: Set to `true` to log all proxy headers for debugging

## Deployment Steps

### 1. Update Your Environment

Add the new configuration to your `.env` file:

```bash
# Real IP Configuration
TRUST_PROXY_HEADERS=true
TRUSTED_PROXY_IPS=
LOG_PROXY_HEADERS=false
```

### 2. Deploy the Changes

```bash
# If using Docker Compose
docker-compose down
docker-compose up -d

# If using Easypanel
# Push changes to your repository
# Easypanel will automatically redeploy
```

### 3. Verify It's Working

Make a test request and check your logs:

```bash
# Before: You'll see internal IPs
INFO: 10.11.0.48:60100 - "POST /screenshot HTTP/1.1" 200 OK

# After: You'll see real visitor IPs
INFO: 203.0.113.1:0 - "POST /screenshot HTTP/1.1" 200 OK
```

## Testing

Run the test script to verify functionality:

```bash
python test_real_ip.py
```

## Debugging

### Enable Debug Logging

Set these environment variables for debugging:

```bash
LOG_PROXY_HEADERS=true
LOG_LEVEL=DEBUG
```

### Check Proxy Headers

The logs will show which headers are being received:

```json
{
  "level": "DEBUG",
  "message": "Proxy headers detected: {'x-forwarded-for': '203.0.113.1, 198.51.100.1'}"
}
```

### Common Issues

1. **Still seeing internal IPs**: Check that `TRUST_PROXY_HEADERS=true`
2. **No proxy headers**: Your proxy might not be setting standard headers
3. **Wrong IP extracted**: Check the header priority order

## Security Considerations

1. **Header Spoofing**: Malicious clients can set fake proxy headers
2. **Trusted Proxies**: Only trust headers from known proxy IPs (future feature)
3. **Validation**: We validate that extracted IPs look like real IP addresses

## Log Format Changes

### Before
```json
{
  "request": {
    "client": "10.11.0.48",
    "method": "POST",
    "url": "/screenshot"
  }
}
```

### After
```json
{
  "request": {
    "client": "203.0.113.1",
    "client_direct": "10.11.0.48",
    "method": "POST",
    "url": "/screenshot"
  }
}
```

The logs now include both:
- **`client`**: The real visitor IP (extracted from headers)
- **`client_direct`**: The direct connection IP (for debugging)

## Monitoring

You can now:
1. **Track real visitor IPs** in your logs
2. **Analyze traffic patterns** by actual visitor location
3. **Implement rate limiting** based on real IPs
4. **Debug issues** with specific visitor IPs

## Next Steps

1. Deploy these changes to production
2. Monitor logs to verify real IPs are being captured
3. Consider implementing rate limiting based on real IPs
4. Set up analytics based on visitor IP geolocation
