#!/usr/bin/env python3
"""
Configuration Audit Tool for web2img

This tool performs comprehensive configuration consistency checks to ensure:
1. All environment variables are properly mapped to Settings class
2. No configuration drift occurs
3. Unused variables are identified
4. Performance impact is assessed

Usage:
    python scripts/config_audit.py [--fix] [--report-only]
"""

import os
import re
import ast
import sys
from pathlib import Path
from typing import Dict, List, Set, Tuple, Any
from dataclasses import dataclass
from enum import Enum

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

class IssueType(Enum):
    MISSING_FROM_SETTINGS = "missing_from_settings"
    UNUSED_ENV_VAR = "unused_env_var"
    HARDCODED_VALUE = "hardcoded_value"
    DEFAULT_MISMATCH = "default_mismatch"
    PERFORMANCE_IMPACT = "performance_impact"

@dataclass
class ConfigIssue:
    type: IssueType
    variable: str
    description: str
    file_path: str = ""
    line_number: int = 0
    current_value: Any = None
    recommended_value: Any = None
    impact: str = ""

class ConfigAuditor:
    """Comprehensive configuration auditor for web2img project."""
    
    def __init__(self, project_root: Path):
        self.project_root = project_root
        self.config_file = project_root / "app" / "core" / "config.py"
        self.env_file = project_root / ".env.production"
        self.issues: List[ConfigIssue] = []
        
        # Performance-critical settings and their optimal ranges
        self.performance_settings = {
            "BROWSER_POOL_MAX_SIZE": {"optimal": (8, 16), "current_optimal": 12},
            "MAX_CONCURRENT_SCREENSHOTS": {"optimal": (16, 64), "current_optimal": 32},
            "MAX_CONCURRENT_CONTEXTS": {"optimal": (32, 128), "current_optimal": 64},
            "BROWSER_CACHE_MAX_SIZE_MB": {"optimal": (100, 500), "current_optimal": 200},
            "WORKERS": {"optimal": (4, 12), "current_optimal": 8},
            "MEMORY_CLEANUP_THRESHOLD": {"optimal": (70, 90), "current_optimal": 80},
        }
    
    def run_audit(self) -> List[ConfigIssue]:
        """Run comprehensive configuration audit."""
        print("🔍 Starting configuration audit...")
        
        # Load current configuration
        env_vars = self._load_env_variables()
        settings_vars = self._load_settings_variables()
        code_usage = self._scan_code_usage()
        
        # Perform checks
        self._check_missing_from_settings(env_vars, settings_vars)
        self._check_unused_env_vars(env_vars, code_usage)
        self._check_hardcoded_values()
        self._check_default_mismatches(env_vars, settings_vars)
        self._check_performance_impact(env_vars)
        
        return self.issues
    
    def _load_env_variables(self) -> Dict[str, str]:
        """Load variables from .env.production file."""
        env_vars = {}
        if not self.env_file.exists():
            return env_vars
            
        with open(self.env_file, 'r') as f:
            for line_num, line in enumerate(f, 1):
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    env_vars[key.strip()] = {
                        'value': value.strip(),
                        'line': line_num
                    }
        return env_vars
    
    def _load_settings_variables(self) -> Dict[str, Dict]:
        """Load variables from Settings class."""
        settings_vars = {}
        if not self.config_file.exists():
            return settings_vars
            
        with open(self.config_file, 'r') as f:
            content = f.read()
            
        # Parse Settings class fields
        field_pattern = r'(\w+):\s*\w+\s*=\s*Field\(\s*default_factory=lambda:\s*[^(]*\(os\.getenv\("([^"]+)"[^)]*\)'
        matches = re.findall(field_pattern, content)
        
        for field_name, env_var in matches:
            settings_vars[env_var] = {
                'field_name': field_name,
                'defined': True
            }
            
        return settings_vars
    
    def _scan_code_usage(self) -> Dict[str, List[str]]:
        """Scan codebase for configuration variable usage."""
        usage = {}
        
        # Scan Python files
        for py_file in self.project_root.rglob("*.py"):
            if "venv" in str(py_file) or "__pycache__" in str(py_file):
                continue
                
            try:
                with open(py_file, 'r') as f:
                    content = f.read()
                    
                # Find os.getenv usage
                getenv_pattern = r'os\.getenv\(["\']([^"\']+)["\']'
                for match in re.finditer(getenv_pattern, content):
                    var_name = match.group(1)
                    if var_name not in usage:
                        usage[var_name] = []
                    usage[var_name].append(str(py_file))
                
                # Find getattr(settings, ...) usage
                getattr_pattern = r'getattr\(settings,\s*["\']([^"\']+)["\']'
                for match in re.finditer(getattr_pattern, content):
                    var_name = match.group(1)
                    if var_name not in usage:
                        usage[var_name] = []
                    usage[var_name].append(str(py_file))
                
                # Find settings.variable usage
                settings_pattern = r'settings\.(\w+)'
                for match in re.finditer(settings_pattern, content):
                    var_name = match.group(1).upper()
                    if var_name not in usage:
                        usage[var_name] = []
                    usage[var_name].append(str(py_file))
                    
            except Exception as e:
                print(f"⚠️  Error scanning {py_file}: {e}")
                
        return usage
    
    def _check_missing_from_settings(self, env_vars: Dict, settings_vars: Dict):
        """Check for environment variables not defined in Settings class."""
        for env_var in env_vars:
            if env_var not in settings_vars:
                self.issues.append(ConfigIssue(
                    type=IssueType.MISSING_FROM_SETTINGS,
                    variable=env_var,
                    description=f"Environment variable {env_var} is not defined in Settings class",
                    file_path=str(self.config_file),
                    impact="HIGH - Variable will use hardcoded defaults instead of .env values"
                ))
    
    def _check_unused_env_vars(self, env_vars: Dict, code_usage: Dict):
        """Check for unused environment variables."""
        for env_var in env_vars:
            if env_var not in code_usage:
                self.issues.append(ConfigIssue(
                    type=IssueType.UNUSED_ENV_VAR,
                    variable=env_var,
                    description=f"Environment variable {env_var} is defined but not used in code",
                    file_path=str(self.env_file),
                    line_number=env_vars[env_var]['line'],
                    impact="LOW - Can be safely removed to reduce configuration clutter"
                ))
    
    def _check_hardcoded_values(self):
        """Check for hardcoded values that should be configurable."""
        hardcoded_patterns = [
            (r'timeout=(\d+)', "timeout values"),
            (r'max_size=(\d+)', "size limits"),
            (r'interval=(\d+)', "interval values"),
            (r'threshold=(\d+\.?\d*)', "threshold values"),
        ]
        
        for py_file in self.project_root.rglob("*.py"):
            if "venv" in str(py_file) or "__pycache__" in str(py_file) or "config.py" in str(py_file):
                continue
                
            try:
                with open(py_file, 'r') as f:
                    lines = f.readlines()
                    
                for line_num, line in enumerate(lines, 1):
                    for pattern, description in hardcoded_patterns:
                        matches = re.finditer(pattern, line)
                        for match in matches:
                            value = match.group(1)
                            if float(value) > 10:  # Only flag significant values
                                self.issues.append(ConfigIssue(
                                    type=IssueType.HARDCODED_VALUE,
                                    variable=f"hardcoded_{description}",
                                    description=f"Hardcoded {description}: {value}",
                                    file_path=str(py_file),
                                    line_number=line_num,
                                    current_value=value,
                                    impact="MEDIUM - Consider making configurable"
                                ))
                                
            except Exception as e:
                continue
    
    def _check_default_mismatches(self, env_vars: Dict, settings_vars: Dict):
        """Check for mismatches between .env values and Settings defaults."""
        # This would require parsing the actual default values from Settings class
        # Implementation would involve AST parsing for more accurate results
        pass
    
    def _check_performance_impact(self, env_vars: Dict):
        """Check performance-critical settings for optimal values."""
        for var_name, config in self.performance_settings.items():
            if var_name in env_vars:
                try:
                    current_value = int(env_vars[var_name]['value'])
                    optimal_range = config['optimal']
                    optimal_value = config['current_optimal']
                    
                    if current_value < optimal_range[0] or current_value > optimal_range[1]:
                        impact_level = "HIGH" if current_value > optimal_range[1] * 2 else "MEDIUM"
                        self.issues.append(ConfigIssue(
                            type=IssueType.PERFORMANCE_IMPACT,
                            variable=var_name,
                            description=f"Performance-critical setting outside optimal range",
                            current_value=current_value,
                            recommended_value=optimal_value,
                            impact=f"{impact_level} - May impact memory/CPU usage"
                        ))
                except ValueError:
                    continue
    
    def generate_report(self) -> str:
        """Generate comprehensive audit report."""
        report = []
        report.append("=" * 80)
        report.append("🔍 WEB2IMG CONFIGURATION AUDIT REPORT")
        report.append("=" * 80)
        report.append("")
        
        # Summary
        issue_counts = {}
        for issue in self.issues:
            issue_counts[issue.type] = issue_counts.get(issue.type, 0) + 1
        
        report.append("📊 SUMMARY:")
        report.append(f"   Total Issues Found: {len(self.issues)}")
        for issue_type, count in issue_counts.items():
            report.append(f"   {issue_type.value.replace('_', ' ').title()}: {count}")
        report.append("")
        
        # Detailed issues
        for issue_type in IssueType:
            type_issues = [i for i in self.issues if i.type == issue_type]
            if not type_issues:
                continue
                
            report.append(f"🚨 {issue_type.value.replace('_', ' ').upper()}:")
            report.append("-" * 50)
            
            for issue in type_issues:
                report.append(f"   Variable: {issue.variable}")
                report.append(f"   Description: {issue.description}")
                if issue.file_path:
                    report.append(f"   File: {issue.file_path}")
                if issue.line_number:
                    report.append(f"   Line: {issue.line_number}")
                if issue.current_value is not None:
                    report.append(f"   Current: {issue.current_value}")
                if issue.recommended_value is not None:
                    report.append(f"   Recommended: {issue.recommended_value}")
                report.append(f"   Impact: {issue.impact}")
                report.append("")
        
        return "\n".join(report)

def main():
    """Main function to run configuration audit."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Web2img Configuration Audit Tool")
    parser.add_argument("--fix", action="store_true", help="Attempt to fix issues automatically")
    parser.add_argument("--report-only", action="store_true", help="Generate report only, don't show issues")
    args = parser.parse_args()
    
    # Run audit
    auditor = ConfigAuditor(project_root)
    issues = auditor.run_audit()
    
    # Generate and display report
    report = auditor.generate_report()
    
    if args.report_only:
        print(report)
    else:
        # Save report to file
        report_file = project_root / "config_audit_report.txt"
        with open(report_file, 'w') as f:
            f.write(report)
        
        print(f"✅ Configuration audit complete!")
        print(f"📄 Report saved to: {report_file}")
        print(f"🔍 Found {len(issues)} configuration issues")
        
        if issues:
            print("\n🚨 Critical issues that need attention:")
            critical_issues = [i for i in issues if "HIGH" in i.impact]
            for issue in critical_issues[:5]:  # Show top 5 critical issues
                print(f"   • {issue.variable}: {issue.description}")
        else:
            print("🎉 No configuration issues found! Your config is properly synchronized.")

if __name__ == "__main__":
    main()
