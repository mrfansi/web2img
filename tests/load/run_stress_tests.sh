#!/bin/bash

# Colors for output
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
BLUE="\033[0;34m"
RED="\033[0;31m"
NC="\033[0m" # No Color

# Create results directory
RESULTS_DIR="results_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$RESULTS_DIR"

echo -e "${BLUE}=== Web2Img Screenshot Service Stress Test ===${NC}"
echo -e "${YELLOW}Results will be saved to: ${RESULTS_DIR}${NC}"

# Function to run a test and save results
run_test() {
    local test_type=$1
    local description=$2
    
    echo -e "\n${YELLOW}Running $description...${NC}"
    # Get the directory where this script is located
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    k6 run --tag test_type=$test_type --out json=${RESULTS_DIR}/${test_type}_results.json "${SCRIPT_DIR}/screenshot_stress_test.js"
    
    # Check if test was successful
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}[SUCCESS] $description completed successfully${NC}"
    else
        echo -e "${RED}[FAILED] $description failed${NC}"
    fi
}

# Check if k6 is installed
if ! command -v k6 &> /dev/null; then
    echo -e "${RED}Error: k6 is not installed. Please install it first.${NC}"
    echo -e "macOS: brew install k6"
    echo -e "Linux: Follow instructions at https://k6.io/docs/getting-started/installation/"
    exit 1
fi

# Check if web2img service is running
if ! curl -s http://localhost:8000/health > /dev/null; then
    echo -e "${RED}Error: web2img service is not running on localhost:8000${NC}"
    echo -e "Please start the service before running the tests"
    exit 1
fi

# Run all tests or specific test based on argument
if [ "$1" == "" ] || [ "$1" == "all" ]; then
    echo -e "${BLUE}Running all test scenarios${NC}"
    
    run_test "constant" "Constant Load Test"
    run_test "ramp" "Ramp-up Test"
    run_test "stress" "Stress Test"
    run_test "spike" "Spike Test"
    
    echo -e "\n${GREEN}All tests completed. Results saved to ${RESULTS_DIR}${NC}"
elif [ "$1" == "constant" ]; then
    run_test "constant" "Constant Load Test"
elif [ "$1" == "ramp" ]; then
    run_test "ramp" "Ramp-up Test"
elif [ "$1" == "stress" ]; then
    run_test "stress" "Stress Test"
elif [ "$1" == "spike" ]; then
    run_test "spike" "Spike Test"
else
    echo -e "${RED}Invalid test type: $1${NC}"
    echo -e "Usage: $0 [all|constant|ramp|stress|spike]"
    exit 1
fi

# Generate summary report
echo -e "\n${BLUE}=== Test Summary ===${NC}"
echo -e "${YELLOW}Test results are available in the ${RESULTS_DIR} directory${NC}"
echo -e "${YELLOW}To view detailed results, run: cat ${RESULTS_DIR}/<test_type>_results.json${NC}"
