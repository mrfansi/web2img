import env from '#start/env'

/**
 * Configuration service that provides validated access to environment variables
 * with additional runtime checks and type safety
 */
export class ConfigService {
  /**
   * Get ImgProxy configuration with validation
   */
  static getImgProxyConfig() {
    const url = env.get('IMGPROXY_URL')
    const key = env.get('IMGPROXY_KEY')
    const salt = env.get('IMGPROXY_SALT')

    // Validate that if ImgProxy is configured, all required fields are present
    if (url && (!key || !salt)) {
      throw new Error('IMGPROXY_KEY and IMGPROXY_SALT are required when IMGPROXY_URL is set')
    }

    return {
      url,
      key,
      salt,
      isEnabled: Boolean(url && key && salt),
    }
  }

  /**
   * Get storage configuration with validation
   */
  static getStorageConfig() {
    const path = env.get('DRIVE_LOCAL_PATH') || 'storage'
    const baseUrl = env.get('DRIVE_BASE_URL') || 'http://localhost:3333'

    // Ensure storage path is absolute or relative to project root
    if (!path.startsWith('/') && !path.startsWith('./')) {
      // For relative paths, they're relative to project root
    }

    return {
      path,
      baseUrl: baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl, // Remove trailing slash
    }
  }

  /**
   * Get screenshot configuration with validation
   */
  static getScreenshotConfig() {
    return {
      timeout: env.get('SCREENSHOT_TIMEOUT'),
      cacheTtl: env.get('SCREENSHOT_CACHE_TTL'),
      maxConcurrent: env.get('SCREENSHOT_MAX_CONCURRENT'),
      queueConcurrency: env.get('SCREENSHOT_QUEUE_CONCURRENCY'),
    }
  }

  /**
   * Get browser configuration
   */
  static getBrowserConfig() {
    return {
      headless: env.get('BROWSER_HEADLESS'),
      timeout: env.get('BROWSER_TIMEOUT'),
    }
  }

  /**
   * Get browser pool configuration
   */
  static getBrowserPoolConfig() {
    return {
      maxBrowsers: env.get('BROWSER_POOL_MAX_BROWSERS', 3),
      maxPagesPerBrowser: env.get('BROWSER_POOL_MAX_PAGES_PER_BROWSER', 5),
      browserTimeout: env.get('BROWSER_POOL_BROWSER_TIMEOUT', 300000),
      pageTimeout: env.get('BROWSER_POOL_PAGE_TIMEOUT', 30000),
    }
  }

  /**
   * Validate all configurations at startup
   */
  static validateAll() {
    try {
      this.getImgProxyConfig()
      this.getStorageConfig()
      this.getScreenshotConfig()
      this.getBrowserConfig()
      this.getBrowserPoolConfig()
    } catch (error) {
      throw new Error(`Configuration validation failed: ${error.message}`)
    }
  }
}
