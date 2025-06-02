#!/usr/bin/env python3
"""
Script to monitor retry performance and provide recommendations.
This script analyzes logs and provides insights into retry behavior.
"""

import re
import sys
import json
from collections import defaultdict, Counter
from datetime import datetime, timedelta
from typing import Dict, List, Any


def parse_log_line(line: str) -> Dict[str, Any]:
    """Parse a log line and extract relevant information."""
    try:
        # Try to parse as JSON first
        if line.strip().startswith('{'):
            return json.loads(line.strip())
        
        # Fallback to regex parsing for non-JSON logs
        timestamp_match = re.search(r'(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})', line)
        level_match = re.search(r'(ERROR|WARNING|INFO|DEBUG)', line)
        
        result = {
            'timestamp': timestamp_match.group(1) if timestamp_match else None,
            'level': level_match.group(1) if level_match else None,
            'message': line
        }
        
        return result
    except:
        return {'message': line}


def analyze_retry_logs(log_file: str) -> Dict[str, Any]:
    """Analyze retry-related logs and extract statistics."""
    
    stats = {
        'total_retries': 0,
        'retry_exhausted': 0,
        'circuit_breaker_trips': 0,
        'error_types': Counter(),
        'retry_patterns': defaultdict(list),
        'success_after_retry': 0,
        'timeouts': 0,
        'memory_errors': 0,
        'connection_errors': 0
    }
    
    try:
        with open(log_file, 'r') as f:
            for line in f:
                log_entry = parse_log_line(line)
                message = log_entry.get('message', '')
                
                # Count retry attempts
                if 'retry attempt' in message.lower():
                    stats['total_retries'] += 1
                    
                    # Extract retry number
                    retry_match = re.search(r'retry attempt (\d+)', message.lower())
                    if retry_match:
                        retry_num = int(retry_match.group(1))
                        stats['retry_patterns']['by_attempt'].append(retry_num)
                
                # Count exhausted retries
                if 'all retry attempts exhausted' in message.lower():
                    stats['retry_exhausted'] += 1
                
                # Count circuit breaker trips
                if 'circuit breaker' in message.lower() and ('open' in message.lower() or 'trip' in message.lower()):
                    stats['circuit_breaker_trips'] += 1
                
                # Count error types
                if 'error' in message.lower():
                    if 'timeout' in message.lower():
                        stats['timeouts'] += 1
                        stats['error_types']['timeout'] += 1
                    elif 'memory' in message.lower():
                        stats['memory_errors'] += 1
                        stats['error_types']['memory'] += 1
                    elif 'connection' in message.lower():
                        stats['connection_errors'] += 1
                        stats['error_types']['connection'] += 1
                    else:
                        # Try to extract error type from log
                        error_match = re.search(r'error[_\s]type["\s:]+([a-zA-Z]+)', message.lower())
                        if error_match:
                            stats['error_types'][error_match.group(1)] += 1
                
                # Count successes after retry
                if 'retry' in message.lower() and 'success' in message.lower():
                    stats['success_after_retry'] += 1
    
    except FileNotFoundError:
        print(f"Error: Log file {log_file} not found")
        return stats
    except Exception as e:
        print(f"Error reading log file: {e}")
        return stats
    
    return stats


def generate_recommendations(stats: Dict[str, Any]) -> List[str]:
    """Generate recommendations based on retry statistics."""
    recommendations = []
    
    # Check retry exhaustion rate
    if stats['retry_exhausted'] > 0:
        exhaustion_rate = stats['retry_exhausted'] / max(1, stats['total_retries']) * 100
        if exhaustion_rate > 20:
            recommendations.append(
                f"🔴 High retry exhaustion rate ({exhaustion_rate:.1f}%). "
                "Consider increasing SCREENSHOT_MAX_RETRIES or investigating root causes."
            )
        elif exhaustion_rate > 10:
            recommendations.append(
                f"🟡 Moderate retry exhaustion rate ({exhaustion_rate:.1f}%). "
                "Monitor closely and consider tuning retry settings."
            )
    
    # Check circuit breaker activity
    if stats['circuit_breaker_trips'] > 10:
        recommendations.append(
            f"🔴 High circuit breaker activity ({stats['circuit_breaker_trips']} trips). "
            "Consider increasing CIRCUIT_BREAKER_THRESHOLD or investigating system health."
        )
    
    # Check error patterns
    if stats['timeouts'] > stats['total_retries'] * 0.5:
        recommendations.append(
            "🔴 High timeout rate. Consider increasing timeout values or optimizing page load performance."
        )
    
    if stats['memory_errors'] > 0:
        recommendations.append(
            f"🔴 Memory errors detected ({stats['memory_errors']}). "
            "Consider increasing system memory or reducing browser pool size."
        )
    
    if stats['connection_errors'] > stats['total_retries'] * 0.3:
        recommendations.append(
            "🟡 High connection error rate. Check network stability and DNS resolution."
        )
    
    # Check success rate after retries
    if stats['success_after_retry'] > 0:
        success_rate = stats['success_after_retry'] / max(1, stats['total_retries']) * 100
        if success_rate > 70:
            recommendations.append(
                f"✅ Good retry success rate ({success_rate:.1f}%). Current retry strategy is effective."
            )
        elif success_rate < 30:
            recommendations.append(
                f"🔴 Low retry success rate ({success_rate:.1f}%). "
                "Consider adjusting retry delays or investigating persistent issues."
            )
    
    if not recommendations:
        recommendations.append("✅ No major issues detected in retry patterns.")
    
    return recommendations


def print_retry_analysis(stats: Dict[str, Any], recommendations: List[str]):
    """Print detailed retry analysis."""
    
    print("🔍 Retry Performance Analysis")
    print("=" * 50)
    
    print(f"\n📊 Overall Statistics:")
    print(f"  Total Retries: {stats['total_retries']}")
    print(f"  Retry Exhausted: {stats['retry_exhausted']}")
    print(f"  Circuit Breaker Trips: {stats['circuit_breaker_trips']}")
    print(f"  Success After Retry: {stats['success_after_retry']}")
    
    print(f"\n🚨 Error Breakdown:")
    print(f"  Timeouts: {stats['timeouts']}")
    print(f"  Memory Errors: {stats['memory_errors']}")
    print(f"  Connection Errors: {stats['connection_errors']}")
    
    if stats['error_types']:
        print(f"\n🔍 Error Types:")
        for error_type, count in stats['error_types'].most_common(10):
            print(f"  {error_type}: {count}")
    
    print(f"\n💡 Recommendations:")
    for rec in recommendations:
        print(f"  {rec}")
    
    # Calculate rates
    if stats['total_retries'] > 0:
        exhaustion_rate = stats['retry_exhausted'] / stats['total_retries'] * 100
        success_rate = stats['success_after_retry'] / stats['total_retries'] * 100
        
        print(f"\n📈 Key Metrics:")
        print(f"  Retry Exhaustion Rate: {exhaustion_rate:.1f}%")
        print(f"  Retry Success Rate: {success_rate:.1f}%")
        
        if exhaustion_rate < 5:
            print("  ✅ Excellent retry performance")
        elif exhaustion_rate < 15:
            print("  🟡 Good retry performance")
        else:
            print("  🔴 Poor retry performance - needs attention")


def main():
    """Main function to analyze retry performance."""
    if len(sys.argv) != 2:
        print("Usage: python monitor_retry_performance.py <log_file>")
        print("Example: python monitor_retry_performance.py /var/log/web2img.log")
        sys.exit(1)
    
    log_file = sys.argv[1]
    
    print(f"📖 Analyzing retry performance from: {log_file}")
    
    # Analyze logs
    stats = analyze_retry_logs(log_file)
    
    # Generate recommendations
    recommendations = generate_recommendations(stats)
    
    # Print analysis
    print_retry_analysis(stats, recommendations)
    
    # Suggest configuration changes
    if stats['retry_exhausted'] > 10:
        print(f"\n🔧 Suggested Configuration Changes:")
        print(f"  export SCREENSHOT_MAX_RETRIES={min(20, stats['retry_exhausted'] + 5)}")
        print(f"  export SCREENSHOT_BASE_DELAY=2.0")
        print(f"  export SCREENSHOT_MAX_DELAY=20.0")


if __name__ == "__main__":
    main()
