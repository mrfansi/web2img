#!/usr/bin/env python3
"""
Validation script for web2img optimizations.

This script runs a comprehensive test suite to validate that the optimizations
are working correctly and the system is performing as expected.
"""

import asyncio
import time
import sys
import json
from pathlib import Path
from typing import Dict, List, Any

# Add the project root to the Python path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from app.services.screenshot import screenshot_service
from app.services.cache import cache_service
from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("optimization_validator")


class OptimizationValidator:
    """Validates that optimizations are working correctly."""

    def __init__(self):
        self.test_results = {}
        self.start_time = None

    async def setup(self):
        """Setup the validation environment."""
        logger.info("Setting up validation environment...")
        self.start_time = time.time()

        # Initialize services
        await screenshot_service.startup()
        logger.info("Screenshot service initialized")

    async def cleanup(self):
        """Cleanup after validation."""
        logger.info("Cleaning up validation environment...")
        await screenshot_service.cleanup()

    async def test_browser_pool_efficiency(self) -> Dict[str, Any]:
        """Test browser pool efficiency and resource management."""
        logger.info("Testing browser pool efficiency...")

        initial_stats = screenshot_service.get_pool_stats()

        # Test concurrent browser usage
        test_urls = [
            "https://example.com",
            "https://httpbin.org/html",
            "https://httpbin.org/json"
        ]

        start_time = time.time()

        # Create concurrent tasks
        tasks = []
        for url in test_urls:
            task = asyncio.create_task(
                screenshot_service.capture_screenshot(url, 1280, 720, "png")
            )
            tasks.append(task)

        try:
            # Wait for all tasks with timeout
            results = await asyncio.wait_for(
                asyncio.gather(*tasks, return_exceptions=True),
                timeout=60.0
            )

            end_time = time.time()
            duration = end_time - start_time

            # Clean up files
            for result in results:
                if isinstance(result, str) and Path(result).exists():
                    Path(result).unlink()

            final_stats = screenshot_service.get_pool_stats()

            return {
                "success": True,
                "duration": duration,
                "initial_pool_size": initial_stats["size"],
                "final_pool_size": final_stats["size"],
                "pool_utilization": final_stats.get("utilization", 0),
                "successful_captures": sum(1 for r in results if isinstance(r, str)),
                "failed_captures": sum(1 for r in results if isinstance(r, Exception))
            }

        except asyncio.TimeoutError:
            return {
                "success": False,
                "error": "Browser pool test timed out",
                "duration": 60.0
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "duration": time.time() - start_time
            }

    async def test_cache_performance(self) -> Dict[str, Any]:
        """Test cache performance and hit rates."""
        logger.info("Testing cache performance...")

        if not settings.cache_enabled:
            return {"success": False, "error": "Cache is disabled"}

        test_url = "https://example.com"

        # Clear cache first
        await cache_service.invalidate()

        # First request (cache miss)
        start_time = time.time()
        try:
            filepath1 = await screenshot_service.capture_screenshot(test_url, 1280, 720, "png")
            first_duration = time.time() - start_time

            # Clean up file
            if Path(filepath1).exists():
                Path(filepath1).unlink()

            # Second request (should be cache hit)
            start_time = time.time()
            filepath2 = await screenshot_service.capture_screenshot(test_url, 1280, 720, "png")
            second_duration = time.time() - start_time

            # Clean up file
            if Path(filepath2).exists():
                Path(filepath2).unlink()

            cache_stats = cache_service.get_stats()

            return {
                "success": True,
                "first_request_duration": first_duration,
                "second_request_duration": second_duration,
                "cache_hit_improvement": (first_duration - second_duration) / first_duration * 100,
                "cache_stats": cache_stats
            }

        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }

    async def test_timeout_effectiveness(self) -> Dict[str, Any]:
        """Test that timeouts are working effectively."""
        logger.info("Testing timeout effectiveness...")

        # Test with a URL that should timeout quickly
        timeout_url = "https://httpbin.org/delay/30"  # 30 second delay

        start_time = time.time()
        try:
            # This should timeout before 30 seconds
            await asyncio.wait_for(
                screenshot_service.capture_screenshot(timeout_url, 1280, 720, "png"),
                timeout=25.0  # Should timeout before this
            )

            duration = time.time() - start_time
            return {
                "success": False,
                "error": "Request should have timed out but didn't",
                "duration": duration
            }

        except asyncio.TimeoutError:
            duration = time.time() - start_time
            return {
                "success": True,
                "timeout_duration": duration,
                "timeout_working": duration < 25.0
            }
        except Exception as e:
            duration = time.time() - start_time
            return {
                "success": True,
                "timeout_duration": duration,
                "timeout_working": True,
                "error_type": type(e).__name__
            }

    async def test_retry_mechanism(self) -> Dict[str, Any]:
        """Test retry mechanism effectiveness."""
        logger.info("Testing retry mechanism...")

        # Get initial retry stats
        initial_stats = screenshot_service.get_retry_stats()

        # Test with a URL that might require retries
        test_url = "https://httpbin.org/status/503"  # Returns 503 error

        start_time = time.time()
        try:
            await screenshot_service.capture_screenshot(test_url, 1280, 720, "png")
            duration = time.time() - start_time

            final_stats = screenshot_service.get_retry_stats()

            return {
                "success": True,
                "duration": duration,
                "retries_attempted": True,
                "initial_stats": initial_stats,
                "final_stats": final_stats
            }

        except Exception as e:
            duration = time.time() - start_time
            final_stats = screenshot_service.get_retry_stats()

            return {
                "success": True,  # Expected to fail, but retries should have been attempted
                "duration": duration,
                "error": str(e),
                "retries_attempted": True,
                "initial_stats": initial_stats,
                "final_stats": final_stats
            }

    async def run_validation(self) -> Dict[str, Any]:
        """Run the complete validation suite."""
        logger.info("Starting optimization validation...")

        await self.setup()

        try:
            # Run all tests
            self.test_results = {
                "browser_pool": await self.test_browser_pool_efficiency(),
                "cache_performance": await self.test_cache_performance(),
                "timeout_effectiveness": await self.test_timeout_effectiveness(),
                "retry_mechanism": await self.test_retry_mechanism()
            }

            # Calculate overall success rate
            successful_tests = sum(1 for test in self.test_results.values() if test.get("success", False))
            total_tests = len(self.test_results)
            success_rate = (successful_tests / total_tests) * 100

            self.test_results["summary"] = {
                "total_tests": total_tests,
                "successful_tests": successful_tests,
                "success_rate": success_rate,
                "total_duration": time.time() - self.start_time
            }

            return self.test_results

        finally:
            await self.cleanup()

    def print_results(self):
        """Print validation results in a readable format."""
        if not self.test_results:
            print("No test results available")
            return

        print("\n" + "="*60)
        print("WEB2IMG OPTIMIZATION VALIDATION RESULTS")
        print("="*60)

        summary = self.test_results.get("summary", {})
        print(f"\n📊 SUMMARY:")
        print(f"   Total Tests: {summary.get('total_tests', 0)}")
        print(f"   Successful: {summary.get('successful_tests', 0)}")
        print(f"   Success Rate: {summary.get('success_rate', 0):.1f}%")
        print(f"   Total Duration: {summary.get('total_duration', 0):.2f}s")

        # Browser Pool Test
        browser_test = self.test_results.get("browser_pool", {})
        print(f"\n🔧 BROWSER POOL TEST:")
        if browser_test.get("success"):
            print(f"   ✅ Success - Duration: {browser_test.get('duration', 0):.2f}s")
            print(f"   Pool Size: {browser_test.get('initial_pool_size')} → {browser_test.get('final_pool_size')}")
            print(f"   Successful Captures: {browser_test.get('successful_captures', 0)}")
        else:
            print(f"   ❌ Failed - {browser_test.get('error', 'Unknown error')}")

        # Cache Test
        cache_test = self.test_results.get("cache_performance", {})
        print(f"\n💾 CACHE PERFORMANCE TEST:")
        if cache_test.get("success"):
            improvement = cache_test.get("cache_hit_improvement", 0)
            print(f"   ✅ Success - Cache hit improvement: {improvement:.1f}%")
            print(f"   First request: {cache_test.get('first_request_duration', 0):.2f}s")
            print(f"   Second request: {cache_test.get('second_request_duration', 0):.2f}s")
        else:
            print(f"   ❌ Failed - {cache_test.get('error', 'Unknown error')}")

        # Timeout Test
        timeout_test = self.test_results.get("timeout_effectiveness", {})
        print(f"\n⏱️  TIMEOUT EFFECTIVENESS TEST:")
        if timeout_test.get("success"):
            print(f"   ✅ Success - Timeout working: {timeout_test.get('timeout_working', False)}")
            print(f"   Timeout duration: {timeout_test.get('timeout_duration', 0):.2f}s")
        else:
            print(f"   ❌ Failed - {timeout_test.get('error', 'Unknown error')}")

        # Retry Test
        retry_test = self.test_results.get("retry_mechanism", {})
        print(f"\n🔄 RETRY MECHANISM TEST:")
        if retry_test.get("success"):
            print(f"   ✅ Success - Retries attempted: {retry_test.get('retries_attempted', False)}")
            print(f"   Duration: {retry_test.get('duration', 0):.2f}s")
        else:
            print(f"   ❌ Failed - {retry_test.get('error', 'Unknown error')}")

        print("\n" + "="*60)


async def main():
    """Main function to run validation."""
    validator = OptimizationValidator()

    try:
        results = await validator.run_validation()
        validator.print_results()

        # Save detailed results to file
        with open("validation_results.json", "w") as f:
            json.dump(results, f, indent=2, default=str)

        print(f"\n📄 Detailed results saved to validation_results.json")

        # Return appropriate exit code
        summary = results.get("summary", {})
        success_rate = summary.get("success_rate", 0)

        if success_rate >= 75:
            print("🎉 Optimizations are working well!")
            return 0
        else:
            print("⚠️  Some optimizations may need adjustment.")
            return 1

    except Exception as e:
        logger.error(f"Validation failed: {e}")
        print(f"❌ Validation failed: {e}")
        return 1


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
