#!/usr/bin/env python3
"""
Deployment script for web2img optimizations.

This script helps you safely deploy the optimizations step by step,
with validation and rollback capabilities.
"""

import sys
import shutil
import asyncio
import json
from pathlib import Path
from datetime import datetime
from typing import Dict, Any

# Add the project root to the Python path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from app.core.logging import get_logger

logger = get_logger("deployment")


class OptimizationDeployer:
    """Handles safe deployment of optimizations."""
    
    def __init__(self):
        self.backup_dir = Path("backups")
        self.backup_dir.mkdir(exist_ok=True)
        self.timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        
    def backup_current_config(self) -> str:
        """Backup current configuration files."""
        backup_path = self.backup_dir / f"config_backup_{self.timestamp}"
        backup_path.mkdir(exist_ok=True)
        
        files_to_backup = [
            ".env",
            "app/core/config.py",
            ".env.example"
        ]
        
        backed_up_files = []
        for file_path in files_to_backup:
            if Path(file_path).exists():
                backup_file = backup_path / Path(file_path).name
                shutil.copy2(file_path, backup_file)
                backed_up_files.append(file_path)
                logger.info(f"Backed up {file_path} to {backup_file}")
        
        # Save backup manifest
        manifest = {
            "timestamp": self.timestamp,
            "files": backed_up_files,
            "backup_path": str(backup_path)
        }
        
        with open(backup_path / "manifest.json", "w") as f:
            json.dump(manifest, f, indent=2)
        
        return str(backup_path)
    
    def apply_optimized_config(self) -> bool:
        """Apply the optimized configuration."""
        try:
            # Check if .env.optimized exists
            if not Path(".env.optimized").exists():
                logger.error(".env.optimized file not found. Run optimize_performance.py first.")
                return False
            
            # Read optimized config
            with open(".env.optimized", "r") as f:
                optimized_config = f.read()
            
            # If .env exists, merge with existing config
            if Path(".env").exists():
                with open(".env", "r") as f:
                    existing_config = f.read()
                
                # Create merged config
                merged_config = self._merge_configs(existing_config, optimized_config)
            else:
                # Use optimized config as base and add required settings
                merged_config = self._add_required_settings(optimized_config)
            
            # Write merged config to .env
            with open(".env", "w") as f:
                f.write(merged_config)
            
            logger.info("Applied optimized configuration to .env")
            return True
            
        except Exception as e:
            logger.error(f"Failed to apply optimized config: {e}")
            return False
    
    def _merge_configs(self, existing: str, optimized: str) -> str:
        """Merge existing and optimized configurations."""
        # Parse existing config
        existing_vars = {}
        for line in existing.split('\n'):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, value = line.split('=', 1)
                existing_vars[key.strip()] = value.strip()
        
        # Parse optimized config
        optimized_vars = {}
        optimized_comments = []
        for line in optimized.split('\n'):
            line_stripped = line.strip()
            if line_stripped.startswith('#') or not line_stripped:
                optimized_comments.append(line)
            elif '=' in line_stripped:
                key, value = line_stripped.split('=', 1)
                optimized_vars[key.strip()] = value.strip()
        
        # Merge configurations (optimized takes precedence for performance settings)
        performance_keys = {
            'WORKERS', 'BROWSER_POOL_MIN_SIZE', 'BROWSER_POOL_MAX_SIZE',
            'BROWSER_POOL_IDLE_TIMEOUT', 'BROWSER_POOL_MAX_AGE', 'BROWSER_POOL_CLEANUP_INTERVAL',
            'NAVIGATION_TIMEOUT_REGULAR', 'NAVIGATION_TIMEOUT_COMPLEX', 'BROWSER_LAUNCH_TIMEOUT',
            'CONTEXT_CREATION_TIMEOUT', 'SCREENSHOT_TIMEOUT', 'MAX_RETRIES_REGULAR',
            'MAX_RETRIES_COMPLEX', 'RETRY_BASE_DELAY', 'RETRY_MAX_DELAY', 'RETRY_JITTER',
            'CIRCUIT_BREAKER_THRESHOLD', 'CIRCUIT_BREAKER_RESET_TIME', 'CACHE_ENABLED',
            'CACHE_TTL_SECONDS', 'CACHE_MAX_ITEMS'
        }
        
        # Start with existing config
        merged_vars = existing_vars.copy()
        
        # Override with optimized performance settings
        for key, value in optimized_vars.items():
            if key in performance_keys:
                merged_vars[key] = value
        
        # Build merged config string
        merged_lines = ["# Web2img Configuration - Optimized", ""]
        
        # Add optimized comments
        merged_lines.extend(optimized_comments[:5])  # Add header comments
        merged_lines.append("")
        
        # Add all variables
        for key, value in merged_vars.items():
            merged_lines.append(f"{key}={value}")
        
        return '\n'.join(merged_lines)
    
    def _add_required_settings(self, optimized_config: str) -> str:
        """Add required settings to optimized config."""
        required_settings = [
            "# Required settings - add your actual values",
            "R2_ACCESS_KEY_ID=your_access_key_id",
            "R2_SECRET_ACCESS_KEY=your_secret_access_key", 
            "R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com",
            "R2_BUCKET=your_bucket_name",
            "R2_PUBLIC_URL=https://your-public-url.example.com",
            "R2_OBJECT_EXPIRATION_DAYS=3",
            "",
            "IMGPROXY_BASE_URL=https://your-imgproxy-url.example.com",
            "IMGPROXY_KEY=your_imgproxy_key",
            "IMGPROXY_SALT=your_imgproxy_salt",
            ""
        ]
        
        return '\n'.join(required_settings) + '\n' + optimized_config
    
    async def validate_deployment(self) -> Dict[str, Any]:
        """Validate that the deployment is working correctly."""
        try:
            # Import and run validation
            from scripts.validate_optimizations import OptimizationValidator
            
            validator = OptimizationValidator()
            results = await validator.run_validation()
            
            return results
            
        except Exception as e:
            logger.error(f"Validation failed: {e}")
            return {"success": False, "error": str(e)}
    
    def rollback(self, backup_path: str) -> bool:
        """Rollback to previous configuration."""
        try:
            backup_dir = Path(backup_path)
            if not backup_dir.exists():
                logger.error(f"Backup directory {backup_path} not found")
                return False
            
            # Read manifest
            manifest_file = backup_dir / "manifest.json"
            if not manifest_file.exists():
                logger.error("Backup manifest not found")
                return False
            
            with open(manifest_file, "r") as f:
                manifest = json.load(f)
            
            # Restore files
            for file_path in manifest["files"]:
                backup_file = backup_dir / Path(file_path).name
                if backup_file.exists():
                    shutil.copy2(backup_file, file_path)
                    logger.info(f"Restored {file_path} from backup")
            
            logger.info("Rollback completed successfully")
            return True
            
        except Exception as e:
            logger.error(f"Rollback failed: {e}")
            return False
    
    def print_deployment_summary(self, backup_path: str, validation_results: Dict[str, Any]):
        """Print deployment summary."""
        print("\n" + "="*60)
        print("WEB2IMG OPTIMIZATION DEPLOYMENT SUMMARY")
        print("="*60)
        
        print(f"\n📁 BACKUP CREATED:")
        print(f"   Location: {backup_path}")
        print(f"   Timestamp: {self.timestamp}")
        
        print(f"\n⚙️  CONFIGURATION APPLIED:")
        print(f"   ✅ Optimized settings applied to .env")
        print(f"   ✅ Performance parameters updated")
        print(f"   ✅ Resource limits optimized")
        
        if validation_results.get("summary"):
            summary = validation_results["summary"]
            print(f"\n🧪 VALIDATION RESULTS:")
            print(f"   Tests Run: {summary.get('total_tests', 0)}")
            print(f"   Successful: {summary.get('successful_tests', 0)}")
            print(f"   Success Rate: {summary.get('success_rate', 0):.1f}%")
            
            if summary.get('success_rate', 0) >= 75:
                print(f"   Status: ✅ DEPLOYMENT SUCCESSFUL")
            else:
                print(f"   Status: ⚠️  DEPLOYMENT NEEDS ATTENTION")
        
        print(f"\n🚀 NEXT STEPS:")
        print(f"   1. Update your .env file with actual R2 and imgproxy credentials")
        print(f"   2. Test the service with: python main.py")
        print(f"   3. Monitor performance and adjust settings as needed")
        print(f"   4. Run validation periodically: python scripts/validate_optimizations.py")
        
        print(f"\n🔄 ROLLBACK (if needed):")
        print(f"   python scripts/deploy_optimizations.py --rollback {backup_path}")
        
        print("\n" + "="*60)


async def main():
    """Main deployment function."""
    deployer = OptimizationDeployer()
    
    # Check for rollback command
    if len(sys.argv) > 1 and sys.argv[1] == "--rollback":
        if len(sys.argv) < 3:
            print("Usage: python scripts/deploy_optimizations.py --rollback <backup_path>")
            return 1
        
        backup_path = sys.argv[2]
        if deployer.rollback(backup_path):
            print("✅ Rollback completed successfully")
            return 0
        else:
            print("❌ Rollback failed")
            return 1
    
    print("🚀 Starting web2img optimization deployment...")
    
    # Step 1: Backup current configuration
    print("\n📁 Creating backup of current configuration...")
    backup_path = deployer.backup_current_config()
    print(f"✅ Backup created at: {backup_path}")
    
    # Step 2: Apply optimized configuration
    print("\n⚙️  Applying optimized configuration...")
    if not deployer.apply_optimized_config():
        print("❌ Failed to apply optimized configuration")
        return 1
    print("✅ Optimized configuration applied")
    
    # Step 3: Validate deployment
    print("\n🧪 Validating deployment...")
    validation_results = await deployer.validate_deployment()
    
    # Step 4: Print summary
    deployer.print_deployment_summary(backup_path, validation_results)
    
    # Return appropriate exit code
    if validation_results.get("summary", {}).get("success_rate", 0) >= 75:
        return 0
    else:
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
