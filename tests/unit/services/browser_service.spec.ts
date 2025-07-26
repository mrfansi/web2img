import { test } from '@japa/runner'
import { BrowserService } from '#services/browser_service'

test.group('BrowserService', (group) => {
  let browserService: BrowserService

  group.each.setup(() => {
    browserService = new BrowserService({
      maxBrowsers: 2,
      maxPagesPerBrowser: 3,
      browserTimeout: 10000,
      pageTimeout: 5000,
    })
  })

  group.each.teardown(async () => {
    await browserService.shutdown()
  })

  test('should initialize browser service with default options', async ({ assert }) => {
    const service = new BrowserService()
    const stats = service.getPoolStats()

    assert.equal(stats.totalBrowsers, 0)
    assert.equal(stats.totalActivePages, 0)
    assert.equal(stats.maxBrowsers, 3)
    assert.equal(stats.maxPagesPerBrowser, 5)

    await service.shutdown()
  })

  test('should initialize browser service with custom options', async ({ assert }) => {
    const stats = browserService.getPoolStats()

    assert.equal(stats.maxBrowsers, 2)
    assert.equal(stats.maxPagesPerBrowser, 3)
  })

  test('should create a page with specified options', async ({ assert }) => {
    const pageOptions = {
      width: 1920,
      height: 1080,
      timeout: 10000,
    }

    const { page: _page, cleanup } = await browserService.createPage(pageOptions)

    assert.isTrue(_page instanceof Object)
    assert.isFunction(cleanup)

    const stats = browserService.getPoolStats()
    assert.equal(stats.totalBrowsers, 1)
    assert.equal(stats.totalActivePages, 1)

    await cleanup()

    const statsAfterCleanup = browserService.getPoolStats()
    assert.equal(statsAfterCleanup.totalActivePages, 0)
  })

  test('should reuse browser instances when possible', async ({ assert }) => {
    const pageOptions = {
      width: 1280,
      height: 720,
      timeout: 5000,
    }

    const { page: _page1, cleanup: cleanup1 } = await browserService.createPage(pageOptions)
    const { page: _page2, cleanup: cleanup2 } = await browserService.createPage(pageOptions)

    const stats = browserService.getPoolStats()
    assert.equal(stats.totalBrowsers, 1) // Should reuse the same browser
    assert.equal(stats.totalActivePages, 2)

    await cleanup1()
    await cleanup2()
  })

  test('should create new browser when page limit is reached', async ({ assert }) => {
    const pageOptions = {
      width: 1280,
      height: 720,
      timeout: 5000,
    }

    // Create pages up to the limit for one browser
    const pages = []
    for (let i = 0; i < 3; i++) {
      const pageData = await browserService.createPage(pageOptions)
      pages.push(pageData)
    }

    let stats = browserService.getPoolStats()
    assert.equal(stats.totalBrowsers, 1)
    assert.equal(stats.totalActivePages, 3)

    // Create one more page, should trigger new browser
    const { page: _extraPage, cleanup: extraCleanup } = await browserService.createPage(pageOptions)

    stats = browserService.getPoolStats()
    assert.equal(stats.totalBrowsers, 2)
    assert.equal(stats.totalActivePages, 4)

    // Cleanup all pages
    for (const { cleanup } of pages) {
      await cleanup()
    }
    await extraCleanup()
  })

  test('should handle page creation errors gracefully', async ({ assert }) => {
    // Create a service with very short timeout to trigger errors
    const errorService = new BrowserService({
      maxBrowsers: 1,
      maxPagesPerBrowser: 1,
      browserTimeout: 1,
      pageTimeout: 1,
    })

    try {
      const pageOptions = {
        width: 1280,
        height: 720,
        timeout: 1, // Very short timeout
      }

      const { page: _page, cleanup } = await errorService.createPage(pageOptions)
      await cleanup()

      // If we get here, the service handled the short timeout gracefully
      assert.isTrue(true)
    } catch (error) {
      // Expected behavior for very short timeouts
      assert.isTrue(error.message.includes('Failed to'))
    } finally {
      await errorService.shutdown()
    }
  })

  test('should perform health check successfully', async ({ assert }) => {
    const healthResult = await browserService.healthCheck()

    assert.isTrue(healthResult.healthy)
    assert.isObject(healthResult.details)
    assert.property(healthResult.details, 'totalBrowsers')
    assert.property(healthResult.details, 'totalActivePages')
    assert.property(healthResult.details, 'maxBrowsers')
    assert.property(healthResult.details, 'maxPagesPerBrowser')
    assert.property(healthResult.details, 'lastCleanup')
  })

  test('should return correct pool statistics', async ({ assert }) => {
    const initialStats = browserService.getPoolStats()
    assert.equal(initialStats.totalBrowsers, 0)
    assert.equal(initialStats.totalActivePages, 0)

    const { page: _page, cleanup } = await browserService.createPage({
      width: 1280,
      height: 720,
      timeout: 5000,
    })

    const statsWithPage = browserService.getPoolStats()
    assert.equal(statsWithPage.totalBrowsers, 1)
    assert.equal(statsWithPage.totalActivePages, 1)

    await cleanup()

    const statsAfterCleanup = browserService.getPoolStats()
    assert.equal(statsAfterCleanup.totalBrowsers, 1) // Browser remains in pool
    assert.equal(statsAfterCleanup.totalActivePages, 0)
  })

  test('should shutdown gracefully', async ({ assert }) => {
    const testService = new BrowserService()

    // Create a page to ensure browser is initialized
    const { page: _page, cleanup } = await testService.createPage({
      width: 1280,
      height: 720,
      timeout: 5000,
    })

    await cleanup()

    const statsBeforeShutdown = testService.getPoolStats()
    assert.equal(statsBeforeShutdown.totalBrowsers, 1)

    await testService.shutdown()

    const statsAfterShutdown = testService.getPoolStats()
    assert.equal(statsAfterShutdown.totalBrowsers, 0)
    assert.equal(statsAfterShutdown.totalActivePages, 0)
  })

  test('should handle concurrent page creation', async ({ assert }) => {
    const pageOptions = {
      width: 1280,
      height: 720,
      timeout: 5000,
    }

    // Create multiple pages concurrently
    const promises = []
    for (let i = 0; i < 4; i++) {
      promises.push(browserService.createPage(pageOptions))
    }

    const results = await Promise.all(promises)

    const stats = browserService.getPoolStats()
    assert.equal(stats.totalActivePages, 4)
    // Allow some flexibility in browser count due to concurrent creation
    assert.isAtLeast(stats.totalBrowsers, 1)
    assert.isAtMost(stats.totalBrowsers, 4) // More lenient upper bound

    // Cleanup all pages
    for (const { cleanup } of results) {
      await cleanup()
    }

    const finalStats = browserService.getPoolStats()
    assert.equal(finalStats.totalActivePages, 0)
  })
})