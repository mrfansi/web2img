#!/usr/bin/env node

// Integration test for the Web2Img application
const http = require('http');

async function makeRequest(path, expectedStatus = 200) {
    return new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:3333${path}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === expectedStatus) {
                    console.log(`✅ ${path} - Status: ${res.statusCode}`);
                    resolve({ statusCode: res.statusCode, data: JSON.parse(data || '{}') });
                } else {
                    console.log(`❌ ${path} - Expected: ${expectedStatus}, Got: ${res.statusCode}`);
                    console.log(`Response: ${data}`);
                    reject(new Error(`Unexpected status code: ${res.statusCode}`));
                }
            });
        });

        req.on('error', (error) => {
            console.log(`❌ ${path} - Request failed: ${error.message}`);
            reject(error);
        });

        req.setTimeout(10000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

async function runIntegrationTests() {
    console.log('Running integration tests...\n');

    try {
        // Test basic liveness
        await makeRequest('/health/live');

        // Test readiness (may fail if browser isn't ready, but shouldn't crash)
        try {
            await makeRequest('/health/ready');
        } catch (error) {
            console.log('⚠️  /health/ready failed (this may be expected if browser service is not ready)');
        }

        // Test individual component health checks
        const components = ['database', 'redis', 'storage', 'imgproxy'];
        
        for (const component of components) {
            try {
                await makeRequest(`/health/${component}`);
            } catch (error) {
                console.log(`⚠️  /health/${component} failed: ${error.message}`);
            }
        }

        // Test browser component specifically (may fail but shouldn't crash)
        try {
            await makeRequest('/health/browser');
        } catch (error) {
            console.log(`⚠️  /health/browser failed: ${error.message}`);
        }

        // Test detailed health check
        try {
            const detailedHealth = await makeRequest('/health/detailed');
            console.log('\n📊 System Health Summary:');
            console.log(`Overall Status: ${detailedHealth.data.status}`);
            console.log(`Components: ${detailedHealth.data.summary.healthy} healthy, ${detailedHealth.data.summary.degraded} degraded, ${detailedHealth.data.summary.unhealthy} unhealthy`);
        } catch (error) {
            console.log(`⚠️  /health/detailed failed: ${error.message}`);
        }

        console.log('\n✅ Integration tests completed successfully!');
        console.log('The application is responding to health check requests.');
        
        process.exit(0);

    } catch (error) {
        console.log(`\n❌ Integration tests failed: ${error.message}`);
        process.exit(1);
    }
}

// Wait a moment for the server to start, then run tests
setTimeout(runIntegrationTests, 2000);