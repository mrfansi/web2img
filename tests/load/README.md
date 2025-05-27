# Web2Img Load Testing

This directory contains load and stress tests for the web2img service using [k6](https://k6.io/), a modern load testing tool.

## Prerequisites

1. Install k6 on your system:

   **macOS**:
   ```bash
   brew install k6
   ```

   **Linux**:
   ```bash
   sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
   echo "deb https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
   sudo apt-get update
   sudo apt-get install k6
   ```

   **Other platforms**: See [k6 installation documentation](https://k6.io/docs/getting-started/installation/)

2. Ensure web2img service is running on localhost:8000 (or update the BASE_URL in the test script)

## Running the Tests

### Basic Run

To run all test scenarios:

```bash
k6 run screenshot_stress_test.js
```

### Run a Specific Scenario

To run only a specific test scenario:

```bash
k6 run --tag test_type=constant screenshot_stress_test.js    # Run only constant load test
k6 run --tag test_type=ramp screenshot_stress_test.js        # Run only ramp-up test
k6 run --tag test_type=stress screenshot_stress_test.js      # Run only stress test
k6 run --tag test_type=spike screenshot_stress_test.js       # Run only spike test
```

### Adjust Virtual Users

To adjust the number of virtual users:

```bash
k6 run --vus 20 --duration 30s screenshot_stress_test.js
```

### Output Results to a File

To save the results to a JSON file:

```bash
k6 run --out json=results.json screenshot_stress_test.js
```

## Test Scenarios

The test script includes four different load patterns:

1. **Constant Load Test**: Maintains a steady rate of 5 requests per second for 30 seconds
2. **Ramp-up Test**: Gradually increases load from 1 to 15 requests per second
3. **Stress Test**: Pushes the system to its limits with up to 30 requests per second
4. **Spike Test**: Creates a sudden burst of traffic (up to 50 requests per second)

## Success Criteria

The tests include thresholds that define success criteria:

- 95% of requests should complete within 5 seconds
- Less than 10% of requests should fail
- Error rate should be less than 10%
- Success rate should be above 90%

## Modifying the Test

You can modify the test parameters in the `screenshot_stress_test.js` file:

- **TEST_URLS**: Add or remove URLs to test with
- **options.scenarios**: Adjust the load patterns, durations, and request rates
- **thresholds**: Change the success criteria

## Troubleshooting

If you encounter issues:

1. Ensure the web2img service is running and accessible
2. Check that the URLs in TEST_URLS are accessible
3. Adjust the load parameters if your system can't handle the default load
4. Increase the browser pool size in your .env file if you're seeing browser pool exhaustion errors
