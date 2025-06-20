#!/usr/bin/env python3
"""
Configuration Monitoring Script for web2img

This script monitors configuration changes and ensures they don't regress
to resource-intensive settings. It can be run as a cron job or CI check.

Usage:
    python scripts/config_monitor.py --check
    python scripts/config_monitor.py --baseline
    python scripts/config_monitor.py --alert-on-regression
"""

import os
import sys
import json
import time
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, List, Optional

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

class ConfigMonitor:
    """Monitor configuration changes and prevent performance regression."""
    
    def __init__(self):
        self.project_root = project_root
        self.env_file = project_root / ".env.production"
        self.baseline_file = project_root / "config_baseline.json"
        self.history_file = project_root / "config_history.json"
        
        # Define optimal baseline values (our current optimized settings)
        self.optimal_baseline = {
            "BROWSER_POOL_MIN_SIZE": 4,
            "BROWSER_POOL_MAX_SIZE": 12,
            "BROWSER_POOL_IDLE_TIMEOUT": 1800,
            "BROWSER_POOL_MAX_AGE": 3600,
            "BROWSER_POOL_CLEANUP_INTERVAL": 300,
            "MAX_CONCURRENT_SCREENSHOTS": 32,
            "MAX_CONCURRENT_CONTEXTS": 64,
            "BROWSER_CACHE_MAX_SIZE_MB": 200,
            "CACHE_MAX_ITEMS": 300,
            "WORKERS": 8,
            "MEMORY_CLEANUP_THRESHOLD": 80,
            "POOL_WATCHDOG_INTERVAL": 300,
            "POOL_WATCHDOG_USAGE_THRESHOLD": 0.8,
            "POOL_WATCHDOG_IDLE_THRESHOLD": 1800,
            "SCREENSHOT_CLEANUP_INTERVAL": 1800,
            "TEMP_FILE_RETENTION_HOURS": 6,
            "BROWSER_CACHE_CLEANUP_INTERVAL": 1800,
            "FORCE_BROWSER_RESTART_INTERVAL": 7200,
        }
        
        # Define regression thresholds (values that indicate performance regression)
        self.regression_thresholds = {
            "BROWSER_POOL_MAX_SIZE": 20,  # Alert if > 20 browsers
            "MAX_CONCURRENT_SCREENSHOTS": 100,  # Alert if > 100 concurrent
            "MAX_CONCURRENT_CONTEXTS": 200,  # Alert if > 200 contexts
            "BROWSER_CACHE_MAX_SIZE_MB": 500,  # Alert if > 500MB cache
            "WORKERS": 12,  # Alert if > 12 workers
            "MEMORY_CLEANUP_THRESHOLD": 95,  # Alert if cleanup threshold > 95%
        }
    
    def load_current_config(self) -> Dict[str, Any]:
        """Load current configuration from .env.production."""
        config = {}
        
        if not self.env_file.exists():
            return config
            
        with open(self.env_file, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    key = key.strip()
                    value = value.strip()
                    
                    # Convert to appropriate type
                    if value.lower() in ('true', 'false'):
                        config[key] = value.lower() == 'true'
                    elif value.replace('.', '').replace('-', '').isdigit():
                        config[key] = float(value) if '.' in value else int(value)
                    else:
                        config[key] = value
                        
        return config
    
    def save_baseline(self, config: Dict[str, Any]) -> None:
        """Save current configuration as baseline."""
        baseline_data = {
            "timestamp": datetime.now().isoformat(),
            "config": config,
            "description": "Optimized configuration baseline",
            "performance_metrics": self.calculate_performance_metrics(config)
        }
        
        with open(self.baseline_file, 'w') as f:
            json.dump(baseline_data, f, indent=2)
        
        print(f"✅ Baseline saved to {self.baseline_file}")
    
    def load_baseline(self) -> Optional[Dict[str, Any]]:
        """Load baseline configuration."""
        if not self.baseline_file.exists():
            return None
            
        with open(self.baseline_file, 'r') as f:
            return json.load(f)
    
    def calculate_performance_metrics(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate performance metrics for configuration."""
        browser_pool_size = config.get("BROWSER_POOL_MAX_SIZE", 12)
        cache_size_per_browser = config.get("BROWSER_CACHE_MAX_SIZE_MB", 200)
        workers = config.get("WORKERS", 8)
        concurrent_screenshots = config.get("MAX_CONCURRENT_SCREENSHOTS", 32)
        
        return {
            "estimated_memory_mb": (browser_pool_size * 150) + (browser_pool_size * cache_size_per_browser) + (workers * 100),
            "estimated_cpu_usage": workers + (browser_pool_size * 0.2),
            "max_throughput": concurrent_screenshots,
            "resource_efficiency_score": self.calculate_efficiency_score(config)
        }
    
    def calculate_efficiency_score(self, config: Dict[str, Any]) -> float:
        """Calculate efficiency score (0-100, higher is better)."""
        score = 100.0
        
        # Penalize excessive resource usage
        browser_pool = config.get("BROWSER_POOL_MAX_SIZE", 12)
        if browser_pool > 16:
            score -= (browser_pool - 16) * 5  # -5 points per browser over 16
        
        cache_size = config.get("BROWSER_CACHE_MAX_SIZE_MB", 200)
        if cache_size > 300:
            score -= (cache_size - 300) / 10  # -1 point per 10MB over 300
        
        workers = config.get("WORKERS", 8)
        if workers > 10:
            score -= (workers - 10) * 3  # -3 points per worker over 10
        
        # Reward optimal settings
        optimal_matches = 0
        for key, optimal_value in self.optimal_baseline.items():
            if config.get(key) == optimal_value:
                optimal_matches += 1
        
        score += (optimal_matches / len(self.optimal_baseline)) * 20  # Up to 20 bonus points
        
        return max(0.0, min(100.0, score))
    
    def detect_regressions(self, current_config: Dict[str, Any], baseline_config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Detect performance regressions compared to baseline."""
        regressions = []
        
        # Check against regression thresholds
        for setting, threshold in self.regression_thresholds.items():
            current_value = current_config.get(setting)
            if current_value is not None and current_value > threshold:
                baseline_value = baseline_config.get(setting, "unknown")
                regressions.append({
                    "type": "threshold_exceeded",
                    "setting": setting,
                    "current_value": current_value,
                    "threshold": threshold,
                    "baseline_value": baseline_value,
                    "severity": "HIGH",
                    "message": f"{setting} ({current_value}) exceeds regression threshold ({threshold})"
                })
        
        # Check for significant increases from baseline
        for setting in self.optimal_baseline.keys():
            current_value = current_config.get(setting)
            baseline_value = baseline_config.get(setting)
            
            if current_value is not None and baseline_value is not None:
                if isinstance(current_value, (int, float)) and isinstance(baseline_value, (int, float)):
                    # Check for >50% increase in resource-intensive settings
                    if current_value > baseline_value * 1.5:
                        regressions.append({
                            "type": "significant_increase",
                            "setting": setting,
                            "current_value": current_value,
                            "baseline_value": baseline_value,
                            "increase_percent": ((current_value - baseline_value) / baseline_value) * 100,
                            "severity": "MEDIUM",
                            "message": f"{setting} increased {((current_value - baseline_value) / baseline_value) * 100:.1f}% from baseline"
                        })
        
        return regressions
    
    def save_to_history(self, config: Dict[str, Any], regressions: List[Dict[str, Any]]) -> None:
        """Save configuration check to history."""
        history_entry = {
            "timestamp": datetime.now().isoformat(),
            "config_snapshot": {k: v for k, v in config.items() if k in self.optimal_baseline},
            "performance_metrics": self.calculate_performance_metrics(config),
            "regressions_found": len(regressions),
            "regression_details": regressions
        }
        
        # Load existing history
        history = []
        if self.history_file.exists():
            with open(self.history_file, 'r') as f:
                history = json.load(f)
        
        # Add new entry and keep last 100 entries
        history.append(history_entry)
        history = history[-100:]
        
        # Save updated history
        with open(self.history_file, 'w') as f:
            json.dump(history, f, indent=2)
    
    def check_configuration(self) -> bool:
        """Check current configuration for regressions."""
        print("🔍 Checking configuration for performance regressions...")
        
        # Load current configuration
        current_config = self.load_current_config()
        if not current_config:
            print("❌ Failed to load current configuration")
            return False
        
        # Load baseline
        baseline_data = self.load_baseline()
        if not baseline_data:
            print("⚠️  No baseline found. Creating baseline from current config...")
            self.save_baseline(current_config)
            return True
        
        baseline_config = baseline_data["config"]
        
        # Detect regressions
        regressions = self.detect_regressions(current_config, baseline_config)
        
        # Calculate current metrics
        current_metrics = self.calculate_performance_metrics(current_config)
        baseline_metrics = baseline_data["performance_metrics"]
        
        # Save to history
        self.save_to_history(current_config, regressions)
        
        # Generate report
        print("\n" + "=" * 60)
        print("📊 CONFIGURATION MONITORING REPORT")
        print("=" * 60)
        
        print(f"\n📈 PERFORMANCE COMPARISON:")
        print(f"   Memory Usage: {current_metrics['estimated_memory_mb']:.0f}MB (baseline: {baseline_metrics['estimated_memory_mb']:.0f}MB)")
        print(f"   CPU Usage: {current_metrics['estimated_cpu_usage']:.1f} cores (baseline: {baseline_metrics['estimated_cpu_usage']:.1f} cores)")
        print(f"   Efficiency Score: {current_metrics['resource_efficiency_score']:.1f}/100 (baseline: {baseline_metrics['resource_efficiency_score']:.1f}/100)")
        
        if regressions:
            print(f"\n🚨 PERFORMANCE REGRESSIONS DETECTED ({len(regressions)}):")
            for regression in regressions:
                severity_icon = "🔴" if regression['severity'] == "HIGH" else "🟡"
                print(f"   {severity_icon} {regression['message']}")
            
            print(f"\n⚠️  RECOMMENDED ACTIONS:")
            high_severity = [r for r in regressions if r['severity'] == 'HIGH']
            if high_severity:
                print(f"   • Immediately review and reduce high-impact settings")
                print(f"   • Consider reverting to baseline values")
            print(f"   • Run: python scripts/config_validator.py --validate")
            print(f"   • Check: python scripts/config_audit.py")
            
            return False
        else:
            print(f"\n✅ No performance regressions detected!")
            print(f"   Configuration is within optimal parameters")
            return True
    
    def create_baseline_from_optimal(self) -> None:
        """Create baseline from optimal settings."""
        print("📝 Creating baseline from optimal configuration...")
        self.save_baseline(self.optimal_baseline)

def main():
    """Main function."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Web2img Configuration Monitor")
    parser.add_argument("--check", action="store_true", help="Check for configuration regressions")
    parser.add_argument("--baseline", action="store_true", help="Save current config as baseline")
    parser.add_argument("--optimal-baseline", action="store_true", help="Create baseline from optimal settings")
    parser.add_argument("--alert-on-regression", action="store_true", help="Exit with error code if regressions found")
    args = parser.parse_args()
    
    monitor = ConfigMonitor()
    
    if args.baseline:
        config = monitor.load_current_config()
        monitor.save_baseline(config)
        return
    
    if args.optimal_baseline:
        monitor.create_baseline_from_optimal()
        return
    
    if args.check or not any(vars(args).values()):
        success = monitor.check_configuration()
        if args.alert_on_regression and not success:
            sys.exit(1)
        return
    
if __name__ == "__main__":
    main()

# Example cron job entry for automated monitoring:
# # Check configuration every hour
# 0 * * * * cd /path/to/web2img && python scripts/config_monitor.py --check --alert-on-regression
#
# # Daily configuration audit
# 0 9 * * * cd /path/to/web2img && python scripts/config_audit.py > /tmp/config_audit.log 2>&1
