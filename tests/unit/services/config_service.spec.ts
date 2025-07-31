import { test } from '@japa/runner'
import { ConfigService } from '#services/config_service'
import env from '#start/env'

test.group('ConfigService', () => {
  test('should return browser pool configuration with defaults', async ({ assert }) => {
    const config = ConfigService.getBrowserPoolConfig()

    assert.isObject(config)
    assert.property(config, 'maxBrowsers')
    assert.property(config, 'maxPagesPerBrowser')
    assert.property(config, 'browserTimeout')
    assert.property(config, 'pageTimeout')

    // Should use environment variables or defaults
    assert.equal(config.maxBrowsers, env.get('BROWSER_POOL_MAX_BROWSERS', 3))
    assert.equal(config.maxPagesPerBrowser, env.get('BROWSER_POOL_MAX_PAGES_PER_BROWSER', 5))
    assert.equal(config.browserTimeout, env.get('BROWSER_POOL_BROWSER_TIMEOUT', 300000))
    assert.equal(config.pageTimeout, env.get('BROWSER_POOL_PAGE_TIMEOUT', 30000))
  })

  test('should return browser configuration', async ({ assert }) => {
    const config = ConfigService.getBrowserConfig()

    assert.isObject(config)
    assert.property(config, 'headless')
    assert.property(config, 'timeout')

    assert.equal(config.headless, env.get('BROWSER_HEADLESS'))
    assert.equal(config.timeout, env.get('BROWSER_TIMEOUT'))
  })

  test('should return screenshot configuration', async ({ assert }) => {
    const config = ConfigService.getScreenshotConfig()

    assert.isObject(config)
    assert.property(config, 'timeout')
    assert.property(config, 'cacheTtl')
    assert.property(config, 'maxConcurrent')
    assert.property(config, 'queueConcurrency')

    assert.equal(config.timeout, env.get('SCREENSHOT_TIMEOUT'))
    assert.equal(config.cacheTtl, env.get('SCREENSHOT_CACHE_TTL'))
    assert.equal(config.maxConcurrent, env.get('SCREENSHOT_MAX_CONCURRENT'))
    assert.equal(config.queueConcurrency, env.get('SCREENSHOT_QUEUE_CONCURRENCY'))
  })

  test('should validate all configurations without throwing', async ({ assert }) => {
    // This should not throw an error if all configurations are valid
    assert.doesNotThrow(() => {
      ConfigService.validateAll()
    })
  })

  test('should return storage configuration', async ({ assert }) => {
    const config = ConfigService.getStorageConfig()

    assert.isObject(config)
    assert.property(config, 'disk')
    assert.property(config, 'localPath')
    assert.property(config, 'baseUrl')
  })

  test('should return imgproxy configuration', async ({ assert }) => {
    const config = ConfigService.getImgProxyConfig()

    assert.isObject(config)
    assert.property(config, 'baseUrl')
    assert.property(config, 'key')
    assert.property(config, 'salt')
  })
})
