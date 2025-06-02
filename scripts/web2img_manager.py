#!/usr/bin/env python3
"""
Web2img Management Script - All-in-One Tool
Combines all web2img management functionality into a single script for easier maintenance.

Usage:
    python scripts/web2img_manager.py <command> [options]

Commands:
    config          - Configure retry settings for different load levels
    monitor         - Monitor retry performance and system health
    optimize        - Analyze system and generate optimized configuration
    validate        - Validate current configuration and optimizations
    deploy          - Deploy optimizations with backup and validation
    dashboard       - Real-time performance dashboard
    easypanel       - EasyPanel-specific monitoring
    r2-cleanup      - Clean up R2 storage objects
    status          - Show quick system status
    interactive     - Interactive mode with command suggestions
    history         - Show command execution history
    help            - Show detailed help for each command

Examples:
    python scripts/web2img_manager.py config 2000
    python scripts/web2img_manager.py monitor /var/log/web2img.log --format json
    python scripts/web2img_manager.py dashboard --url http://localhost:8000 --interval 10
    python scripts/web2img_manager.py optimize --save
    python scripts/web2img_manager.py interactive
"""

import sys
import os
import argparse
import asyncio
import json
import time
import logging
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Any, Optional

# Add the project root to the Python path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

# Command history file
HISTORY_FILE = Path.home() / ".web2img_manager_history.json"


class CommandHistory:
    """Manage command execution history."""

    def __init__(self):
        self.history_file = HISTORY_FILE

    def add_command(self, command: str, args: List[str], success: bool, duration: float):
        """Add a command to history."""
        try:
            history = self.load_history()
            entry = {
                "timestamp": datetime.now().isoformat(),
                "command": command,
                "args": args,
                "success": success,
                "duration": duration
            }
            history.append(entry)

            # Keep only last 100 entries
            if len(history) > 100:
                history = history[-100:]

            with open(self.history_file, 'w') as f:
                json.dump(history, f, indent=2)
        except Exception:
            pass  # Silently fail if history can't be saved

    def load_history(self) -> List[Dict[str, Any]]:
        """Load command history."""
        try:
            if self.history_file.exists():
                with open(self.history_file, 'r') as f:
                    return json.load(f)
        except Exception:
            pass
        return []

    def show_history(self, limit: int = 10):
        """Show recent command history."""
        history = self.load_history()
        if not history:
            print("📝 No command history found")
            return

        print(f"📝 RECENT COMMANDS (last {min(limit, len(history))}):")
        print("-" * 60)

        for entry in history[-limit:]:
            timestamp = entry['timestamp'][:19].replace('T', ' ')
            status = "✅" if entry['success'] else "❌"
            duration = f"{entry['duration']:.1f}s"
            command = entry['command']
            args = ' '.join(entry['args']) if entry['args'] else ''

            print(f"{timestamp} {status} {command} {args} ({duration})")


def print_banner():
    """Print the application banner."""
    print("=" * 80)
    print("🚀 WEB2IMG MANAGEMENT TOOL")
    print("   All-in-One Management Script for Web2img High-Performance Setup")
    print("=" * 80)


def show_help():
    """Show detailed help information."""
    print_banner()
    print(__doc__)
    
    print("\n📋 COMMAND DETAILS:")
    print("-" * 40)
    
    commands = {
        "config": {
            "description": "Configure retry settings based on expected concurrent load",
            "usage": "config <concurrent_users>",
            "example": "config 2000",
            "options": ["concurrent_users: Number of expected concurrent users (100-5000)"]
        },
        "monitor": {
            "description": "Monitor retry performance from log files",
            "usage": "monitor <log_file>",
            "example": "monitor /var/log/web2img.log",
            "options": ["log_file: Path to the web2img log file"]
        },
        "optimize": {
            "description": "Analyze system resources and generate optimized configuration",
            "usage": "optimize [--save]",
            "example": "optimize --save",
            "options": ["--save: Automatically save optimized configuration"]
        },
        "validate": {
            "description": "Validate current configuration and run optimization tests",
            "usage": "validate [--config-only]",
            "example": "validate",
            "options": ["--config-only: Only validate configuration, skip performance tests"]
        },
        "deploy": {
            "description": "Deploy optimizations with backup and validation",
            "usage": "deploy [--rollback <backup_path>]",
            "example": "deploy",
            "options": ["--rollback: Rollback to a previous backup"]
        },
        "dashboard": {
            "description": "Real-time performance monitoring dashboard",
            "usage": "dashboard [--url <app_url>] [--interval <seconds>]",
            "example": "dashboard --url http://localhost:8000",
            "options": [
                "--url: Application URL (default: http://localhost:8000)",
                "--interval: Update interval in seconds (default: 5)"
            ]
        },
        "easypanel": {
            "description": "EasyPanel-specific monitoring and recommendations",
            "usage": "easypanel [--url <app_url>] [--json]",
            "example": "easypanel --url http://localhost:8000",
            "options": [
                "--url: Application URL (default: http://localhost:8000)",
                "--json: Output in JSON format"
            ]
        },
        "r2-cleanup": {
            "description": "Clean up Cloudflare R2 storage objects",
            "usage": "r2-cleanup [--dry-run] [--confirm]",
            "example": "r2-cleanup --dry-run",
            "options": [
                "--dry-run: Show what would be deleted without deleting",
                "--confirm: Skip confirmation prompt"
            ]
        },
        "status": {
            "description": "Show quick system status and service health",
            "usage": "status",
            "example": "status",
            "options": []
        },
        "interactive": {
            "description": "Interactive mode with command suggestions and completion",
            "usage": "interactive",
            "example": "interactive",
            "options": []
        },
        "history": {
            "description": "Show command execution history",
            "usage": "history [--limit <number>]",
            "example": "history --limit 20",
            "options": ["--limit: Number of recent commands to show (default: 10)"]
        }
    }
    
    for cmd, info in commands.items():
        print(f"\n🔧 {cmd.upper()}")
        print(f"   Description: {info['description']}")
        print(f"   Usage: web2img_manager.py {info['usage']}")
        print(f"   Example: web2img_manager.py {info['example']}")
        if info['options']:
            print("   Options:")
            for option in info['options']:
                print(f"     • {option}")
    
    print(f"\n💡 TIPS:")
    print("   • Run 'config' first to optimize settings for your load")
    print("   • Use 'monitor' to analyze performance after changes")
    print("   • Run 'dashboard' for real-time monitoring")
    print("   • Use 'validate' to ensure optimizations are working")
    print("   • Always backup before using 'deploy'")


def check_dependencies():
    """Check if required dependencies are available."""
    missing_deps = []

    try:
        import psutil
    except ImportError:
        missing_deps.append("psutil")

    try:
        import aiohttp
    except ImportError:
        missing_deps.append("aiohttp")

    try:
        import boto3
    except ImportError:
        missing_deps.append("boto3")

    if missing_deps:
        print("❌ Missing required dependencies:")
        for dep in missing_deps:
            print(f"   • {dep}")
        print("\nInstall missing dependencies with:")
        print(f"   pip install {' '.join(missing_deps)}")
        return False

    return True


def show_quick_status():
    """Show quick system status."""
    try:
        import psutil

        print("\n📊 QUICK SYSTEM STATUS:")
        print("-" * 30)
        print(f"CPU Usage: {psutil.cpu_percent(interval=1):.1f}%")

        memory = psutil.virtual_memory()
        print(f"Memory: {memory.used / (1024**3):.1f}GB / {memory.total / (1024**3):.1f}GB ({memory.percent:.1f}%)")

        # Count browser processes
        browser_count = 0
        for proc in psutil.process_iter(['name']):
            try:
                if proc.info['name'] and 'chrome' in proc.info['name'].lower():
                    browser_count += 1
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        print(f"Browser Processes: {browser_count}")

        # Check if web2img is running
        web2img_running = False
        for proc in psutil.process_iter(['name', 'cmdline']):
            try:
                if proc.info['cmdline']:
                    cmdline = ' '.join(proc.info['cmdline'])
                    if 'web2img' in cmdline or 'main.py' in cmdline:
                        web2img_running = True
                        break
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        print(f"Web2img Service: {'🟢 Running' if web2img_running else '🔴 Not Running'}")

    except ImportError:
        print("📊 Install psutil to see system status: pip install psutil")


def create_argument_parser() -> argparse.ArgumentParser:
    """Create the main argument parser."""
    parser = argparse.ArgumentParser(
        description="Web2img Management Tool - All-in-One Management Script",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s config 2000
  %(prog)s monitor /var/log/web2img.log --format json
  %(prog)s dashboard --url http://localhost:8000 --interval 10
  %(prog)s optimize --save
  %(prog)s interactive
        """
    )

    subparsers = parser.add_subparsers(dest='command', help='Available commands')

    # Config command
    config_parser = subparsers.add_parser('config', help='Configure retry settings')
    config_parser.add_argument('concurrent_users', type=int, help='Number of concurrent users (100-5000)')
    config_parser.add_argument('--apply', action='store_true', help='Automatically apply configuration')

    # Monitor command
    monitor_parser = subparsers.add_parser('monitor', help='Monitor retry performance')
    monitor_parser.add_argument('log_file', help='Path to log file')
    monitor_parser.add_argument('--format', choices=['text', 'json'], default='text', help='Output format')
    monitor_parser.add_argument('--tail', action='store_true', help='Follow log file in real-time')

    # Optimize command
    optimize_parser = subparsers.add_parser('optimize', help='Analyze and optimize system')
    optimize_parser.add_argument('--save', action='store_true', help='Save optimized configuration')
    optimize_parser.add_argument('--output', help='Output file for optimized config')

    # Validate command
    validate_parser = subparsers.add_parser('validate', help='Validate configuration')
    validate_parser.add_argument('--config-only', action='store_true', help='Only validate config')
    validate_parser.add_argument('--verbose', action='store_true', help='Verbose output')

    # Deploy command
    deploy_parser = subparsers.add_parser('deploy', help='Deploy optimizations')
    deploy_parser.add_argument('--rollback', help='Rollback to backup path')
    deploy_parser.add_argument('--force', action='store_true', help='Force deployment without confirmation')

    # Dashboard command
    dashboard_parser = subparsers.add_parser('dashboard', help='Real-time dashboard')
    dashboard_parser.add_argument('--url', default='http://localhost:8000', help='Application URL')
    dashboard_parser.add_argument('--interval', type=int, default=5, help='Update interval in seconds')

    # EasyPanel command
    easypanel_parser = subparsers.add_parser('easypanel', help='EasyPanel monitoring')
    easypanel_parser.add_argument('--url', default='http://localhost:8000', help='Application URL')
    easypanel_parser.add_argument('--json', action='store_true', help='JSON output')
    easypanel_parser.add_argument('--interval', type=int, default=5, help='Update interval')

    # R2 cleanup command
    r2_parser = subparsers.add_parser('r2-cleanup', help='Clean up R2 storage')
    r2_parser.add_argument('--dry-run', action='store_true', help='Show what would be deleted')
    r2_parser.add_argument('--confirm', action='store_true', help='Skip confirmation')

    # Status command
    subparsers.add_parser('status', help='Show system status')

    # Interactive command
    subparsers.add_parser('interactive', help='Interactive mode')

    # History command
    history_parser = subparsers.add_parser('history', help='Show command history')
    history_parser.add_argument('--limit', type=int, default=10, help='Number of commands to show')
    history_parser.add_argument('--clear', action='store_true', help='Clear command history')

    return parser


def interactive_mode():
    """Run in interactive mode with command suggestions."""
    print_banner()
    print("🎯 INTERACTIVE MODE")
    print("Type 'help' for commands, 'exit' to quit")
    print("-" * 40)

    history = CommandHistory()

    # Available commands for completion
    commands = [
        'config', 'monitor', 'optimize', 'validate', 'deploy',
        'dashboard', 'easypanel', 'r2-cleanup', 'status', 'history', 'help', 'exit'
    ]

    while True:
        try:
            user_input = input("\n🚀 web2img> ").strip()

            if not user_input:
                continue

            if user_input.lower() in ['exit', 'quit', 'q']:
                print("👋 Goodbye!")
                break

            if user_input.lower() == 'help':
                show_help()
                continue

            if user_input.lower() == 'clear':
                os.system('clear' if os.name == 'posix' else 'cls')
                continue

            # Parse the command
            parts = user_input.split()
            if not parts:
                continue

            command = parts[0].lower()

            # Suggest similar commands if not found
            if command not in commands:
                suggestions = [cmd for cmd in commands if cmd.startswith(command)]
                if suggestions:
                    print(f"❓ Did you mean: {', '.join(suggestions)}")
                else:
                    print(f"❌ Unknown command: {command}")
                    print(f"Available commands: {', '.join(commands)}")
                continue

            # Execute the command
            start_time = time.time()
            try:
                # Reconstruct sys.argv for the command
                sys.argv = ['web2img_manager.py'] + parts
                result = execute_command_with_args(command, parts[1:])
                duration = time.time() - start_time
                history.add_command(command, parts[1:], result == 0, duration)

            except KeyboardInterrupt:
                print("\n⏹️ Command interrupted")
            except Exception as e:
                print(f"❌ Error: {e}")
                duration = time.time() - start_time
                history.add_command(command, parts[1:], False, duration)

        except KeyboardInterrupt:
            print("\n👋 Goodbye!")
            break
        except EOFError:
            print("\n👋 Goodbye!")
            break


def execute_command_with_args(command: str, args: List[str]) -> int:
    """Execute a command with proper argument handling."""
    # Check dependencies for commands that need them
    if command in ['dashboard', 'easypanel', 'optimize'] and not check_dependencies():
        return 1

    try:
        if command == 'config':
            from scripts.legacy.configure_retry_settings import main as config_main
            if not args:
                print("❌ Error: concurrent_users parameter required")
                return 1
            sys.argv = ['configure_retry_settings.py', args[0]]
            return config_main()

        elif command == 'monitor':
            from scripts.legacy.monitor_retry_performance import main as monitor_main
            if not args:
                print("❌ Error: log_file parameter required")
                return 1
            sys.argv = ['monitor_retry_performance.py', args[0]]
            return monitor_main()

        elif command == 'optimize':
            from scripts.legacy.optimize_performance import main as optimize_main
            return asyncio.run(optimize_main())

        elif command == 'validate':
            if '--config-only' in args:
                from scripts.legacy.validate_config import main as validate_config_main
                return validate_config_main()
            else:
                from scripts.legacy.validate_optimizations import main as validate_opt_main
                return asyncio.run(validate_opt_main())

        elif command == 'deploy':
            from scripts.legacy.deploy_optimizations import main as deploy_main
            return asyncio.run(deploy_main())

        elif command == 'dashboard':
            from scripts.legacy.performance_dashboard import main as dashboard_main
            return asyncio.run(dashboard_main())

        elif command == 'easypanel':
            from scripts.legacy.easypanel_monitor import main as easypanel_main
            return easypanel_main()

        elif command == 'r2-cleanup':
            from scripts.legacy.delete_r2_objects import main as r2_main
            return r2_main()

        elif command == 'status':
            print_banner()
            show_quick_status()
            return 0

        elif command == 'history':
            history = CommandHistory()
            limit = 10
            if '--limit' in args:
                try:
                    idx = args.index('--limit')
                    if idx + 1 < len(args):
                        limit = int(args[idx + 1])
                except (ValueError, IndexError):
                    pass

            if '--clear' in args:
                if HISTORY_FILE.exists():
                    HISTORY_FILE.unlink()
                    print("✅ Command history cleared")
                else:
                    print("📝 No history to clear")
            else:
                history.show_history(limit)
            return 0

        else:
            print(f"❌ Unknown command: {command}")
            return 1

    except ImportError as e:
        print(f"❌ Error importing module for command '{command}': {e}")
        return 1
    except Exception as e:
        print(f"❌ Error executing command '{command}': {e}")
        return 1


def main():
    """Main entry point for the management script."""
    # If no arguments, show status and help
    if len(sys.argv) < 2:
        print_banner()
        show_quick_status()
        print(f"\n💡 Run 'python {sys.argv[0]} help' for available commands")
        return 1

    # Parse arguments
    parser = create_argument_parser()

    # Handle special cases before parsing
    if sys.argv[1].lower() in ['help', '--help', '-h']:
        show_help()
        return 0

    if sys.argv[1].lower() == 'interactive':
        interactive_mode()
        return 0

    try:
        args = parser.parse_args()
    except SystemExit as e:
        return e.code

    if not args.command:
        parser.print_help()
        return 1

    # Track command execution
    history = CommandHistory()
    start_time = time.time()

    try:
        result = execute_command_with_args(args.command, sys.argv[2:])
        duration = time.time() - start_time
        history.add_command(args.command, sys.argv[2:], result == 0, duration)
        return result

    except KeyboardInterrupt:
        print("\n👋 Operation cancelled by user")
        duration = time.time() - start_time
        history.add_command(args.command, sys.argv[2:], False, duration)
        return 0
    except Exception as e:
        print(f"❌ Error executing command '{args.command}': {e}")
        duration = time.time() - start_time
        history.add_command(args.command, sys.argv[2:], False, duration)
        return 1


if __name__ == "__main__":
    exit_code = main()
    sys.exit(exit_code)
