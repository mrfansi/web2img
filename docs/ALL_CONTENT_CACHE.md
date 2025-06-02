# All Content Browser Cache

This document describes the enhanced browser cache functionality that can cache all content from input URLs, not just CSS, JS, and media files.

## Overview

The web2img application now supports two caching modes:

1. **Selective Caching** (Default): Caches only CSS, JS, fonts, images, and media files
2. **All Content Caching**: Caches all resources from the input URL with intelligent exclusions

## Configuration

### Environment Variables

```bash
# Enable/disable browser cache
BROWSER_CACHE_ENABLED=true

# Enable all-content caching mode
BROWSER_CACHE_ALL_CONTENT=true

# Cache size limits
BROWSER_CACHE_MAX_SIZE_MB=500
BROWSER_CACHE_MAX_FILE_SIZE_MB=10

# Cache TTL
BROWSER_CACHE_TTL_HOURS=24

# Cleanup interval
BROWSER_CACHE_CLEANUP_INTERVAL=3600
```

### Docker Compose Example

```yaml
services:
  web2img:
    environment:
      - BROWSER_CACHE_ENABLED=true
      - BROWSER_CACHE_ALL_CONTENT=true
      - BROWSER_CACHE_MAX_SIZE_MB=1000
      - BROWSER_CACHE_MAX_FILE_SIZE_MB=20
      - BROWSER_CACHE_TTL_HOURS=48
```

## Caching Modes

### Selective Caching (Default)

When `BROWSER_CACHE_ALL_CONTENT=false`, the cache only stores:

- **CSS files**: `.css`
- **JavaScript files**: `.js`, `.mjs`
- **Fonts**: `.woff`, `.woff2`, `.ttf`, `.otf`, `.eot`
- **Images**: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`, `.ico`
- **Media**: `.mp4`, `.webm`, `.ogg`, `.mp3`, `.wav`
- **Priority domains**: CDNs like `cdnjs.cloudflare.com`, `fonts.googleapis.com`

### All Content Caching

When `BROWSER_CACHE_ALL_CONTENT=true`, the cache stores **everything** except:

#### Excluded URL Patterns

- `/api/` - API endpoints
- `/graphql` - GraphQL endpoints
- `/webhook` - Webhook endpoints
- `/callback` - Callback endpoints
- `/auth/`, `/login`, `/logout`, `/session` - Authentication endpoints
- `/ws/`, `/websocket`, `/sse/`, `/stream` - Real-time endpoints
- `/analytics`, `/track`, `/pixel`, `/beacon` - Analytics/tracking
- `/admin/`, `/manage/`, `/dashboard` - Admin endpoints

#### Excluded Query Parameters

URLs with these query parameters are not cached:

- `timestamp`, `time` - Time-based parameters
- `rand`, `random` - Random values
- `nonce` - Security nonces
- `token` - Authentication tokens
- `session` - Session identifiers

## Additional Content Types Cached

When all-content caching is enabled, these additional file types are cached:

- **Documents**: `.html`, `.htm`, `.xml`, `.json`, `.txt`, `.pdf`
- **Data files**: `.csv`, `.tsv`, `.yaml`, `.yml`, `.toml`
- **Archives**: `.zip`, `.tar`, `.gz`, `.bz2`, `.7z`
- **Other**: `.wasm`, `.bin`, `.dat`

## Benefits

### Performance Improvements

1. **Faster Page Load Times**: All resources are served from local cache
2. **Reduced Network Latency**: Eliminates repeated downloads
3. **Bandwidth Savings**: Significant reduction in data transfer
4. **Timeout Prevention**: Prevents domcontentloaded timeouts
5. **Improved Reliability**: Reduces dependency on external servers

### Use Cases

- **Heavy Resource Sites**: Sites with many external dependencies
- **Slow Networks**: Environments with limited bandwidth
- **High Volume Screenshots**: When taking many screenshots of similar sites
- **Development/Testing**: Consistent performance during testing

## Monitoring and Management

### API Endpoints

- `GET /browser-cache/stats` - Get cache statistics
- `GET /browser-cache/info` - Get cache configuration and mode
- `GET /browser-cache/performance` - Get performance metrics
- `GET /browser-cache/test` - Test caching behavior
- `POST /browser-cache/cleanup` - Manual cache cleanup
- `DELETE /browser-cache/clear` - Clear all cache

### Cache Statistics

The cache provides detailed statistics:

```json
{
  "hits": 1250,
  "misses": 180,
  "hit_rate": 0.87,
  "cached_items": 450,
  "cache_size_mb": 125.6,
  "max_cache_size_mb": 500,
  "caching_mode": "All Content"
}
```

## Best Practices

### When to Use All Content Caching

✅ **Recommended for:**

- High-volume screenshot operations
- Sites with many static resources
- Environments with slow internet connections
- Development and testing scenarios

❌ **Not recommended for:**

- Sites with frequently changing content
- Real-time applications
- Sites with user-specific content
- Limited storage environments

### Configuration Recommendations

For **high-volume production**:

```bash
BROWSER_CACHE_ALL_CONTENT=true
BROWSER_CACHE_MAX_SIZE_MB=2000
BROWSER_CACHE_MAX_FILE_SIZE_MB=50
BROWSER_CACHE_TTL_HOURS=72
```

For **development/testing**:

```bash
BROWSER_CACHE_ALL_CONTENT=true
BROWSER_CACHE_MAX_SIZE_MB=500
BROWSER_CACHE_MAX_FILE_SIZE_MB=10
BROWSER_CACHE_TTL_HOURS=24
```

For **memory-constrained environments**:

```bash
BROWSER_CACHE_ALL_CONTENT=false
BROWSER_CACHE_MAX_SIZE_MB=100
BROWSER_CACHE_MAX_FILE_SIZE_MB=5
BROWSER_CACHE_TTL_HOURS=12
```

## Troubleshooting

### Common Issues

1. **Cache Not Working**
   - Check `BROWSER_CACHE_ENABLED=true`
   - Verify cache directory permissions
   - Check logs for cache initialization errors

2. **Low Hit Rate**
   - Enable all-content caching
   - Increase cache TTL
   - Check excluded URL patterns

3. **High Memory Usage**
   - Reduce `BROWSER_CACHE_MAX_SIZE_MB`
   - Reduce `BROWSER_CACHE_MAX_FILE_SIZE_MB`
   - Decrease `BROWSER_CACHE_TTL_HOURS`

### Debugging

Enable debug logging to see cache behavior:

```bash
LOG_LEVEL=DEBUG
```

Check cache test endpoint:

```bash
curl http://localhost:8000/browser-cache/test
```

## Migration from Selective to All Content

To migrate from selective to all-content caching:

1. **Update environment variables**:

   ```bash
   BROWSER_CACHE_ALL_CONTENT=true
   ```

2. **Consider increasing cache size**:

   ```bash
   BROWSER_CACHE_MAX_SIZE_MB=1000  # Increase from default 500MB
   ```

3. **Monitor performance**:
   - Check hit rates via `/browser-cache/stats`
   - Monitor cache size growth
   - Adjust TTL if needed

4. **Clear existing cache** (optional):

   ```bash
   curl -X DELETE http://localhost:8000/browser-cache/clear
   ```

The cache will automatically start caching all content on the next screenshot requests.
