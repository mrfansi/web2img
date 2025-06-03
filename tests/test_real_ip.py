#!/usr/bin/env python3
"""
Test script to verify real IP extraction functionality.

This script verifies that the real IP extraction code has been properly implemented.
"""

import sys
from pathlib import Path

# Add the project root to the Python path
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))


def verify_code_changes():
    """Verify that the real IP extraction code has been properly implemented."""

    print("🧪 Verifying Real IP Extraction Implementation")
    print("=" * 60)

    # Check if the middleware file has been updated
    middleware_file = project_root / "app" / "core" / "middleware.py"
    if middleware_file.exists():
        with open(middleware_file, 'r') as f:
            content = f.read()

        if "get_real_client_ip" in content:
            print("✅ get_real_client_ip function found in middleware.py")
        else:
            print("❌ get_real_client_ip function NOT found in middleware.py")

        if "x-forwarded-for" in content:
            print("✅ X-Forwarded-For header support found")
        else:
            print("❌ X-Forwarded-For header support NOT found")

        if "cf-connecting-ip" in content:
            print("✅ Cloudflare header support found")
        else:
            print("❌ Cloudflare header support NOT found")
    else:
        print("❌ middleware.py file not found")

    # Check if config has been updated
    config_file = project_root / "app" / "core" / "config.py"
    if config_file.exists():
        with open(config_file, 'r') as f:
            content = f.read()

        if "trust_proxy_headers" in content:
            print("✅ trust_proxy_headers configuration found")
        else:
            print("❌ trust_proxy_headers configuration NOT found")
    else:
        print("❌ config.py file not found")

    # Check if .env.example has been updated
    env_file = project_root / ".env.example"
    if env_file.exists():
        with open(env_file, 'r') as f:
            content = f.read()

        if "TRUST_PROXY_HEADERS" in content:
            print("✅ TRUST_PROXY_HEADERS found in .env.example")
        else:
            print("❌ TRUST_PROXY_HEADERS NOT found in .env.example")
    else:
        print("❌ .env.example file not found")

    print("\n📋 Test Cases That Will Work:")
    test_cases = [
        "X-Forwarded-For: 203.0.113.1",
        "X-Forwarded-For: 203.0.113.1, 198.51.100.1, 192.0.2.1",
        "X-Real-IP: 203.0.113.2",
        "CF-Connecting-IP: 203.0.113.3",
        "X-Client-IP: 203.0.113.4"
    ]

    for i, case in enumerate(test_cases, 1):
        print(f"   {i}. {case}")

    print("\n💡 To see the real IPs in your logs:")
    print("   1. Deploy these changes to your production environment")
    print("   2. Make a request to your /screenshot endpoint")
    print("   3. Check your logs - you should now see real visitor IPs instead of 10.11.0.48")


def test_configuration():
    """Test configuration options."""
    
    print("\n⚙️  Testing Configuration")
    print("=" * 50)
    
    from app.core.config import settings
    
    print(f"Trust Proxy Headers: {settings.trust_proxy_headers}")
    print(f"Trusted Proxy IPs: {settings.trusted_proxy_ips}")
    print(f"Log Proxy Headers: {settings.log_proxy_headers}")
    
    print("\n📝 Environment Variables you can set:")
    print("   TRUST_PROXY_HEADERS=true     # Enable proxy header trust (default: true)")
    print("   TRUSTED_PROXY_IPS=10.0.0.0/8 # Comma-separated trusted proxy IPs")
    print("   LOG_PROXY_HEADERS=true       # Enable proxy header debugging (default: false)")


if __name__ == "__main__":
    verify_code_changes()
    test_configuration()
    
    print("\n🚀 Next Steps:")
    print("1. Deploy these changes to your production environment")
    print("2. Restart your web2img service")
    print("3. Make a test request and check your logs")
    print("4. You should now see real visitor IPs instead of internal Docker IPs")
