# Environment Variables Configuration

This document describes all environment variables used by the Website Screenshot API service.

## Required Variables

### Application Configuration

```bash
# Application environment
NODE_ENV=production                    # Environment: development, production, test

# Server configuration
PORT=3333                             # Port number for the HTTP server
HOST=0.0.0.0                         # Host address to bind to
APP_KEY=your-32-character-secret-key  # Application encryption key (32+ characters)

# Logging
LOG_LEVEL=info                        # Log level: fatal, error, warn, info, debug, trace
```

### Database Configuration

```bash
# MySQL Database
DB_HOST=localhost                     # Database host
DB_PORT=3306                         # Database port
DB_USER=web2img                      # Database username
DB_PASSWORD=your-db-password         # Database password
DB_DATABASE=web2img                  # Database name
```

### Redis Configuration

```bash
# Redis for caching and queues
REDIS_HOST=localhost                 # Redis host
REDIS_PORT=6379                     # Redis port
REDIS_PASSWORD=your-redis-password  # Redis password (optional)
REDIS_DB=0                          # Redis database number
```

## Optional Variables

### ImgProxy Configuration

```bash
# ImgProxy for image processing and delivery
IMGPROXY_BASE_URL=https://imgproxy.example.com  # ImgProxy base URL
IMGPROXY_KEY=your-imgproxy-key                  # ImgProxy signing key
IMGPROXY_SALT=your-imgproxy-salt               # ImgProxy signing salt
```

### Storage Configuration

```bash
# File storage settings
STORAGE_PATH=/app/storage                      # Local storage path
STORAGE_BASE_URL=https://storage.example.com   # Base URL for direct file access
```

### Screenshot System Configuration

```bash
# Screenshot processing settings
SCREENSHOT_TIMEOUT=30000              # Default screenshot timeout (ms)
SCREENSHOT_CACHE_TTL=3600            # Cache TTL in seconds (1 hour)
SCREENSHOT_MAX_CONCURRENT=10         # Max concurrent screenshot processes
SCREENSHOT_QUEUE_CONCURRENCY=5       # Queue worker concurrency
```

### Browser Configuration

```bash
# Playwright browser settings
BROWSER_HEADLESS=true                # Run browser in headless mode
BROWSER_TIMEOUT=30000               # Browser operation timeout (ms)

# Browser pool settings
BROWSER_POOL_MAX_BROWSERS=3         # Maximum number of browser instances
BROWSER_POOL_MAX_PAGES_PER_BROWSER=5 # Maximum pages per browser instance
BROWSER_POOL_BROWSER_TIMEOUT=300000 # Browser instance timeout (ms, 5 minutes)
BROWSER_POOL_PAGE_TIMEOUT=30000     # Page operation timeout (ms, 30 seconds)
```

## Development Environment

Create a `.env` file in your project root:

```bash
# .env file for development
NODE_ENV=development
PORT=3333
HOST=localhost
APP_KEY=your-development-app-key-32-chars-min
LOG_LEVEL=debug

# Database
DB_HOST=localhost
DB_PORT=3306
DB_USER=web2img_dev
DB_PASSWORD=dev_password
DB_DATABASE=web2img_dev

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=1

# ImgProxy (optional for development)
IMGPROXY_BASE_URL=
IMGPROXY_KEY=
IMGPROXY_SALT=

# Storage
STORAGE_PATH=./storage
STORAGE_BASE_URL=http://localhost:3333/storage

# Screenshot settings
SCREENSHOT_TIMEOUT=30000
SCREENSHOT_CACHE_TTL=1800
SCREENSHOT_MAX_CONCURRENT=5
SCREENSHOT_QUEUE_CONCURRENCY=3

# Browser
BROWSER_HEADLESS=true
BROWSER_TIMEOUT=30000

# Browser Pool
BROWSER_POOL_MAX_BROWSERS=3
BROWSER_POOL_MAX_PAGES_PER_BROWSER=5
BROWSER_POOL_BROWSER_TIMEOUT=300000
BROWSER_POOL_PAGE_TIMEOUT=30000
```

## Production Environment

### Docker Environment Variables

```bash
# Production environment variables for Docker
NODE_ENV=production
PORT=3333
HOST=0.0.0.0
APP_KEY=${APP_KEY}
LOG_LEVEL=info

# Database (use environment-specific values)
DB_HOST=${DB_HOST}
DB_PORT=3306
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_DATABASE=${DB_DATABASE}

# Redis
REDIS_HOST=${REDIS_HOST}
REDIS_PORT=6379
REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_DB=0

# ImgProxy
IMGPROXY_BASE_URL=${IMGPROXY_BASE_URL}
IMGPROXY_KEY=${IMGPROXY_KEY}
IMGPROXY_SALT=${IMGPROXY_SALT}

# Storage
STORAGE_PATH=/app/storage
STORAGE_BASE_URL=${STORAGE_BASE_URL}

# Screenshot settings
SCREENSHOT_TIMEOUT=30000
SCREENSHOT_CACHE_TTL=3600
SCREENSHOT_MAX_CONCURRENT=20
SCREENSHOT_QUEUE_CONCURRENCY=10

# Browser
BROWSER_HEADLESS=true
BROWSER_TIMEOUT=30000
```

### Kubernetes ConfigMap Example

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: web2img-config
data:
  NODE_ENV: 'production'
  PORT: '3333'
  HOST: '0.0.0.0'
  LOG_LEVEL: 'info'

  DB_HOST: 'mysql-service'
  DB_PORT: '3306'
  DB_DATABASE: 'web2img'

  REDIS_HOST: 'redis-service'
  REDIS_PORT: '6379'
  REDIS_DB: '0'

  STORAGE_PATH: '/app/storage'

  SCREENSHOT_TIMEOUT: '30000'
  SCREENSHOT_CACHE_TTL: '3600'
  SCREENSHOT_MAX_CONCURRENT: '20'
  SCREENSHOT_QUEUE_CONCURRENCY: '10'

  BROWSER_HEADLESS: 'true'
  BROWSER_TIMEOUT: '30000'
```

### Kubernetes Secrets Example

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: web2img-secrets
type: Opaque
stringData:
  APP_KEY: 'your-production-app-key-32-characters-minimum'
  DB_USER: 'web2img_prod'
  DB_PASSWORD: 'your-secure-db-password'
  REDIS_PASSWORD: 'your-redis-password'
  IMGPROXY_KEY: 'your-imgproxy-key'
  IMGPROXY_SALT: 'your-imgproxy-salt'
  IMGPROXY_BASE_URL: 'https://imgproxy.yourdomain.com'
  STORAGE_BASE_URL: 'https://storage.yourdomain.com'
```

## Environment-Specific Configurations

### Development

```bash
# Optimized for development speed and debugging
NODE_ENV=development
LOG_LEVEL=debug
SCREENSHOT_TIMEOUT=60000
SCREENSHOT_MAX_CONCURRENT=3
SCREENSHOT_QUEUE_CONCURRENCY=2
BROWSER_HEADLESS=false  # For debugging
```

### Testing

```bash
# Optimized for testing
NODE_ENV=test
LOG_LEVEL=error
SCREENSHOT_TIMEOUT=10000
SCREENSHOT_MAX_CONCURRENT=2
SCREENSHOT_QUEUE_CONCURRENCY=1
REDIS_DB=2  # Separate Redis DB for tests
DB_DATABASE=web2img_test
```

### Staging

```bash
# Production-like but with more debugging
NODE_ENV=production
LOG_LEVEL=debug
SCREENSHOT_TIMEOUT=30000
SCREENSHOT_MAX_CONCURRENT=10
SCREENSHOT_QUEUE_CONCURRENCY=5
```

### Production

```bash
# Optimized for performance and stability
NODE_ENV=production
LOG_LEVEL=info
SCREENSHOT_TIMEOUT=30000
SCREENSHOT_MAX_CONCURRENT=50
SCREENSHOT_QUEUE_CONCURRENCY=20
```

## Security Considerations

### Sensitive Variables

Always use secure methods to manage sensitive environment variables:

- `APP_KEY`: Use a cryptographically secure random string
- `DB_PASSWORD`: Use strong database passwords
- `REDIS_PASSWORD`: Use strong Redis passwords
- `IMGPROXY_KEY` and `IMGPROXY_SALT`: Use secure random values

### Best Practices

1. **Never commit secrets to version control**
2. **Use environment-specific secret management**
3. **Rotate secrets regularly**
4. **Use least-privilege access**
5. **Monitor for secret exposure**

### Secret Management Tools

#### AWS Secrets Manager

```bash
# Retrieve secrets from AWS Secrets Manager
APP_KEY=$(aws secretsmanager get-secret-value --secret-id prod/web2img/app-key --query SecretString --output text)
DB_PASSWORD=$(aws secretsmanager get-secret-value --secret-id prod/web2img/db-password --query SecretString --output text)
```

#### HashiCorp Vault

```bash
# Retrieve secrets from Vault
APP_KEY=$(vault kv get -field=app_key secret/web2img/prod)
DB_PASSWORD=$(vault kv get -field=db_password secret/web2img/prod)
```

#### Docker Secrets

```yaml
version: '3.8'
services:
  web2img:
    image: web2img:latest
    secrets:
      - app_key
      - db_password
    environment:
      APP_KEY_FILE: /run/secrets/app_key
      DB_PASSWORD_FILE: /run/secrets/db_password

secrets:
  app_key:
    external: true
  db_password:
    external: true
```

## Performance Tuning

### High-Traffic Configuration

```bash
# For high-traffic production environments
SCREENSHOT_MAX_CONCURRENT=100
SCREENSHOT_QUEUE_CONCURRENCY=50
SCREENSHOT_CACHE_TTL=7200  # 2 hours
REDIS_DB=0

# Browser pool for high traffic
BROWSER_POOL_MAX_BROWSERS=10
BROWSER_POOL_MAX_PAGES_PER_BROWSER=10
BROWSER_POOL_BROWSER_TIMEOUT=600000  # 10 minutes
BROWSER_POOL_PAGE_TIMEOUT=60000      # 1 minute
```

### Memory-Constrained Configuration

```bash
# For memory-constrained environments
SCREENSHOT_MAX_CONCURRENT=5
SCREENSHOT_QUEUE_CONCURRENCY=2
SCREENSHOT_CACHE_TTL=1800  # 30 minutes

# Reduced browser pool for memory constraints
BROWSER_POOL_MAX_BROWSERS=2
BROWSER_POOL_MAX_PAGES_PER_BROWSER=3
BROWSER_POOL_BROWSER_TIMEOUT=180000  # 3 minutes
BROWSER_POOL_PAGE_TIMEOUT=20000      # 20 seconds
```

### CPU-Constrained Configuration

```bash
# For CPU-constrained environments
SCREENSHOT_MAX_CONCURRENT=10
SCREENSHOT_QUEUE_CONCURRENCY=3
BROWSER_TIMEOUT=60000  # Longer timeout for slower processing

# Conservative browser pool for CPU constraints
BROWSER_POOL_MAX_BROWSERS=2
BROWSER_POOL_MAX_PAGES_PER_BROWSER=4
BROWSER_POOL_BROWSER_TIMEOUT=240000  # 4 minutes
BROWSER_POOL_PAGE_TIMEOUT=45000      # 45 seconds
```

## Monitoring and Observability

### Logging Configuration

```bash
# Structured logging for production
LOG_LEVEL=info
LOG_FORMAT=json  # If supported
```

### Metrics Configuration

```bash
# Enable metrics collection
METRICS_ENABLED=true
METRICS_PORT=9090
METRICS_PATH=/metrics
```

### Health Check Configuration

```bash
# Health check settings
HEALTH_CHECK_TIMEOUT=5000
HEALTH_CHECK_INTERVAL=30000
```

## Validation

The application validates all environment variables on startup. Missing required variables will cause the application to fail to start with descriptive error messages.

### Validation Rules

- `NODE_ENV`: Must be one of: development, production, test
- `PORT`: Must be a valid port number (1-65535)
- `APP_KEY`: Must be at least 32 characters
- `DB_PORT`, `REDIS_PORT`: Must be valid port numbers
- `SCREENSHOT_TIMEOUT`: Must be between 5000-60000 ms
- `SCREENSHOT_MAX_CONCURRENT`: Must be positive integer
- URLs: Must be valid HTTP/HTTPS URLs

### Environment Validation Script

```bash
#!/bin/bash
# validate-env.sh - Validate environment variables

required_vars=(
  "NODE_ENV"
  "PORT"
  "APP_KEY"
  "DB_HOST"
  "DB_USER"
  "DB_DATABASE"
  "REDIS_HOST"
)

for var in "${required_vars[@]}"; do
  if [ -z "${!var}" ]; then
    echo "Error: Required environment variable $var is not set"
    exit 1
  fi
done

echo "All required environment variables are set"
```

## Troubleshooting

### Common Issues

#### Database Connection Errors

- Verify `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE`
- Check network connectivity
- Verify database server is running

#### Redis Connection Errors

- Verify `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`
- Check Redis server status
- Verify network connectivity

#### Screenshot Failures

- Check `BROWSER_HEADLESS` setting
- Verify `SCREENSHOT_TIMEOUT` is appropriate
- Check system resources and `SCREENSHOT_MAX_CONCURRENT`

#### Storage Issues

- Verify `STORAGE_PATH` exists and is writable
- Check `STORAGE_BASE_URL` accessibility
- Verify disk space availability

### Debug Mode

Enable debug mode for troubleshooting:

```bash
NODE_ENV=development
LOG_LEVEL=debug
BROWSER_HEADLESS=false
```

This will provide detailed logging and allow visual browser debugging.
