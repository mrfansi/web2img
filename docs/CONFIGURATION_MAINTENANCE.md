# Configuration Maintenance Guide for web2img

This document outlines the ongoing maintenance process to ensure all configuration variables remain properly synchronized and functional, preventing regression to resource-intensive settings.

## 🎯 Maintenance Objectives

1. **Maintain Optimized Performance**: Keep browser pool at 4-12 browsers, cache at 200MB, concurrency at 32/64
2. **Prevent Configuration Drift**: Ensure all environment variables are properly mapped to Settings class
3. **Monitor Resource Usage**: Track memory and CPU impact of configuration changes
4. **Automate Validation**: Use tools to catch issues before they impact production

## 🛠️ Maintenance Tools

### 1. Configuration Audit Tool (`scripts/config_audit.py`)

**Purpose**: Comprehensive configuration consistency checks

**Usage**:

```bash
# Run full audit
python scripts/config_audit.py

# Generate report only
python scripts/config_audit.py --report-only

# Attempt automatic fixes
python scripts/config_audit.py --fix
```

**What it checks**:

- Environment variables missing from Settings class
- Unused environment variables
- Hardcoded values that should be configurable
- Default value mismatches
- Performance impact assessment

**Run frequency**: Weekly or before major deployments

### 2. Configuration Validator (`scripts/config_validator.py`)

**Purpose**: Validate configuration changes against performance requirements

**Usage**:

```bash
# Validate current configuration
python scripts/config_validator.py --validate

# Check performance impact
python scripts/config_validator.py --check-performance
```

**What it validates**:

- Settings within optimal ranges
- Dependency relationships (e.g., contexts = 2x screenshots)
- Resource impact calculations
- Performance regression detection

**Run frequency**: Before any configuration changes

### 3. Configuration Monitor (`scripts/config_monitor.py`)

**Purpose**: Continuous monitoring for performance regressions

**Usage**:

```bash
# Check for regressions
python scripts/config_monitor.py --check

# Create baseline from current config
python scripts/config_monitor.py --baseline

# Create baseline from optimal settings
python scripts/config_monitor.py --optimal-baseline

# Alert on regressions (for CI/CD)
python scripts/config_monitor.py --check --alert-on-regression
```

**What it monitors**:

- Regression thresholds (e.g., >20 browsers, >500MB cache)
- Significant increases from baseline (>50%)
- Resource efficiency scoring
- Historical trend tracking

**Run frequency**: Hourly via cron job

## 📊 Current Optimized Configuration

### Critical Performance Settings

| Setting | Optimized Value | Max Threshold | Impact |
|---------|----------------|---------------|--------|
| `BROWSER_POOL_MAX_SIZE` | 12 | 20 | HIGH - Memory usage |
| `MAX_CONCURRENT_SCREENSHOTS` | 32 | 100 | HIGH - CPU usage |
| `MAX_CONCURRENT_CONTEXTS` | 64 | 200 | HIGH - Memory usage |
| `BROWSER_CACHE_MAX_SIZE_MB` | 200 | 500 | HIGH - Memory per browser |
| `WORKERS` | 8 | 12 | HIGH - CPU cores |
| `MEMORY_CLEANUP_THRESHOLD` | 80 | 95 | MEDIUM - Cleanup frequency |

### Resource Impact Calculations

**Current Optimized Usage**:

- **Memory**: ~4.8GB (12 browsers × 150MB + 12 × 200MB cache + 8 × 100MB workers)
- **CPU**: ~10.4 cores (8 workers + 12 browsers × 0.2)
- **Efficiency Score**: 85-95/100

**Previous Resource-Intensive Settings**:

- **Memory**: ~58GB (50 browsers × 150MB + 50 × 1000MB cache + 16 × 100MB workers)
- **CPU**: ~26 cores (16 workers + 50 browsers × 0.2)
- **Efficiency Score**: 15-25/100

## 🔄 Automated Monitoring Setup

### Cron Job Configuration

Add to your crontab (`crontab -e`):

```bash
# Hourly configuration regression check
0 * * * * cd /path/to/web2img && python scripts/config_monitor.py --check --alert-on-regression >> /var/log/web2img-config.log 2>&1

# Daily comprehensive audit
0 9 * * * cd /path/to/web2img && python scripts/config_audit.py >> /var/log/web2img-audit.log 2>&1

# Weekly validation report
0 9 * * 1 cd /path/to/web2img && python scripts/config_validator.py --validate >> /var/log/web2img-validation.log 2>&1
```

### CI/CD Integration

Add to your deployment pipeline:

```yaml
# .github/workflows/config-check.yml
name: Configuration Validation
on: [push, pull_request]

jobs:
  config-validation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Setup Python
        uses: actions/setup-python@v2
        with:
          python-version: '3.9'
      - name: Validate Configuration
        run: |
          python scripts/config_validator.py --validate
          python scripts/config_monitor.py --check --alert-on-regression
```

## 📋 Maintenance Checklist

### Weekly Tasks

- [ ] Run configuration audit: `python scripts/config_audit.py`
- [ ] Review audit report for new issues
- [ ] Check resource usage trends
- [ ] Verify no hardcoded values introduced

### Before Configuration Changes

- [ ] Run validator: `python scripts/config_validator.py --validate`
- [ ] Document the change purpose and expected impact
- [ ] Test in staging environment first
- [ ] Create backup of current configuration

### After Configuration Changes

- [ ] Run monitor check: `python scripts/config_monitor.py --check`
- [ ] Verify no performance regressions
- [ ] Monitor actual resource usage for 24 hours
- [ ] Update baseline if change is permanent

### Monthly Tasks

- [ ] Review configuration history trends
- [ ] Update documentation for any new settings
- [ ] Assess if optimal values need adjustment
- [ ] Clean up unused environment variables

## 🚨 Regression Alert Response

### High-Severity Alerts

If monitoring detects high-severity regressions:

1. **Immediate Actions**:

   ```bash
   # Check current configuration
   python scripts/config_validator.py --validate
   
   # Compare with baseline
   python scripts/config_monitor.py --check
   
   # Review recent changes
   git log --oneline -10 -- .env.production app/core/config.py
   ```

2. **Assessment**:
   - Identify which settings exceeded thresholds
   - Calculate resource impact increase
   - Determine if change was intentional

3. **Resolution**:
   - Revert to baseline if unintentional: `git checkout HEAD~1 .env.production`
   - Adjust settings to optimal ranges
   - Update baseline if change is permanent

### Medium-Severity Alerts

For medium-severity issues:

- Schedule review within 24 hours
- Monitor resource usage trends
- Plan optimization if needed

## 📚 Configuration Variable Guidelines

### Adding New Configuration Variables

1. **Define in Settings Class**:

   ```python
   new_setting: int = Field(
       default_factory=lambda: int(os.getenv("NEW_SETTING", "default_value"))
   )
   ```

2. **Add to .env.production**:

   ```bash
   # Description of what this setting controls
   NEW_SETTING=optimal_value
   ```

3. **Document**:
   - Add to validation rules if performance-critical
   - Update this maintenance guide
   - Add comments explaining purpose and impact

### Naming Conventions

- **Environment Variables**: `UPPER_SNAKE_CASE`
- **Settings Class Fields**: `lower_snake_case`
- **Consistent Mapping**: `NEW_SETTING` → `new_setting`

### Default Value Guidelines

- Use production-optimized defaults in Settings class
- Align defaults with current .env.production values
- Consider resource impact when setting defaults
- Document reasoning for chosen values

## 🔍 Troubleshooting Common Issues

### Issue: Environment Variable Not Taking Effect

**Symptoms**: Setting in .env.production but using default value

**Diagnosis**:

```bash
python scripts/config_audit.py | grep "missing_from_settings"
```

**Solution**: Add missing Field definition to Settings class

### Issue: High Memory Usage After Config Change

**Symptoms**: Memory usage spike after configuration update

**Diagnosis**:

```bash
python scripts/config_validator.py --check-performance
```

**Solution**: Check browser pool size, cache limits, and worker count

### Issue: Configuration Drift

**Symptoms**: Settings gradually becoming less optimal

**Diagnosis**:

```bash
python scripts/config_monitor.py --check
```

**Solution**: Review and revert to baseline values

## 📈 Performance Monitoring Integration

### Metrics to Track

- **Memory Usage**: Should stay under 6GB total
- **CPU Usage**: Should stay under 12 cores
- **Response Times**: Should remain under 10 seconds
- **Error Rates**: Should stay under 1%

### Alerting Thresholds

- **Critical**: Memory >8GB or CPU >16 cores
- **Warning**: Memory >6GB or CPU >12 cores
- **Info**: Any configuration changes detected

## 🎯 Success Metrics

The configuration maintenance process is successful when:

- ✅ No high-severity configuration regressions for 30 days
- ✅ Memory usage consistently under 6GB
- ✅ CPU usage consistently under 12 cores
- ✅ All environment variables properly mapped to Settings class
- ✅ No unused configuration variables
- ✅ Configuration changes validated before deployment

This maintenance process ensures your web2img service maintains optimal performance while preventing regression to the previous resource-intensive configuration.
