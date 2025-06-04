#!/usr/bin/env python3
"""
Production Diagnostic Tool for web2img
Quick diagnostic to understand production issues
"""

import asyncio
import aiohttp
import time
import json
from typing import Optional

class ProductionDiagnostic:
    def __init__(self, base_url: str = "https://system-web2img.2wczxa.easypanel.host"):
        self.base_url = base_url
    
    async def test_endpoint(self, session: aiohttp.ClientSession, endpoint: str, method: str = "GET", payload: Optional[dict] = None) -> dict:
        """Test a specific endpoint and return detailed results."""
        start_time = time.time()
        url = f"{self.base_url}{endpoint}"
        
        try:
            if method.upper() == "POST":
                async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=30)) as response:
                    response_time = time.time() - start_time
                    try:
                        response_data = await response.text()
                    except:
                        response_data = "Could not read response"
                    
                    return {
                        "endpoint": endpoint,
                        "method": method,
                        "status": response.status,
                        "response_time": response_time,
                        "success": 200 <= response.status < 300,
                        "response_size": len(response_data),
                        "error": None
                    }
            else:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as response:
                    response_time = time.time() - start_time
                    try:
                        response_data = await response.text()
                    except:
                        response_data = "Could not read response"
                    
                    return {
                        "endpoint": endpoint,
                        "method": method,
                        "status": response.status,
                        "response_time": response_time,
                        "success": 200 <= response.status < 300,
                        "response_size": len(response_data),
                        "error": None
                    }
                    
        except asyncio.TimeoutError:
            response_time = time.time() - start_time
            return {
                "endpoint": endpoint,
                "method": method,
                "status": 0,
                "response_time": response_time,
                "success": False,
                "response_size": 0,
                "error": "Timeout"
            }
        except Exception as e:
            response_time = time.time() - start_time
            return {
                "endpoint": endpoint,
                "method": method,
                "status": 0,
                "response_time": response_time,
                "success": False,
                "response_size": 0,
                "error": str(e)
            }
    
    async def run_diagnostics(self):
        """Run comprehensive diagnostics on the production service."""
        print("🔍 Production Diagnostic for web2img")
        print(f"🎯 Target: {self.base_url}")
        print("=" * 60)
        
        connector = aiohttp.TCPConnector(
            limit=10,
            keepalive_timeout=30,
            enable_cleanup_closed=True
        )
        
        async with aiohttp.ClientSession(connector=connector) as session:
            # Test basic endpoints
            endpoints_to_test = [
                ("/", "GET"),
                ("/health", "GET"),
                ("/docs", "GET"),
                ("/openapi.json", "GET"),
            ]
            
            print("📡 Testing Basic Endpoints:")
            for endpoint, method in endpoints_to_test:
                result = await self.test_endpoint(session, endpoint, method)
                status_icon = "✅" if result["success"] else "❌"
                print(f"   {status_icon} {method} {endpoint}: {result['status']} ({result['response_time']:.2f}s)")
                if result["error"]:
                    print(f"      Error: {result['error']}")
            
            print("\n📸 Testing Screenshot Endpoints:")
            
            # Test simple screenshot request
            simple_payload = {
                "url": "https://example.com",
                "width": 1280,
                "height": 720,
                "format": "png"
            }
            
            print("   Testing simple screenshot (example.com)...")
            result = await self.test_endpoint(session, "/screenshot", "POST", simple_payload)
            status_icon = "✅" if result["success"] else "❌"
            print(f"   {status_icon} POST /screenshot (simple): {result['status']} ({result['response_time']:.2f}s)")
            if result["error"]:
                print(f"      Error: {result['error']}")
            
            # Test URL transformation scenarios
            transformation_tests = [
                {
                    "name": "viding.co transformation",
                    "payload": {
                        "url": "https://viding.co",
                        "width": 1280,
                        "height": 720,
                        "format": "png"
                    }
                },
                {
                    "name": "viding.org transformation", 
                    "payload": {
                        "url": "https://viding.org",
                        "width": 1280,
                        "height": 720,
                        "format": "png"
                    }
                },
                {
                    "name": "problematic mini-rsvp URL",
                    "payload": {
                        "url": "https://viding.co/mini-rsvp/1238786",
                        "width": 1280,
                        "height": 720,
                        "format": "png"
                    }
                }
            ]
            
            for test in transformation_tests:
                print(f"   Testing {test['name']}...")
                result = await self.test_endpoint(session, "/screenshot", "POST", test["payload"])
                status_icon = "✅" if result["success"] else "❌"
                print(f"   {status_icon} {test['name']}: {result['status']} ({result['response_time']:.2f}s)")
                if result["error"]:
                    print(f"      Error: {result['error']}")
                
                # Brief pause between tests
                await asyncio.sleep(2)
            
            print("\n📊 Diagnostic Summary:")
            print("=" * 60)
            
            # Test concurrent requests
            print("🔄 Testing concurrent load (5 requests)...")
            concurrent_tasks = []
            for i in range(5):
                task = self.test_endpoint(session, "/screenshot", "POST", simple_payload)
                concurrent_tasks.append(task)
            
            concurrent_results = await asyncio.gather(*concurrent_tasks, return_exceptions=True)
            
            successful_concurrent = sum(1 for r in concurrent_results if isinstance(r, dict) and r.get("success", False))
            avg_concurrent_time = sum(r.get("response_time", 0) for r in concurrent_results if isinstance(r, dict)) / len(concurrent_results)
            
            print(f"   Concurrent Success Rate: {successful_concurrent}/{len(concurrent_results)} ({successful_concurrent/len(concurrent_results)*100:.1f}%)")
            print(f"   Average Response Time: {avg_concurrent_time:.2f}s")
            
            # Analyze errors
            errors = [r.get("error") for r in concurrent_results if isinstance(r, dict) and r.get("error")]
            if errors:
                print(f"   Common Errors: {set(errors)}")
            
            print("\n🎯 Recommendations:")
            if successful_concurrent < len(concurrent_results):
                print("   ⚠️  Service is experiencing issues under concurrent load")
                print("   💡 Consider checking browser pool configuration")
                print("   💡 Monitor server resources (CPU, memory)")
                print("   💡 Check for domcontentloaded timeout issues")
            else:
                print("   ✅ Service appears to be handling concurrent requests well")
            
            if avg_concurrent_time > 10:
                print("   ⚠️  Response times are slow")
                print("   💡 Consider optimizing browser cache settings")
                print("   💡 Check storage performance (R2/local)")
                print("   💡 Monitor network latency")
            
            print("\n" + "=" * 60)

async def main():
    import argparse
    
    parser = argparse.ArgumentParser(description="Production diagnostic for web2img")
    parser.add_argument("--url", default="https://system-web2img.2wczxa.easypanel.host",
                       help="Production API base URL")
    
    args = parser.parse_args()
    
    diagnostic = ProductionDiagnostic(args.url)
    await diagnostic.run_diagnostics()

if __name__ == "__main__":
    asyncio.run(main())
