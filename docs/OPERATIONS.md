# Operations Runbook

This document provides operational procedures for monitoring, troubleshooting, and maintaining the Website Screenshot API service.

## Table of Contents

1. [Service Overview](#service-overview)
2. [Monitoring](#monitoring)
3. [Health Checks](#health-checks)
4. [Troubleshooting](#troubleshooting)
5. [Maintenance Procedures](#maintenance-procedures)
6. [Incident Response](#incident-response)
7. [Performance Tuning](#performance-tuning)
8. [Backup and Recovery](#backup-and-recovery)

## Service Overview

### Architecture Components

- **Web Application**: AdonisJS-based API server
- **Database**: MySQL for persistent data
- **Cache**: Redis for caching and job queues
- **Browser Service**: Playwright for screenshot generation
- **File Storage**: Local/cloud storage for screenshots
- **ImgProxy**: Image processing and delivery
- **Load Balancer**: Nginx for traffic distribution

### Key Metrics

- Request rate (requests/second)
- Response time (95th percentile)
- Error rate (%)
- Queue depth (pending jobs)
- Cache hit rate (%)
- Browser instance count
- Storage usage (GB)

## Monitoring

### Health Check Endpoints

#### Basic Health Check
```bash
curl -f http://localhost:3333/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:00:00Z",
  "uptime": 3600
}
```

#### Detailed Health Check
```bash
curl -f http://localhost:3333/health/detailed
```

#### Component-Specific Health Checks
```bash
# Database health
curl -f http://localhost:3333/health/database

# Redis health
curl -f http://localhost:3333/health/redis

# Browser service health
curl -f http://localhost:3333/health/browser

# Storage health
curl -f http://localhost:3333/health/storage
```

### Metrics Endpoints

#### Request Metrics
```bash
curl http://localhost:3333/metrics/requests
```

#### Processing Metrics
```bash
curl http://localhost:3333/metrics/processing
```

#### System Metrics
```bash
curl http://localhost:3333/metrics/system
```

### Log Monitoring

#### Application Logs
```bash
# Docker Compose
docker-compose logs -f web2img

# Kubernetes
kubectl logs -f deployment/web2img -n web2img-prod

# Direct log files
tail -f /var/log/web2img/application.log
```

#### Log Levels
- `ERROR`: Critical errors requiring immediate attention
- `WARN`: Warning conditions that should be monitored
- `INFO`: General operational information
- `DEBUG`: Detailed debugging information

#### Key Log Patterns to Monitor

```bash
# Error patterns
grep -E "(ERROR|FATAL)" /var/log/web2img/application.log

# Performance issues
grep -E "(timeout|slow|performance)" /var/log/web2img/application.log

# Queue issues
grep -E "(queue|job.*failed|worker.*error)" /var/log/web2img/application.log

# Authentication issues
grep -E "(auth.*failed|invalid.*key|rate.*limit)" /var/log/web2img/application.log
```

### Alerting Rules

#### Critical Alerts (Page immediately)

1. **Service Down**
   - Health check fails for > 2 minutes
   - HTTP 5xx error rate > 5% for > 5 minutes

2. **Database Issues**
   - Database connection failures
   - Query timeout rate > 10%

3. **Queue Backup**
   - Queue depth > 1000 jobs for > 10 minutes
   - Job processing rate drops to 0

#### Warning Alerts (Notify during business hours)

1. **Performance Degradation**
   - Response time 95th percentile > 5 seconds
   - Cache hit rate < 70%

2. **Resource Usage**
   - CPU usage > 80% for > 15 minutes
   - Memory usage > 85% for > 15 minutes
   - Disk usage > 90%

3. **Browser Issues**
   - Browser instance count > expected
   - Screenshot failure rate > 15%

## Health Checks

### Automated Health Checks

#### Docker Health Check
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3333/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"
```

#### Kubernetes Liveness Probe
```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 3333
  initialDelaySeconds: 60
  periodSeconds: 30
  timeoutSeconds: 10
  failureThreshold: 3
```

#### Kubernetes Readiness Probe
```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: 3333
  initialDelaySeconds: 30
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
```

### Manual Health Verification

#### Complete System Check
```bash
#!/bin/bash
# health-check.sh

echo "=== Web2img Health Check ==="

# Basic health
echo "1. Basic health check..."
if curl -f -s http://localhost:3333/health > /dev/null; then
    echo "✅ Basic health: OK"
else
    echo "❌ Basic health: FAILED"
fi

# Database
echo "2. Database check..."
if curl -f -s http://localhost:3333/health/database > /dev/null; then
    echo "✅ Database: OK"
else
    echo "❌ Database: FAILED"
fi

# Redis
echo "3. Redis check..."
if curl -f -s http://localhost:3333/health/redis > /dev/null; then
    echo "✅ Redis: OK"
else
    echo "❌ Redis: FAILED"
fi

# Browser service
echo "4. Browser service check..."
if curl -f -s http://localhost:3333/health/browser > /dev/null; then
    echo "✅ Browser service: OK"
else
    echo "❌ Browser service: FAILED"
fi

# Storage
echo "5. Storage check..."
if curl -f -s http://localhost:3333/health/storage > /dev/null; then
    echo "✅ Storage: OK"
else
    echo "❌ Storage: FAILED"
fi

# Functional test
echo "6. Functional test..."
if curl -f -s -H "X-API-Key: test-key" -H "Content-Type: application/json" \
   -d '{"url":"https://httpbin.org/json"}' \
   http://localhost:3333/screenshot > /dev/null; then
    echo "✅ Functional test: OK"
else
    echo "❌ Functional test: FAILED"
fi

echo "=== Health Check Complete ==="
```

## Troubleshooting

### Common Issues

#### 1. Service Won't Start

**Symptoms:**
- Container exits immediately
- Health checks fail
- Connection refused errors

**Diagnosis:**
```bash
# Check container logs
docker logs web2img_web2img_1

# Check environment variables
docker exec web2img_web2img_1 env | grep -E "(DB_|REDIS_|APP_)"

# Check port binding
netstat -tlnp | grep 3333
```

**Solutions:**
- Verify environment variables are set correctly
- Check database and Redis connectivity
- Ensure APP_KEY is at least 32 characters
- Verify port 3333 is not already in use

#### 2. Database Connection Issues

**Symptoms:**
- "Database connection failed" errors
- Timeouts on database operations
- Migration failures

**Diagnosis:**
```bash
# Test database connectivity
mysql -h $DB_HOST -P $DB_PORT -u $DB_USER -p$DB_PASSWORD $DB_DATABASE -e "SELECT 1"

# Check database logs
docker logs web2img_mysql_1

# Check connection pool status
curl http://localhost:3333/health/database
```

**Solutions:**
- Verify database credentials
- Check database server status
- Increase connection timeout
- Check firewall rules
- Verify database exists and user has permissions

#### 3. Redis Connection Issues

**Symptoms:**
- Cache misses increase dramatically
- Queue jobs not processing
- "Redis connection failed" errors

**Diagnosis:**
```bash
# Test Redis connectivity
redis-cli -h $REDIS_HOST -p $REDIS_PORT -a $REDIS_PASSWORD ping

# Check Redis logs
docker logs web2img_redis_1

# Check Redis memory usage
redis-cli -h $REDIS_HOST -p $REDIS_PORT -a $REDIS_PASSWORD info memory
```

**Solutions:**
- Verify Redis credentials
- Check Redis server status
- Clear Redis memory if full
- Check network connectivity
- Restart Redis service if needed

#### 4. Screenshot Generation Failures

**Symptoms:**
- High screenshot failure rate
- Timeout errors
- Browser crashes

**Diagnosis:**
```bash
# Check browser service health
curl http://localhost:3333/health/browser

# Check browser logs
docker logs web2img_web2img_1 | grep -i browser

# Check system resources
docker stats web2img_web2img_1

# Test specific URL
curl -H "X-API-Key: test-key" -H "Content-Type: application/json" \
     -d '{"url":"https://httpbin.org/json"}' \
     http://localhost:3333/screenshot
```

**Solutions:**
- Increase screenshot timeout
- Reduce concurrent browser instances
- Check target URL accessibility
- Restart browser service
- Increase memory allocation

#### 5. Queue Backup

**Symptoms:**
- Jobs stuck in pending state
- Queue depth continuously growing
- Workers not processing jobs

**Diagnosis:**
```bash
# Check queue metrics
curl http://localhost:3333/metrics/processing

# Check worker logs
docker logs web2img_web2img_1 | grep -i worker

# Check Redis queue status
redis-cli -h $REDIS_HOST -p $REDIS_PORT -a $REDIS_PASSWORD llen "web2img:queue:screenshot:waiting"
```

**Solutions:**
- Restart queue workers
- Increase worker concurrency
- Clear stuck jobs from queue
- Check for memory leaks
- Scale up worker instances

#### 6. High Memory Usage

**Symptoms:**
- Out of memory errors
- Container restarts
- Slow performance

**Diagnosis:**
```bash
# Check memory usage
docker stats web2img_web2img_1

# Check for memory leaks
curl http://localhost:3333/metrics/system

# Check browser instances
ps aux | grep chromium
```

**Solutions:**
- Restart the service
- Reduce concurrent operations
- Increase memory limits
- Check for memory leaks in code
- Optimize browser instance management

### Debugging Commands

#### Container Debugging
```bash
# Enter container shell
docker exec -it web2img_web2img_1 /bin/sh

# Check running processes
docker exec web2img_web2img_1 ps aux

# Check file system usage
docker exec web2img_web2img_1 df -h

# Check network connectivity
docker exec web2img_web2img_1 ping google.com
```

#### Application Debugging
```bash
# Enable debug logging
docker exec web2img_web2img_1 env LOG_LEVEL=debug

# Check application configuration
docker exec web2img_web2img_1 node ace env:get

# Run database migrations manually
docker exec web2img_web2img_1 node ace migration:run

# Clear cache
docker exec web2img_web2img_1 node ace cache:clear
```

## Maintenance Procedures

### Regular Maintenance Tasks

#### Daily Tasks
1. **Monitor System Health**
   ```bash
   ./scripts/health-check.sh
   ```

2. **Check Error Logs**
   ```bash
   docker logs web2img_web2img_1 | grep ERROR | tail -50
   ```

3. **Monitor Queue Depth**
   ```bash
   curl http://localhost:3333/metrics/processing | jq '.queues'
   ```

#### Weekly Tasks
1. **Clean Up Old Screenshots**
   ```bash
   # Remove screenshots older than 30 days
   find /app/storage/screenshots -type f -mtime +30 -delete
   ```

2. **Database Maintenance**
   ```bash
   # Optimize database tables
   docker exec web2img_mysql_1 mysqlcheck -o --all-databases -u root -p
   ```

3. **Update Dependencies**
   ```bash
   npm audit
   npm update
   ```

#### Monthly Tasks
1. **Security Updates**
   ```bash
   # Update base images
   docker pull node:18-alpine
   docker pull mysql:8.0
   docker pull redis:7-alpine
   ```

2. **Performance Review**
   - Review response time metrics
   - Analyze cache hit rates
   - Check resource utilization trends

3. **Backup Verification**
   - Test database backup restoration
   - Verify screenshot storage backups

### Scaling Procedures

#### Horizontal Scaling
```bash
# Scale web application
docker-compose up -d --scale web2img=3

# Scale in Kubernetes
kubectl scale deployment web2img --replicas=5 -n web2img-prod
```

#### Vertical Scaling
```yaml
# Update resource limits
resources:
  limits:
    cpu: "4.0"
    memory: "4Gi"
  requests:
    cpu: "2.0"
    memory: "2Gi"
```

### Update Procedures

#### Application Updates
```bash
# Deploy new version
./scripts/deploy.sh production -v v1.2.3

# Rollback if needed
./scripts/deploy.sh production --rollback v1.2.2
```

#### Database Schema Updates
```bash
# Run migrations
docker exec web2img_web2img_1 node ace migration:run

# Rollback migrations if needed
docker exec web2img_web2img_1 node ace migration:rollback
```

## Incident Response

### Incident Classification

#### Severity 1 (Critical)
- Service completely down
- Data loss or corruption
- Security breach

**Response Time:** Immediate (< 15 minutes)

#### Severity 2 (High)
- Significant performance degradation
- Partial service outage
- High error rates

**Response Time:** < 1 hour

#### Severity 3 (Medium)
- Minor performance issues
- Non-critical feature failures
- Monitoring alerts

**Response Time:** < 4 hours

#### Severity 4 (Low)
- Cosmetic issues
- Enhancement requests
- Documentation updates

**Response Time:** Next business day

### Incident Response Procedures

#### 1. Initial Response
1. **Acknowledge the incident**
2. **Assess severity level**
3. **Notify stakeholders**
4. **Begin investigation**

#### 2. Investigation
1. **Check service health**
   ```bash
   ./scripts/health-check.sh
   ```

2. **Review recent changes**
   ```bash
   git log --oneline -10
   ```

3. **Check system metrics**
   ```bash
   curl http://localhost:3333/metrics/system
   ```

4. **Analyze logs**
   ```bash
   docker logs web2img_web2img_1 --since="1h" | grep ERROR
   ```

#### 3. Mitigation
1. **Apply immediate fixes**
2. **Scale resources if needed**
3. **Rollback if necessary**
4. **Implement workarounds**

#### 4. Resolution
1. **Verify fix effectiveness**
2. **Monitor for recurrence**
3. **Update stakeholders**
4. **Document resolution**

#### 5. Post-Incident
1. **Conduct post-mortem**
2. **Identify root cause**
3. **Implement preventive measures**
4. **Update runbooks**

### Emergency Contacts

- **On-Call Engineer**: +1-555-0123
- **Database Admin**: +1-555-0124
- **Security Team**: +1-555-0125
- **Management**: +1-555-0126

### Rollback Procedures

#### Quick Rollback
```bash
# Rollback to previous version
./scripts/deploy.sh production --rollback v1.2.2 -f
```

#### Database Rollback
```bash
# Rollback database migrations
docker exec web2img_web2img_1 node ace migration:rollback --batch=1
```

#### Configuration Rollback
```bash
# Restore previous configuration
git checkout HEAD~1 -- .env.production
docker-compose up -d
```

## Performance Tuning

### Performance Monitoring

#### Key Performance Indicators
- Response time (95th percentile < 2 seconds)
- Throughput (> 100 requests/second)
- Error rate (< 1%)
- Cache hit rate (> 80%)
- Queue processing rate (> 50 jobs/minute)

#### Performance Testing
```bash
# Load testing with Apache Bench
ab -n 1000 -c 10 -H "X-API-Key: test-key" \
   -p screenshot-request.json -T application/json \
   http://localhost:3333/screenshot

# Stress testing with wrk
wrk -t12 -c400 -d30s --script=screenshot-test.lua \
    http://localhost:3333/screenshot
```

### Optimization Strategies

#### 1. Database Optimization
```sql
-- Add indexes for frequently queried columns
CREATE INDEX idx_batch_jobs_status ON batch_jobs(status);
CREATE INDEX idx_api_keys_key ON api_keys(key);

-- Optimize queries
EXPLAIN SELECT * FROM batch_jobs WHERE status = 'pending';
```

#### 2. Cache Optimization
```bash
# Increase cache TTL for stable content
SCREENSHOT_CACHE_TTL=7200

# Optimize Redis memory usage
redis-cli CONFIG SET maxmemory-policy allkeys-lru
```

#### 3. Queue Optimization
```bash
# Increase worker concurrency
SCREENSHOT_QUEUE_CONCURRENCY=20

# Optimize job processing
SCREENSHOT_MAX_CONCURRENT=50
```

#### 4. Browser Optimization
```bash
# Optimize browser settings
BROWSER_HEADLESS=true
BROWSER_TIMEOUT=30000

# Use browser pooling
BROWSER_POOL_SIZE=10
```

## Backup and Recovery

### Backup Procedures

#### Database Backup
```bash
# Daily database backup
docker exec web2img_mysql_1 mysqldump -u root -p web2img > backup_$(date +%Y%m%d).sql

# Automated backup script
#!/bin/bash
BACKUP_DIR="/backups/mysql"
DATE=$(date +%Y%m%d_%H%M%S)
docker exec web2img_mysql_1 mysqldump -u root -p web2img | gzip > "$BACKUP_DIR/web2img_$DATE.sql.gz"

# Keep only last 30 days of backups
find "$BACKUP_DIR" -name "web2img_*.sql.gz" -mtime +30 -delete
```

#### File Storage Backup
```bash
# Backup screenshot storage
rsync -av /app/storage/screenshots/ /backups/screenshots/

# Automated storage backup
#!/bin/bash
BACKUP_DIR="/backups/storage"
DATE=$(date +%Y%m%d)
tar -czf "$BACKUP_DIR/screenshots_$DATE.tar.gz" /app/storage/screenshots/
```

#### Configuration Backup
```bash
# Backup configuration files
tar -czf config_backup_$(date +%Y%m%d).tar.gz \
    .env.production \
    docker-compose.prod.yml \
    nginx/nginx.conf
```

### Recovery Procedures

#### Database Recovery
```bash
# Restore from backup
docker exec -i web2img_mysql_1 mysql -u root -p web2img < backup_20240115.sql

# Point-in-time recovery
docker exec web2img_mysql_1 mysqlbinlog --start-datetime="2024-01-15 10:00:00" \
    --stop-datetime="2024-01-15 11:00:00" /var/lib/mysql/mysql-bin.000001 | \
    docker exec -i web2img_mysql_1 mysql -u root -p web2img
```

#### File Storage Recovery
```bash
# Restore screenshot storage
rsync -av /backups/screenshots/ /app/storage/screenshots/

# Restore from tar backup
tar -xzf screenshots_20240115.tar.gz -C /
```

#### Disaster Recovery
```bash
# Complete system recovery
1. Restore database from backup
2. Restore file storage from backup
3. Deploy application from known good version
4. Verify system functionality
5. Update DNS if needed
```

### Backup Verification

#### Automated Backup Testing
```bash
#!/bin/bash
# test-backup.sh

# Test database backup
echo "Testing database backup..."
docker run --rm -v $(pwd):/backup mysql:8.0 \
    mysql -h test-db -u root -p < /backup/backup_latest.sql

# Test file backup
echo "Testing file backup..."
tar -tzf screenshots_latest.tar.gz | head -10

echo "Backup verification complete"
```

This operations runbook provides comprehensive procedures for maintaining the Website Screenshot API service. Regular review and updates of these procedures ensure effective service management and quick incident resolution.