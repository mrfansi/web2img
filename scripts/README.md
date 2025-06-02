# Web2img Management Scripts

This directory contains all the management and optimization scripts for the web2img service.

## 🚀 Main Management Tool

**`web2img_manager.py`** - The all-in-one management script that combines all functionality:

```bash
# Show help and available commands
python scripts/web2img_manager.py help

# Quick system status
python scripts/web2img_manager.py status

# Configure for 2000 concurrent users
python scripts/web2img_manager.py config 2000

# Monitor performance from logs
python scripts/web2img_manager.py monitor /var/log/web2img.log

# Real-time dashboard
python scripts/web2img_manager.py dashboard

# Optimize system configuration
python scripts/web2img_manager.py optimize

# Validate optimizations
python scripts/web2img_manager.py validate

# Deploy optimizations
python scripts/web2img_manager.py deploy

# EasyPanel monitoring
python scripts/web2img_manager.py easypanel

# Clean up R2 storage
python scripts/web2img_manager.py r2-cleanup --dry-run
```

## 📋 Available Commands

### `config <concurrent_users>`
Configure retry settings based on expected concurrent load.
- Automatically calculates optimal retry settings
- Updates environment configuration
- Supports 100-5000+ concurrent users

### `monitor <log_file>`
Analyze retry performance from log files.
- Parses retry patterns and error types
- Provides performance recommendations
- Suggests configuration improvements

### `optimize [--save]`
Analyze system resources and generate optimized configuration.
- Analyzes CPU, memory, and system resources
- Generates optimized browser pool settings
- Creates performance-tuned configuration

### `validate [--config-only]`
Validate current configuration and run optimization tests.
- Tests browser pool efficiency
- Validates cache performance
- Checks timeout effectiveness
- Runs retry mechanism tests

### `deploy [--rollback <backup_path>]`
Deploy optimizations with backup and validation.
- Creates automatic backups
- Applies optimized configuration
- Validates deployment
- Supports rollback functionality

### `dashboard [--url <app_url>] [--interval <seconds>]`
Real-time performance monitoring dashboard.
- Live system metrics
- Performance scoring
- Capacity utilization
- Automated recommendations

### `easypanel [--url <app_url>] [--json]`
EasyPanel-specific monitoring and recommendations.
- EasyPanel-optimized metrics
- Container performance analysis
- Deployment recommendations

### `r2-cleanup [--dry-run] [--confirm]`
Clean up Cloudflare R2 storage objects.
- Bulk object deletion
- Dry-run mode for safety
- Progress tracking

### `status`
Show quick system status and service health.
- CPU and memory usage
- Browser process count
- Service status check

## 🔧 Dependencies

The script automatically checks for required dependencies:

```bash
# Install all dependencies
pip install psutil aiohttp boto3

# Or install individually as needed
pip install psutil      # For system monitoring
pip install aiohttp     # For async HTTP requests
pip install boto3       # For R2 storage operations
```

## 📁 Individual Scripts (Legacy)

The following individual scripts are still available but **deprecated** in favor of the unified `web2img_manager.py`:

- `configure_retry_settings.py` - Use `web2img_manager.py config` instead
- `monitor_retry_performance.py` - Use `web2img_manager.py monitor` instead
- `optimize_performance.py` - Use `web2img_manager.py optimize` instead
- `validate_config.py` - Use `web2img_manager.py validate --config-only` instead
- `validate_optimizations.py` - Use `web2img_manager.py validate` instead
- `deploy_optimizations.py` - Use `web2img_manager.py deploy` instead
- `performance_dashboard.py` - Use `web2img_manager.py dashboard` instead
- `easypanel_monitor.py` - Use `web2img_manager.py easypanel` instead
- `delete_r2_objects.py` - Use `web2img_manager.py r2-cleanup` instead

## 🎯 Quick Start Guide

1. **Check system status:**
   ```bash
   python scripts/web2img_manager.py status
   ```

2. **Configure for your load:**
   ```bash
   python scripts/web2img_manager.py config 2000
   ```

3. **Optimize system:**
   ```bash
   python scripts/web2img_manager.py optimize --save
   ```

4. **Deploy optimizations:**
   ```bash
   python scripts/web2img_manager.py deploy
   ```

5. **Monitor performance:**
   ```bash
   python scripts/web2img_manager.py dashboard
   ```

## 🚨 Troubleshooting

### Common Issues

**Missing dependencies:**
```bash
pip install psutil aiohttp boto3
```

**Permission errors:**
```bash
chmod +x scripts/web2img_manager.py
```

**Import errors:**
Make sure you're running from the project root directory.

### Getting Help

```bash
# Show all available commands
python scripts/web2img_manager.py help

# Show system status
python scripts/web2img_manager.py status
```

## 📊 Performance Optimization Workflow

1. **Analyze** → `python scripts/web2img_manager.py optimize`
2. **Configure** → `python scripts/web2img_manager.py config <users>`
3. **Deploy** → `python scripts/web2img_manager.py deploy`
4. **Validate** → `python scripts/web2img_manager.py validate`
5. **Monitor** → `python scripts/web2img_manager.py dashboard`

This workflow ensures optimal performance for your specific load requirements.
