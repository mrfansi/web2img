#!/usr/bin/env node

// Simple browser test script for debugging Docker issues
const { chromium } = require('playwright');

async function testBrowser() {
    console.log('Testing browser initialization...');
    console.log('Environment variables:');
    console.log('- PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH:', process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH);
    console.log('- CHROME_BIN:', process.env.CHROME_BIN);
    console.log('- CHROMIUM_PATH:', process.env.CHROMIUM_PATH);
    console.log('- PLAYWRIGHT_BROWSERS_PATH:', process.env.PLAYWRIGHT_BROWSERS_PATH);
    console.log('- PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:', process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD);

    try {
        const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || 
                             process.env.CHROME_BIN || 
                             process.env.CHROMIUM_PATH ||
                             undefined;

        console.log('Using executable path:', executablePath);

        const browser = await chromium.launch({
            headless: true,
            executablePath,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-extensions',
                '--disable-plugins',
                '--disable-web-security',
                '--allow-running-insecure-content',
                '--disable-features=TranslateUI',
                '--disable-ipc-flooding-protection',
            ],
        });

        console.log('Browser launched successfully!');

        const context = await browser.newContext({
            ignoreHTTPSErrors: true,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        });

        console.log('Context created successfully!');

        const page = await context.newPage();
        console.log('Page created successfully!');

        await page.setViewportSize({ width: 1280, height: 720 });
        console.log('Viewport set successfully!');

        await page.goto('https://example.com', { timeout: 10000 });
        console.log('Page navigation successful!');

        const screenshot = await page.screenshot({ type: 'png' });
        console.log('Screenshot captured successfully! Size:', screenshot.length, 'bytes');

        await browser.close();
        console.log('Browser closed successfully!');

        console.log('✅ All tests passed!');
        process.exit(0);

    } catch (error) {
        console.error('❌ Browser test failed:', error.message);
        console.error('Stack trace:', error.stack);
        process.exit(1);
    }
}

testBrowser();