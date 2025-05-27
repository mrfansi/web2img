import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Counter, Trend } from "k6/metrics";

// Custom metrics for detailed analysis
const errorRate = new Rate("errors");
const successRate = new Rate("success");
const throttledCounter = new Counter("throttled_requests");
const serverErrorCounter = new Counter("server_errors");
const clientErrorCounter = new Counter("client_errors");
const timeoutCounter = new Counter("timeouts");
const successCounter = new Counter("successful_requests");
const failureCounter = new Counter("failed_requests");
const responseTimeTrend = new Trend("response_time");
const successResponseTimeTrend = new Trend("success_response_time");

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

// Base URL patterns for generating random test URLs
const URL_PATTERNS = [
  { base: "https://viding.co/mini-rsvp/", idRange: [1195000, 1196000] },
];

// Function to generate a random integer between min and max (inclusive)
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Function to generate a random URL from the patterns
function generateRandomUrl() {
  // Select a random pattern
  const pattern = URL_PATTERNS[Math.floor(Math.random() * URL_PATTERNS.length)];
  
  // Generate a random ID within the specified range
  const randomId = getRandomInt(pattern.idRange[0], pattern.idRange[1]);
  
  // Combine the base URL with the random ID
  return `${pattern.base}${randomId}`;
}

// Common request parameters
const BASE_URL = "http://localhost:8000";
const HEADERS = { "Content-Type": "application/json" };

// Helper function to make a screenshot request with retry logic
function makeScreenshotRequest(url) {
  const maxRetries = 2;
  let retries = 0;
  let lastError = null;
  let startTime = new Date().getTime();
  
  // Add jitter to prevent thundering herd problem
  const jitter = Math.random() * 500; // 0-500ms jitter
  if (jitter > 0) {
    sleep(jitter / 1000); // k6 sleep takes seconds
  }
  
  while (retries <= maxRetries) {
    try {
      // Adaptive timeout based on system load
      // Start with a reasonable timeout and increase it with each retry
      const baseTimeout = 60000; // 60 seconds
      const timeout = baseTimeout * (1 + (retries * 0.5)); // Increase by 50% each retry
      
      const res = http.post(`${BASE_URL}/api/v1/screenshot`, {
        url: url,
        width: 1280,
        height: 800,
        format: "png"
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: timeout
      });
      
      // Track response time metrics
      const responseTime = new Date().getTime() - startTime;
      responseTimeTrend.add(responseTime);
      
      // Track success/failure metrics
      if (res.status === 200) {
        successCounter.add(1);
        // Track response time by result
        successResponseTimeTrend.add(responseTime);
        return res;
      } else if (res.status === 429 || res.status >= 500) {
        // For throttling (429) or server errors (5xx), we'll retry
        failureCounter.add(1);
        retries++;
        lastError = res;
        
        if (res.status === 429) {
          throttledCounter.add(1);
        } else {
          serverErrorCounter.add(1);
        }
        
        // Add backoff between retries
        if (retries <= maxRetries) {
          const backoff = (Math.pow(2, retries) * 1000) + (Math.random() * 1000);
          console.log(`Request throttled/failed for ${url} with status ${res.status}. Retrying in ${backoff}ms...`);
          sleep(backoff / 1000); // k6 sleep takes seconds
        }
      } else {
        // For other errors, don't retry
        failureCounter.add(1);
        clientErrorCounter.add(1);
        console.log(`Request failed for ${url} with status ${res.status}`);
        return res;
      }
    } catch (error) {
      // For exceptions (like timeouts), we'll retry
      failureCounter.add(1);
      timeoutCounter.add(1);
      retries++;
      lastError = error;
      
      // Add backoff between retries
      if (retries <= maxRetries) {
        const backoff = (Math.pow(2, retries) * 1000) + (Math.random() * 1000);
        console.log(`Request exception for ${url}: ${error}. Retrying in ${backoff}ms...`);
        sleep(backoff / 1000); // k6 sleep takes seconds
      }
    }
  }
  
  // If we've exhausted all retries, return the last error
  console.log(`All retries exhausted for ${url}`);
  return lastError;
}

// Test functions that will be executed by k6
// Constant load test function
export function constantLoad() {
  // Generate a random URL for each request
  const url = generateRandomUrl();
  // Make a request with the random URL
  makeScreenshotRequest(url);
  sleep(1); // 1 second pause between requests
}

// Ramp-up test function
export function rampUpTest() {
  // Generate a random URL for each request
  const url = generateRandomUrl();
  // Make a request with the random URL
  makeScreenshotRequest(url);
  sleep(0.5); // 0.5 second pause between requests
}

// Stress test function
export function stressTest() {
  // Generate a random URL for each request
  const url = generateRandomUrl();
  // Make a request with the random URL
  makeScreenshotRequest(url);
  // No sleep - we want to stress the system
}

// Spike test function
export function spikeTest() {
  // Generate a random URL for each request
  const url = generateRandomUrl();
  // Make a request with the random URL
  makeScreenshotRequest(url);
  // No sleep - we want to create a sudden spike
}

// Optional setup function that runs before the test
export function setup() {
  // Make a single request to warm up the system
  const url = generateRandomUrl();
  const response = makeScreenshotRequest(url);
  console.log("Setup complete, system warmed up");
  return { setupCompleted: true };
}

// Optional teardown function that runs after the test
export function teardown(data) {
  console.log("Test completed, teardown complete");
}
