# URL Transformation Feature

The web2img service now includes automatic URL transformation functionality that allows you to redirect specific domains to alternative URLs before capturing screenshots.

## Overview

When a screenshot request is made, the service automatically checks if the requested URL matches any configured transformation rules. If a match is found, the URL is transformed before the screenshot is captured, but the original URL is used for caching purposes to maintain consistency.

## Default Transformations

The service comes with the following pre-configured transformations:

| Original Domain | Transformed To | Protocol |
|----------------|----------------|----------|
| `viding.co` | `viding-co_website-revamp` | `http` |
| `viding.org` | `viding-org_website-revamp` | `http` |

## Examples

### Single Screenshot Endpoint

**Request:**
```json
POST /screenshot
{
  "url": "https://viding.co/about",
  "width": 1280,
  "height": 720,
  "format": "png"
}
```

**What happens:**
1. Original URL: `https://viding.co/about`
2. Transformed URL: `http://viding-co_website-revamp/about`
3. Screenshot is captured from the transformed URL
4. Result is cached using the original URL as the key

### Batch Screenshot Endpoint

**Request:**
```json
POST /batch/screenshots
{
  "items": [
    {
      "id": "viding-home",
      "url": "https://viding.co",
      "width": 1280,
      "height": 720,
      "format": "png"
    },
    {
      "id": "viding-org-contact",
      "url": "https://viding.org/contact",
      "width": 1280,
      "height": 720,
      "format": "png"
    }
  ]
}
```

**What happens:**
- `https://viding.co` → `http://viding-co_website-revamp`
- `https://viding.org/contact` → `http://viding-org_website-revamp/contact`

## URL Transformation API

The service provides several endpoints to manage URL transformations:

### Get Current Rules
```http
GET /url-transformer/rules
```

### Transform a URL
```http
POST /url-transformer/transform
{
  "url": "https://viding.co/page"
}
```

### Add a New Rule
```http
POST /url-transformer/rules
{
  "original_domain": "example.com",
  "new_domain": "example-com_staging",
  "protocol": "https"
}
```

### Remove a Rule
```http
DELETE /url-transformer/rules/example.com
```

### Check if URL is Transformable
```http
GET /url-transformer/check?url=https://viding.co
```

### Test Transformations
```http
GET /url-transformer/test
```

## Features

### Path Preservation
All URL components are preserved during transformation:
- **Path**: `/about` → `/about`
- **Query parameters**: `?ref=test` → `?ref=test`
- **Fragments**: `#section` → `#section`

### www. Subdomain Handling
Both `www.` and non-`www.` versions are handled:
- `https://viding.co` → `http://viding-co_website-revamp`
- `https://www.viding.co` → `http://viding-co_website-revamp`

### Cache Consistency
- Original URLs are used as cache keys
- Transformations don't affect cache behavior
- Multiple requests to the same original URL will hit the cache

### Logging
All URL transformations are logged for debugging and monitoring:
```
INFO: URL transformed for screenshot: https://viding.co -> http://viding-co_website-revamp
```

## Implementation Details

### URL Transformer Class
The `URLTransformer` class handles all transformation logic:
- Parses URLs to extract domains
- Applies transformation rules
- Preserves URL components
- Handles edge cases and malformed URLs

### Integration Points
URL transformation is integrated into:
1. **Single Screenshot API** (`/screenshot`)
2. **Batch Screenshot API** (`/batch/screenshots`)
3. **URL Transformer Management API** (`/url-transformer/*`)

### Error Handling
- Malformed URLs are returned unchanged
- Failed transformations don't break the screenshot process
- All errors are logged for debugging

## Testing

### Unit Tests
Run the URL transformer unit tests:
```bash
python tests/test_url_transformer_unit.py
```

### Integration Tests
Test the full screenshot workflow with transformations:
```bash
python tests/test_url_transformation.py
```

### Manual Testing
Use the test endpoint to verify transformations:
```bash
curl http://localhost:8000/url-transformer/test
```

## Configuration

### Environment Variables
No additional environment variables are required. The transformation rules are managed through the API.

### Adding Custom Rules
You can add custom transformation rules programmatically:

```python
from app.utils.url_transformer import url_transformer

# Add a new rule
url_transformer.add_transformation_rule(
    original_domain="staging.example.com",
    new_domain="example-com_production",
    protocol="https"
)
```

## Monitoring

### Logs
URL transformations are logged with the following information:
- Original URL
- Transformed URL
- Endpoint that triggered the transformation

### Metrics
The transformation feature integrates with the existing monitoring system to track:
- Number of transformations performed
- Most frequently transformed domains
- Transformation success/failure rates

## Security Considerations

### Input Validation
- All URLs are validated before transformation
- Malformed URLs are handled safely
- No arbitrary code execution risks

### Access Control
- Transformation rule management requires API access
- No authentication is currently required (same as other endpoints)
- Consider adding authentication for production use

## Troubleshooting

### Common Issues

**Transformation not working:**
1. Check if the domain is in the transformation rules: `GET /url-transformer/rules`
2. Verify the URL format is correct
3. Check the logs for transformation messages

**Cache not working with transformations:**
1. Transformations use original URLs for caching
2. Clear cache if needed: `DELETE /cache`
3. Check cache statistics: `GET /cache/stats`

**Custom rules not applying:**
1. Verify the rule was added successfully: `GET /url-transformer/rules`
2. Check the domain format (no protocol, no www.)
3. Test the transformation: `POST /url-transformer/transform`

### Debug Commands

```bash
# Check current rules
curl http://localhost:8000/url-transformer/rules

# Test a specific URL
curl -X POST http://localhost:8000/url-transformer/transform \
  -H "Content-Type: application/json" \
  -d '{"url": "https://viding.co"}'

# Check if URL is transformable
curl "http://localhost:8000/url-transformer/check?url=https://viding.co"
```

## Future Enhancements

Potential improvements for the URL transformation feature:
- Regular expression-based rules
- Conditional transformations based on request parameters
- Transformation rule versioning
- A/B testing support
- Integration with external configuration systems
