#!/bin/bash

# Configuration Monitoring Setup Script for web2img
# This script sets up automated configuration monitoring and validation

set -e

echo "🔧 Setting up web2img configuration monitoring..."

# Get the project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "📁 Project root: $PROJECT_ROOT"

# Make scripts executable
echo "🔐 Making scripts executable..."
chmod +x scripts/config_audit.py
chmod +x scripts/config_validator.py
chmod +x scripts/config_monitor.py

# Create log directory
echo "📝 Creating log directory..."
mkdir -p logs

# Create baseline from current optimized configuration
echo "📊 Creating configuration baseline..."
python3 scripts/config_monitor.py --optimal-baseline

# Run initial validation
echo "✅ Running initial configuration validation..."
if python3 scripts/config_validator.py --validate; then
    echo "✅ Configuration validation passed!"
else
    echo "⚠️  Configuration validation found issues. Please review."
fi

# Run initial audit
echo "🔍 Running initial configuration audit..."
python3 scripts/config_audit.py > logs/initial_config_audit.log 2>&1
echo "📄 Audit report saved to logs/initial_config_audit.log"

# Create cron job entries (but don't install automatically)
echo "⏰ Creating cron job template..."
cat > scripts/crontab_template.txt << 'EOF'
# web2img Configuration Monitoring Cron Jobs
# Add these entries to your crontab with: crontab -e

# Hourly configuration regression check
0 * * * * cd PROJECT_ROOT && python3 scripts/config_monitor.py --check --alert-on-regression >> logs/config_monitor.log 2>&1

# Daily comprehensive audit
0 9 * * * cd PROJECT_ROOT && python3 scripts/config_audit.py >> logs/config_audit.log 2>&1

# Weekly validation report
0 9 * * 1 cd PROJECT_ROOT && python3 scripts/config_validator.py --validate >> logs/config_validation.log 2>&1

# Monthly cleanup of old logs (keep last 30 days)
0 2 1 * * find PROJECT_ROOT/logs -name "*.log" -mtime +30 -delete
EOF

# Replace PROJECT_ROOT placeholder
sed -i.bak "s|PROJECT_ROOT|$PROJECT_ROOT|g" scripts/crontab_template.txt
rm scripts/crontab_template.txt.bak

echo "📋 Cron job template created at scripts/crontab_template.txt"

# Create systemd service file template (optional)
echo "🔧 Creating systemd service template..."
cat > scripts/web2img-config-monitor.service << EOF
[Unit]
Description=web2img Configuration Monitor
After=network.target

[Service]
Type=oneshot
User=$(whoami)
WorkingDirectory=$PROJECT_ROOT
ExecStart=/usr/bin/python3 $PROJECT_ROOT/scripts/config_monitor.py --check --alert-on-regression
StandardOutput=append:$PROJECT_ROOT/logs/config_monitor.log
StandardError=append:$PROJECT_ROOT/logs/config_monitor.log

[Install]
WantedBy=multi-user.target
EOF

cat > scripts/web2img-config-monitor.timer << EOF
[Unit]
Description=Run web2img Configuration Monitor hourly
Requires=web2img-config-monitor.service

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
EOF

echo "🔧 Systemd service files created (optional alternative to cron)"

# Create monitoring dashboard script
echo "📊 Creating monitoring dashboard..."
cat > scripts/config_dashboard.py << 'EOF'
#!/usr/bin/env python3
"""
Simple configuration monitoring dashboard
Shows current status and recent history
"""

import json
import sys
from pathlib import Path
from datetime import datetime, timedelta

project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

def show_dashboard():
    print("=" * 60)
    print("📊 WEB2IMG CONFIGURATION DASHBOARD")
    print("=" * 60)
    
    # Load current configuration
    from scripts.config_monitor import ConfigMonitor
    monitor = ConfigMonitor()
    
    current_config = monitor.load_current_config()
    if not current_config:
        print("❌ Could not load current configuration")
        return
    
    # Show key metrics
    metrics = monitor.calculate_performance_metrics(current_config)
    print(f"\n📈 CURRENT PERFORMANCE METRICS:")
    print(f"   Memory Usage: {metrics['estimated_memory_mb']:.0f}MB")
    print(f"   CPU Usage: {metrics['estimated_cpu_usage']:.1f} cores")
    print(f"   Efficiency Score: {metrics['resource_efficiency_score']:.1f}/100")
    
    # Show key settings
    print(f"\n⚙️  KEY CONFIGURATION SETTINGS:")
    key_settings = [
        "BROWSER_POOL_MAX_SIZE", "MAX_CONCURRENT_SCREENSHOTS", 
        "BROWSER_CACHE_MAX_SIZE_MB", "WORKERS"
    ]
    for setting in key_settings:
        value = current_config.get(setting, "Not set")
        optimal = monitor.optimal_baseline.get(setting, "Unknown")
        status = "✅" if value == optimal else "⚠️"
        print(f"   {status} {setting}: {value} (optimal: {optimal})")
    
    # Show recent history if available
    history_file = project_root / "config_history.json"
    if history_file.exists():
        with open(history_file, 'r') as f:
            history = json.load(f)
        
        if history:
            recent = history[-5:]  # Last 5 entries
            print(f"\n📊 RECENT MONITORING HISTORY:")
            for entry in recent:
                timestamp = datetime.fromisoformat(entry['timestamp'])
                regressions = entry['regressions_found']
                efficiency = entry['performance_metrics']['resource_efficiency_score']
                status = "✅" if regressions == 0 else f"⚠️ {regressions} issues"
                print(f"   {timestamp.strftime('%Y-%m-%d %H:%M')} - {status} - Efficiency: {efficiency:.1f}/100")
    
    print(f"\n🔧 MAINTENANCE COMMANDS:")
    print(f"   Validate: python3 scripts/config_validator.py --validate")
    print(f"   Audit: python3 scripts/config_audit.py")
    print(f"   Monitor: python3 scripts/config_monitor.py --check")

if __name__ == "__main__":
    show_dashboard()
EOF

chmod +x scripts/config_dashboard.py

# Test the monitoring system
echo "🧪 Testing monitoring system..."
if python3 scripts/config_monitor.py --check; then
    echo "✅ Monitoring system test passed!"
else
    echo "⚠️  Monitoring system test found issues."
fi

echo ""
echo "🎉 Configuration monitoring setup complete!"
echo ""
echo "📋 NEXT STEPS:"
echo ""
echo "1. 📅 Set up automated monitoring (choose one):"
echo "   Option A - Cron jobs:"
echo "     crontab -e"
echo "     # Then add entries from scripts/crontab_template.txt"
echo ""
echo "   Option B - Systemd (if available):"
echo "     sudo cp scripts/web2img-config-monitor.* /etc/systemd/system/"
echo "     sudo systemctl enable web2img-config-monitor.timer"
echo "     sudo systemctl start web2img-config-monitor.timer"
echo ""
echo "2. 🔍 Manual monitoring commands:"
echo "   python3 scripts/config_dashboard.py          # View dashboard"
echo "   python3 scripts/config_validator.py --validate  # Validate config"
echo "   python3 scripts/config_audit.py              # Full audit"
echo "   python3 scripts/config_monitor.py --check    # Check regressions"
echo ""
echo "3. 📚 Documentation:"
echo "   Read docs/CONFIGURATION_MAINTENANCE.md for detailed guidance"
echo ""
echo "4. 🚨 Emergency procedures:"
echo "   If regressions detected: Review logs/config_monitor.log"
echo "   Revert config: git checkout HEAD~1 .env.production"
echo "   Restore baseline: python3 scripts/config_monitor.py --optimal-baseline"
echo ""
echo "✅ Your web2img configuration is now monitored and protected!"
