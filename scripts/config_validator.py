#!/usr/bin/env python3
"""
Configuration Validator for web2img

This tool validates configuration changes and ensures they meet performance requirements.
It prevents configuration drift and maintains optimal settings.

Usage:
    python scripts/config_validator.py --validate
    python scripts/config_validator.py --check-performance
    python scripts/config_validator.py --sync-defaults
"""

import os
import sys
import json
from pathlib import Path
from typing import Dict, List, Any, Tuple
from dataclasses import dataclass

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

@dataclass
class ValidationRule:
    name: str
    min_value: Any = None
    max_value: Any = None
    recommended_value: Any = None
    depends_on: List[str] = None
    performance_impact: str = "MEDIUM"
    description: str = ""

class ConfigValidator:
    """Configuration validator for web2img performance optimization."""
    
    def __init__(self):
        self.project_root = project_root
        self.env_file = project_root / ".env.production"
        
        # Define validation rules for critical performance settings
        self.validation_rules = {
            # Browser Pool Settings (Critical for memory usage)
            "BROWSER_POOL_MIN_SIZE": ValidationRule(
                name="Browser Pool Minimum Size",
                min_value=2, max_value=8, recommended_value=4,
                performance_impact="HIGH",
                description="Minimum browsers in pool. Too low = poor performance, too high = memory waste"
            ),
            "BROWSER_POOL_MAX_SIZE": ValidationRule(
                name="Browser Pool Maximum Size", 
                min_value=4, max_value=20, recommended_value=12,
                performance_impact="HIGH",
                description="Maximum browsers in pool. Critical for memory usage control"
            ),
            "BROWSER_POOL_IDLE_TIMEOUT": ValidationRule(
                name="Browser Pool Idle Timeout",
                min_value=300, max_value=7200, recommended_value=1800,
                performance_impact="MEDIUM",
                description="Time before idle browsers are cleaned up (seconds)"
            ),
            
            # Concurrency Settings (Critical for CPU usage)
            "MAX_CONCURRENT_SCREENSHOTS": ValidationRule(
                name="Max Concurrent Screenshots",
                min_value=8, max_value=128, recommended_value=32,
                performance_impact="HIGH",
                description="Maximum simultaneous screenshot operations"
            ),
            "MAX_CONCURRENT_CONTEXTS": ValidationRule(
                name="Max Concurrent Contexts",
                min_value=16, max_value=256, recommended_value=64,
                performance_impact="HIGH", 
                description="Maximum browser contexts. Should be 2x screenshot limit"
            ),
            
            # Cache Settings (Critical for memory usage)
            "BROWSER_CACHE_MAX_SIZE_MB": ValidationRule(
                name="Browser Cache Size",
                min_value=50, max_value=1000, recommended_value=200,
                performance_impact="HIGH",
                description="Cache size per browser in MB. Multiplied by browser count"
            ),
            "CACHE_MAX_ITEMS": ValidationRule(
                name="Cache Max Items",
                min_value=100, max_value=1000, recommended_value=300,
                performance_impact="MEDIUM",
                description="Maximum cached screenshot results"
            ),
            
            # Worker Settings (Critical for CPU usage)
            "WORKERS": ValidationRule(
                name="Worker Processes",
                min_value=2, max_value=16, recommended_value=8,
                performance_impact="HIGH",
                description="Number of worker processes. Should match CPU cores"
            ),
            
            # Memory Management
            "MEMORY_CLEANUP_THRESHOLD": ValidationRule(
                name="Memory Cleanup Threshold",
                min_value=60, max_value=95, recommended_value=80,
                performance_impact="MEDIUM",
                description="Memory usage % before triggering cleanup"
            ),
            
            # Monitoring Intervals
            "POOL_WATCHDOG_INTERVAL": ValidationRule(
                name="Pool Watchdog Interval", 
                min_value=60, max_value=1800, recommended_value=300,
                performance_impact="LOW",
                description="Browser pool monitoring frequency (seconds)"
            ),
        }
        
        # Define dependency rules
        self.dependency_rules = [
            ("MAX_CONCURRENT_CONTEXTS", "MAX_CONCURRENT_SCREENSHOTS", 2.0, "Contexts should be 2x screenshots"),
            ("BROWSER_POOL_MAX_SIZE", "MAX_CONCURRENT_SCREENSHOTS", 0.3, "Pool should handle 30% of max screenshots"),
        ]
    
    def load_current_config(self) -> Dict[str, Any]:
        """Load current configuration from .env.production."""
        config = {}
        
        if not self.env_file.exists():
            print(f"❌ Configuration file not found: {self.env_file}")
            return config
            
        with open(self.env_file, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    key = key.strip()
                    value = value.strip()
                    
                    # Try to convert to appropriate type
                    if value.lower() in ('true', 'false'):
                        config[key] = value.lower() == 'true'
                    elif value.replace('.', '').isdigit():
                        config[key] = float(value) if '.' in value else int(value)
                    else:
                        config[key] = value
                        
        return config
    
    def validate_configuration(self, config: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Validate configuration against performance rules."""
        issues = []
        
        # Validate individual settings
        for setting_name, rule in self.validation_rules.items():
            if setting_name not in config:
                issues.append({
                    "type": "missing",
                    "setting": setting_name,
                    "severity": rule.performance_impact,
                    "message": f"Missing critical setting: {rule.name}",
                    "recommendation": f"Add {setting_name}={rule.recommended_value}"
                })
                continue
                
            value = config[setting_name]
            
            # Check range validation
            if rule.min_value is not None and value < rule.min_value:
                issues.append({
                    "type": "below_minimum",
                    "setting": setting_name,
                    "severity": rule.performance_impact,
                    "current_value": value,
                    "min_value": rule.min_value,
                    "message": f"{rule.name} ({value}) is below minimum ({rule.min_value})",
                    "recommendation": f"Increase to at least {rule.min_value}"
                })
                
            if rule.max_value is not None and value > rule.max_value:
                issues.append({
                    "type": "above_maximum", 
                    "setting": setting_name,
                    "severity": rule.performance_impact,
                    "current_value": value,
                    "max_value": rule.max_value,
                    "message": f"{rule.name} ({value}) exceeds maximum ({rule.max_value})",
                    "recommendation": f"Reduce to {rule.recommended_value} or below {rule.max_value}"
                })
        
        # Validate dependencies
        for primary, secondary, ratio, description in self.dependency_rules:
            if primary in config and secondary in config:
                primary_val = config[primary]
                secondary_val = config[secondary]
                expected = int(secondary_val * ratio)
                
                if primary_val < expected * 0.8:  # Allow 20% tolerance
                    issues.append({
                        "type": "dependency_violation",
                        "setting": f"{primary} vs {secondary}",
                        "severity": "MEDIUM",
                        "current_ratio": primary_val / secondary_val if secondary_val > 0 else 0,
                        "expected_ratio": ratio,
                        "message": f"{description}: {primary}={primary_val}, {secondary}={secondary_val}",
                        "recommendation": f"Set {primary} to at least {expected}"
                    })
        
        return issues
    
    def calculate_resource_impact(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Calculate estimated resource impact of current configuration."""
        impact = {
            "estimated_memory_mb": 0,
            "estimated_cpu_cores": 0,
            "risk_level": "LOW"
        }
        
        # Calculate memory impact
        browser_pool_size = config.get("BROWSER_POOL_MAX_SIZE", 12)
        cache_size_per_browser = config.get("BROWSER_CACHE_MAX_SIZE_MB", 200)
        workers = config.get("WORKERS", 8)
        
        # Estimate memory usage
        browser_memory = browser_pool_size * 150  # ~150MB per browser
        cache_memory = browser_pool_size * cache_size_per_browser
        worker_memory = workers * 100  # ~100MB per worker
        
        impact["estimated_memory_mb"] = browser_memory + cache_memory + worker_memory
        impact["estimated_cpu_cores"] = workers + (browser_pool_size * 0.2)  # Browsers use ~20% CPU each
        
        # Determine risk level
        if impact["estimated_memory_mb"] > 8000 or impact["estimated_cpu_cores"] > 16:
            impact["risk_level"] = "HIGH"
        elif impact["estimated_memory_mb"] > 4000 or impact["estimated_cpu_cores"] > 8:
            impact["risk_level"] = "MEDIUM"
        
        # Add breakdown
        impact["breakdown"] = {
            "browser_memory_mb": browser_memory,
            "cache_memory_mb": cache_memory, 
            "worker_memory_mb": worker_memory,
            "browser_cpu_usage": browser_pool_size * 0.2,
            "worker_cpu_usage": workers
        }
        
        return impact
    
    def generate_recommendations(self, config: Dict[str, Any], issues: List[Dict]) -> List[str]:
        """Generate specific recommendations for optimization."""
        recommendations = []
        
        # High-impact issues first
        high_impact_issues = [i for i in issues if i.get("severity") == "HIGH"]
        if high_impact_issues:
            recommendations.append("🚨 CRITICAL PERFORMANCE ISSUES:")
            for issue in high_impact_issues:
                recommendations.append(f"   • {issue['message']}")
                recommendations.append(f"     → {issue['recommendation']}")
        
        # Resource optimization recommendations
        impact = self.calculate_resource_impact(config)
        if impact["risk_level"] == "HIGH":
            recommendations.append("\n⚠️  HIGH RESOURCE USAGE DETECTED:")
            recommendations.append(f"   • Estimated Memory: {impact['estimated_memory_mb']:.0f}MB")
            recommendations.append(f"   • Estimated CPU: {impact['estimated_cpu_cores']:.1f} cores")
            recommendations.append("   → Consider reducing browser pool size or cache limits")
        
        # Specific optimization suggestions
        browser_pool = config.get("BROWSER_POOL_MAX_SIZE", 12)
        cache_size = config.get("BROWSER_CACHE_MAX_SIZE_MB", 200)
        
        if browser_pool > 16:
            recommendations.append(f"\n💡 OPTIMIZATION SUGGESTION:")
            recommendations.append(f"   • Browser pool size ({browser_pool}) is quite high")
            recommendations.append(f"   → Consider reducing to 12-16 for better memory efficiency")
            
        if cache_size > 500:
            recommendations.append(f"\n💡 CACHE OPTIMIZATION:")
            recommendations.append(f"   • Cache size ({cache_size}MB) per browser is high")
            recommendations.append(f"   → Consider reducing to 200-300MB per browser")
        
        return recommendations
    
    def validate_and_report(self) -> bool:
        """Run full validation and generate report."""
        print("🔍 Validating web2img configuration...")
        
        # Load and validate configuration
        config = self.load_current_config()
        if not config:
            print("❌ Failed to load configuration")
            return False
            
        issues = self.validate_configuration(config)
        impact = self.calculate_resource_impact(config)
        recommendations = self.generate_recommendations(config, issues)
        
        # Generate report
        print("\n" + "=" * 60)
        print("📊 CONFIGURATION VALIDATION REPORT")
        print("=" * 60)
        
        print(f"\n📈 RESOURCE IMPACT ASSESSMENT:")
        print(f"   Estimated Memory Usage: {impact['estimated_memory_mb']:.0f}MB")
        print(f"   Estimated CPU Usage: {impact['estimated_cpu_cores']:.1f} cores")
        print(f"   Risk Level: {impact['risk_level']}")
        
        if issues:
            print(f"\n🚨 VALIDATION ISSUES ({len(issues)} found):")
            for issue in issues:
                severity_icon = "🔴" if issue['severity'] == "HIGH" else "🟡" if issue['severity'] == "MEDIUM" else "🟢"
                print(f"   {severity_icon} {issue['message']}")
        else:
            print("\n✅ No validation issues found!")
        
        if recommendations:
            print("\n💡 RECOMMENDATIONS:")
            for rec in recommendations:
                print(rec)
        
        print(f"\n📄 Current optimized settings:")
        critical_settings = ["BROWSER_POOL_MAX_SIZE", "MAX_CONCURRENT_SCREENSHOTS", 
                            "BROWSER_CACHE_MAX_SIZE_MB", "WORKERS"]
        for setting in critical_settings:
            if setting in config:
                rule = self.validation_rules.get(setting)
                status = "✅" if not any(i['setting'] == setting for i in issues) else "⚠️"
                print(f"   {status} {setting}: {config[setting]} (recommended: {rule.recommended_value if rule else 'N/A'})")
        
        return len([i for i in issues if i['severity'] == 'HIGH']) == 0

def main():
    """Main function."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Web2img Configuration Validator")
    parser.add_argument("--validate", action="store_true", help="Validate current configuration")
    parser.add_argument("--check-performance", action="store_true", help="Check performance impact")
    args = parser.parse_args()
    
    validator = ConfigValidator()
    
    if args.validate or not any(vars(args).values()):
        success = validator.validate_and_report()
        sys.exit(0 if success else 1)
    
    if args.check_performance:
        config = validator.load_current_config()
        impact = validator.calculate_resource_impact(config)
        print(json.dumps(impact, indent=2))

if __name__ == "__main__":
    main()
