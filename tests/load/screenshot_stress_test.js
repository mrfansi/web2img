import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

// Custom metrics
const errorRate = new Rate("errors");
const successRate = new Rate("success");

// Test configuration
export const options = {
  // Base configuration
  insecureSkipTLSVerify: true,
  noConnectionReuse: false,

  // Scenarios for different test patterns
  scenarios: {
    // Constant load test
    constant_load: {
      executor: "constant-arrival-rate",
      rate: 5, // 5 requests per second
      timeUnit: "1s", // 1 second
      duration: "30s", // Run for 30 seconds
      preAllocatedVUs: 10, // Pre-allocate 10 VUs
      maxVUs: 20, // Maximum 20 VUs
      exec: "constantLoad", // Function to execute
      tags: { test_type: "constant" },
    },

    // Ramp-up test (gradually increasing load)
    ramp_up: {
      executor: "ramping-arrival-rate",
      startRate: 1, // Start with 1 request per second
      timeUnit: "1s", // 1 second
      preAllocatedVUs: 5, // Pre-allocate 5 VUs
      maxVUs: 50, // Maximum 50 VUs
      stages: [
        { duration: "20s", target: 5 }, // Ramp up to 5 RPS over 20 seconds
        { duration: "30s", target: 10 }, // Ramp up to 10 RPS over 30 seconds
        { duration: "20s", target: 15 }, // Ramp up to 15 RPS over 20 seconds
        { duration: "10s", target: 0 }, // Ramp down to 0 RPS over 10 seconds
      ],
      exec: "rampUpTest", // Function to execute
      tags: { test_type: "ramp" },
    },

    // Stress test (push to the limits)
    stress_test: {
      executor: "ramping-arrival-rate",
      startRate: 5, // Start with 5 requests per second
      timeUnit: "1s", // 1 second
      preAllocatedVUs: 10, // Pre-allocate 10 VUs
      maxVUs: 100, // Maximum 100 VUs
      stages: [
        { duration: "10s", target: 10 }, // Ramp up to 10 RPS over 10 seconds
        { duration: "20s", target: 20 }, // Ramp up to 20 RPS over 20 seconds
        { duration: "10s", target: 30 }, // Ramp up to 30 RPS over 10 seconds
        { duration: "30s", target: 30 }, // Stay at 30 RPS for 30 seconds
        { duration: "10s", target: 0 }, // Ramp down to 0 RPS over 10 seconds
      ],
      exec: "stressTest", // Function to execute
      tags: { test_type: "stress" },
    },

    // Spike test (sudden burst of traffic)
    spike_test: {
      executor: "ramping-arrival-rate",
      startRate: 1, // Start with 1 request per second
      timeUnit: "1s", // 1 second
      preAllocatedVUs: 5, // Pre-allocate 5 VUs
      maxVUs: 100, // Maximum 100 VUs
      stages: [
        { duration: "10s", target: 5 }, // Warm up with 5 RPS over 10 seconds
        { duration: "5s", target: 50 }, // Spike to 50 RPS over 5 seconds
        { duration: "15s", target: 50 }, // Stay at 50 RPS for 15 seconds
        { duration: "5s", target: 5 }, // Drop back to 5 RPS over 5 seconds
        { duration: "15s", target: 5 }, // Stay at 5 RPS for 15 seconds
        { duration: "5s", target: 0 }, // Ramp down to 0 RPS over 5 seconds
      ],
      exec: "spikeTest", // Function to execute
      tags: { test_type: "spike" },
    },
  },

  // Thresholds for pass/fail criteria
  thresholds: {
    http_req_duration: ["p(95)<5000"], // 95% of requests should complete within 5s
    http_req_failed: ["rate<0.1"], // Less than 10% of requests should fail
    errors: ["rate<0.1"], // Error rate should be less than 10%
    success: ["rate>0.9"], // Success rate should be above 90%
  },
};

// Test URLs (mix of simple and complex sites)
const TEST_URLS = [
  "https://viding.co/mini-rsvp/1223551",
  "https://viding.co/mini-rsvp/1223556",
  "https://viding.co/mini-rsvp/1223558",
  "https://viding.co/mini-rsvp/1223562",
];

// Common request parameters
const BASE_URL = "http://localhost:8000";
const HEADERS = { "Content-Type": "application/json" };

// Helper function to create a screenshot request payload
function createPayload(url, width = 1280, height = 720, format = "jpeg") {
  return JSON.stringify({
    url: url,
    width: width,
    height: height,
    format: format,
    cache: false, // Disable caching to ensure we're testing the screenshot service
  });
}

// Helper function to make a screenshot request
function makeScreenshotRequest(url) {
  const payload = createPayload(url);
  const response = http.post(`${BASE_URL}/screenshot`, payload, {
    headers: HEADERS,
  });

  // Check if request was successful
  const success = check(response, {
    "status is 200": (r) => r.status === 200,
    "response has screenshot_url": (r) =>
      r.json("screenshot_url") !== undefined,
  });

  // Record success/failure metrics
  errorRate.add(!success);
  successRate.add(success);

  // Log detailed info for failed requests
  if (!success) {
    console.log(
      `Failed request for ${url}: ${response.status} - ${response.body}`
    );
  }

  return response;
}

// Constant load test function
export function constantLoad() {
  // Select a random URL from the test set
  const url = TEST_URLS[Math.floor(Math.random() * TEST_URLS.length)];
  makeScreenshotRequest(url);
  sleep(1); // 1 second pause between requests
}

// Ramp-up test function
export function rampUpTest() {
  // Select a random URL from the test set
  const url = TEST_URLS[Math.floor(Math.random() * TEST_URLS.length)];
  makeScreenshotRequest(url);
  sleep(0.5); // 0.5 second pause between requests
}

// Stress test function
export function stressTest() {
  // Select a random URL from the test set
  const url = TEST_URLS[Math.floor(Math.random() * TEST_URLS.length)];
  makeScreenshotRequest(url);
  // No sleep - we want to stress the system
}

// Spike test function
export function spikeTest() {
  // Select a random URL from the test set
  const url = TEST_URLS[Math.floor(Math.random() * TEST_URLS.length)];
  makeScreenshotRequest(url);
  // No sleep - we want to create a sudden spike
}

// Optional setup function that runs before the test
export function setup() {
  // Make a single request to warm up the system
  const response = makeScreenshotRequest("https://example.com");
  console.log("Setup complete, system warmed up");
  return { setupCompleted: true };
}

// Optional teardown function that runs after the test
export function teardown(data) {
  console.log("Test completed, teardown complete");
}
