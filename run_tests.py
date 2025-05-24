#!/usr/bin/env python

import argparse
import asyncio
import importlib
import os
import sys
import time
from pathlib import Path
from typing import List, Optional, Dict, Any



# Import the logging setup
from app.core.logging import setup_logging, get_logger

# Set up logging
setup_logging()
logger = get_logger("test_runner")


class TestRunner:
    """Test runner for web2img project."""

    def __init__(self, test_dir: str = "tests"):
        self.test_dir = Path(test_dir)
        self.test_files = []
        self.results: Dict[str, Dict[str, Any]] = {}
        self.discover_tests()

    def discover_tests(self) -> None:
        """Discover all test files in the test directory."""
        if not self.test_dir.exists():
            logger.error(f"Test directory {self.test_dir} does not exist")
            return

        logger.info(f"Discovering tests in {self.test_dir}")
        self.test_files = sorted(
            [f for f in self.test_dir.glob("*.py") if f.name.startswith("test_")]
        )
        logger.info(f"Found {len(self.test_files)} test files")

    def list_tests(self) -> None:
        """List all discovered test files."""
        print("\nAvailable test files:")
        for i, test_file in enumerate(self.test_files, 1):
            print(f"  {i}. {test_file.stem}")
        print()

    async def run_test_file(self, test_file: Path) -> Dict[str, Any]:
        """Run a single test file."""
        result = {
            "name": test_file.stem,
            "status": "failed",
            "error": None,
            "duration": 0,
            "functions_run": [],
        }

        start_time = time.time()
        module_name = f"{self.test_dir.name}.{test_file.stem}"

        try:
            # Import the test module
            logger.info(f"Importing {module_name}")
            module = importlib.import_module(module_name)

            # Find and run test functions
            test_functions = [
                name for name in dir(module) if name.startswith("test_") and callable(getattr(module, name))
            ]

            if not test_functions:
                # If no test_ functions are found, try to use the module's main function as a fallback
                if hasattr(module, "main") and callable(module.main):
                    logger.info(f"Running main() function in {test_file.name}")
                    # Handle both async and sync main functions
                    if asyncio.iscoroutinefunction(module.main):
                        await module.main()
                    else:
                        module.main()
                    result["functions_run"].append("main")
                else:
                    logger.warning(f"No test functions or main() function found in {test_file.name}")
            else:
                # Run each test function in the module
                for func_name in test_functions:
                    func = getattr(module, func_name)
                    logger.info(f"Running {func_name} in {test_file.name}")
                    
                    # Check if the function is async
                    if asyncio.iscoroutinefunction(func):
                        await func()
                    else:
                        func()
                    
                    result["functions_run"].append(func_name)

            result["status"] = "passed"
            logger.info(f"Test {test_file.name} passed")

        except Exception as e:
            logger.error(f"Error running {test_file.name}: {str(e)}")
            result["error"] = str(e)

        result["duration"] = time.time() - start_time
        return result

    async def run_tests(self, test_names: Optional[List[str]] = None) -> Dict[str, Dict[str, Any]]:
        """Run specified tests or all tests if none specified."""
        if not self.test_files:
            logger.error("No test files found")
            return {}

        # Filter test files if specific tests are requested
        files_to_run = []
        if test_names:
            for name in test_names:
                matching = [f for f in self.test_files if f.stem == name or f.stem == f"test_{name}"]
                if matching:
                    files_to_run.extend(matching)
                else:
                    logger.warning(f"No test file found matching '{name}'")
        else:
            files_to_run = self.test_files

        if not files_to_run:
            logger.error("No matching test files to run")
            return {}

        logger.info(f"Running {len(files_to_run)} test files")
        
        # Run each test file
        for test_file in files_to_run:
            logger.info(f"Running test file: {test_file.name}")
            result = await self.run_test_file(test_file)
            self.results[test_file.stem] = result

        return self.results

    def print_results(self) -> None:
        """Print test results in a formatted way."""
        if not self.results:
            print("\nNo test results to display.")
            return

        passed = sum(1 for r in self.results.values() if r["status"] == "passed")
        failed = len(self.results) - passed

        print("\n" + "=" * 70)
        print(f"Test Results: {passed} passed, {failed} failed")
        print("=" * 70)

        for name, result in self.results.items():
            status_str = "✅ PASSED" if result["status"] == "passed" else "❌ FAILED"
            print(f"\n{name}: {status_str} ({result['duration']:.2f}s)")
            
            if result["functions_run"]:
                print(f"  Functions: {', '.join(result['functions_run'])}")
            
            if result["error"]:
                print(f"  Error: {result['error']}")

        print("\n" + "=" * 70)
        print(f"Summary: {passed}/{len(self.results)} tests passed")
        print("=" * 70 + "\n")


async def main():
    parser = argparse.ArgumentParser(description="Run tests for web2img project")
    parser.add_argument(
        "tests", nargs="*", help="Specific test names to run (without .py extension)"
    )
    parser.add_argument(
        "-l", "--list", action="store_true", help="List available tests"
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="Enable verbose output"
    )

    args = parser.parse_args()

    # Create test runner
    runner = TestRunner()

    # List tests if requested
    if args.list:
        runner.list_tests()
        return 0

    # Run tests
    print(f"\nRunning {'specified' if args.tests else 'all'} tests...")
    results = await runner.run_tests(args.tests)
    
    # Print results
    runner.print_results()
    
    # Return exit code based on test results
    failed = sum(1 for r in results.values() if r["status"] != "passed")
    return 1 if failed > 0 else 0


if __name__ == "__main__":
    exit_code = asyncio.run(main())
    sys.exit(exit_code)
