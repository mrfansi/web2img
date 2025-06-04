#!/bin/bash

# Production Stress Test Runner for web2img
# Quick and easy way to run various stress test scenarios

set -e

PRODUCTION_URL="https://system-web2img.2wczxa.easypanel.host"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_SCRIPT="$SCRIPT_DIR/tests/production_stress_test.py"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Function to check if Python script exists
check_script() {
    if [[ ! -f "$TEST_SCRIPT" ]]; then
        print_error "Test script not found: $TEST_SCRIPT"
        exit 1
    fi
}

# Function to check if required Python packages are installed
check_dependencies() {
    print_info "Checking dependencies..."

    # Check if virtual environment exists and has aiohttp
    if [[ -f "$SCRIPT_DIR/stress_test_env/bin/activate" ]]; then
        source "$SCRIPT_DIR/stress_test_env/bin/activate"
        python3 -c "import aiohttp, asyncio" 2>/dev/null && {
            print_success "Dependencies OK (using virtual environment)"
            return 0
        }
    fi

    # Try system Python
    python3 -c "import aiohttp, asyncio" 2>/dev/null && {
        print_success "Dependencies OK (using system Python)"
        return 0
    }

    print_error "Required Python packages not found."
    print_info "Creating virtual environment and installing dependencies..."

    # Create virtual environment and install dependencies
    python3 -m venv "$SCRIPT_DIR/stress_test_env" || {
        print_error "Failed to create virtual environment"
        exit 1
    }

    source "$SCRIPT_DIR/stress_test_env/bin/activate"
    pip install aiohttp || {
        print_error "Failed to install aiohttp"
        exit 1
    }

    print_success "Dependencies installed successfully"
}

# Function to show usage
show_usage() {
    echo "Production Stress Test Runner for web2img"
    echo ""
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  light      - Light load test (25 concurrent, 250 requests)"
    echo "  moderate   - Moderate load test (50 concurrent, 500 requests)"
    echo "  heavy      - Heavy load test (100 concurrent, 1000 requests)"
    echo "  extreme    - Extreme load test (200 concurrent, 2000 requests)"
    echo "  ramp-up    - Gradual ramp-up test"
    echo "  timeout    - Timeout analysis on problematic URLs"
    echo "  timeout-deep - Deep timeout analysis with sequential and concurrent tests"
    echo "  diagnostic - Comprehensive diagnostic of production service"
    echo "  monitor    - Continuous health monitoring"
    echo "  custom     - Custom test with specified parameters"
    echo "  health     - Quick health check"
    echo ""
    echo "Options for custom test:"
    echo "  --concurrency N    Number of concurrent requests"
    echo "  --requests N       Total number of requests"
    echo "  --duration N       Maximum test duration in seconds"
    echo ""
    echo "Examples:"
    echo "  $0 light                    # Run light load test"
    echo "  $0 ramp-up                  # Run gradual ramp-up test"
    echo "  $0 custom --concurrency 75 --requests 750"
    echo ""
}

# Function to run health check
run_health_check() {
    print_info "Running health check on $PRODUCTION_URL"

    # Simple curl-based health check
    if command -v curl >/dev/null 2>&1; then
        if curl -s --max-time 10 "$PRODUCTION_URL/health" >/dev/null 2>&1 ||
            curl -s --max-time 10 "$PRODUCTION_URL/" >/dev/null 2>&1; then
            print_success "Service is responding"
            return 0
        else
            print_error "Service is not responding"
            return 1
        fi
    else
        print_warning "curl not found, skipping health check"
        return 0
    fi
}

# Function to run stress test
run_stress_test() {
    local concurrency=$1
    local requests=$2
    local extra_args=$3

    print_info "Starting stress test..."
    print_info "Target: $PRODUCTION_URL"
    print_info "Concurrency: $concurrency"
    print_info "Requests: $requests"

    # Confirmation for high-load tests
    if [[ $concurrency -gt 100 ]]; then
        print_warning "High concurrency test detected!"
        print_warning "This will generate significant load on the production server."
        read -p "Are you sure you want to continue? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_info "Test cancelled."
            exit 0
        fi
    fi

    # Activate virtual environment if it exists
    if [[ -f "$SCRIPT_DIR/stress_test_env/bin/activate" ]]; then
        source "$SCRIPT_DIR/stress_test_env/bin/activate"
    fi

    # Run the test
    python3 "$TEST_SCRIPT" \
        --url "$PRODUCTION_URL" \
        --concurrency "$concurrency" \
        --requests "$requests" \
        $extra_args
}

# Main script logic
main() {
    check_script
    check_dependencies

    case "${1:-help}" in
    "light")
        run_health_check && run_stress_test 25 250
        ;;
    "moderate")
        run_health_check && run_stress_test 50 500
        ;;
    "heavy")
        run_health_check && run_stress_test 100 1000
        ;;
    "extreme")
        run_health_check && run_stress_test 200 2000
        ;;
    "ramp-up")
        run_health_check && run_stress_test 200 1000 "--ramp-up"
        ;;
    "timeout")
        print_info "Running timeout analysis on problematic URLs..."
        # Activate virtual environment if it exists
        if [[ -f "$SCRIPT_DIR/stress_test_env/bin/activate" ]]; then
            source "$SCRIPT_DIR/stress_test_env/bin/activate"
        fi
        python3 "$TEST_SCRIPT" \
            --url "$PRODUCTION_URL" \
            --timeout-analysis \
            --concurrency 5 \
            --requests 10
        ;;
    "timeout-deep")
        print_info "Running deep timeout analysis..."
        # Activate virtual environment if it exists
        if [[ -f "$SCRIPT_DIR/stress_test_env/bin/activate" ]]; then
            source "$SCRIPT_DIR/stress_test_env/bin/activate"
        fi
        python3 "$SCRIPT_DIR/tests/production_timeout_stress.py" --url "$PRODUCTION_URL" --all
        ;;
    "diagnostic")
        print_info "Running comprehensive diagnostic..."
        # Activate virtual environment if it exists
        if [[ -f "$SCRIPT_DIR/stress_test_env/bin/activate" ]]; then
            source "$SCRIPT_DIR/stress_test_env/bin/activate"
        fi
        python3 "$SCRIPT_DIR/tests/production_diagnostic.py" --url "$PRODUCTION_URL"
        ;;
    "monitor")
        print_info "Starting continuous health monitoring..."
        print_info "Press Ctrl+C to stop monitoring"
        # Activate virtual environment if it exists
        if [[ -f "$SCRIPT_DIR/stress_test_env/bin/activate" ]]; then
            source "$SCRIPT_DIR/stress_test_env/bin/activate"
        fi
        python3 "$SCRIPT_DIR/monitor_production_health.py" --url "$PRODUCTION_URL" --interval 180
        ;;
    "custom")
        shift
        concurrency=50
        requests=500
        extra_args=""

        while [[ $# -gt 0 ]]; do
            case $1 in
            --concurrency)
                concurrency="$2"
                shift 2
                ;;
            --requests)
                requests="$2"
                shift 2
                ;;
            --duration)
                extra_args="$extra_args --duration $2"
                shift 2
                ;;
            *)
                print_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
            esac
        done

        run_health_check && run_stress_test "$concurrency" "$requests" "$extra_args"
        ;;
    "health")
        run_health_check
        ;;
    "help" | "-h" | "--help")
        show_usage
        ;;
    *)
        print_error "Unknown command: $1"
        show_usage
        exit 1
        ;;
    esac
}

# Run main function with all arguments
main "$@"
