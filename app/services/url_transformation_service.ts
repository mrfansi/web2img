import logger from '@adonisjs/core/services/logger'

export interface UrlTransformationResult {
  originalUrl: string
  transformedUrl: string
  wasTransformed: boolean
  transformationType?: string
}

export interface RedirectResult {
  finalUrl: string
  redirectChain: string[]
  statusCode: number
}

export class UrlTransformationService {
  private readonly transformationRules: Map<string, (url: string) => string> = new Map()

  constructor() {
    this.initializeTransformationRules()
  }

  /**
   * Initialize URL transformation rules for special domains
   */
  private initializeTransformationRules(): void {
    // viding.co transformation rule
    this.transformationRules.set('viding.co', (url: string) => {
      // Transform viding.co URLs to internal format
      // Example: https://viding.co/video/123 -> https://internal.viding.co/embed/123
      const vidingMatch = url.match(/https?:\/\/viding\.co\/video\/([^\/\?]+)/)
      if (vidingMatch) {
        return `https://internal.viding.co/embed/${vidingMatch[1]}`
      }
      return url
    })

    // Add more transformation rules as needed
    this.transformationRules.set('example-domain.com', (url: string) => {
      // Example transformation rule
      return url.replace('example-domain.com', 'internal-example.com')
    })
  }

  /**
   * Validate URL format and basic structure
   */
  validateUrl(url: string): { isValid: boolean; error?: string } {
    try {
      // Basic URL format validation
      if (!url || typeof url !== 'string') {
        return { isValid: false, error: 'URL must be a non-empty string' }
      }

      // Remove leading/trailing whitespace
      url = url.trim()

      // Check for basic URL structure
      if (!url.match(/^https?:\/\/.+/)) {
        return { isValid: false, error: 'URL must start with http:// or https://' }
      }

      // Try to parse URL
      const parsedUrl = new URL(url)

      // Check for valid hostname
      if (!parsedUrl.hostname || parsedUrl.hostname.length === 0 || parsedUrl.hostname === '.') {
        return { isValid: false, error: 'URL must have a valid hostname' }
      }

      // Check for suspicious patterns
      if (this.containsSuspiciousPatterns(url)) {
        return { isValid: false, error: 'URL contains suspicious patterns' }
      }

      return { isValid: true }
    } catch (error) {
      return { isValid: false, error: `Invalid URL format: ${error.message}` }
    }
  }

  /**
   * Sanitize URL by removing dangerous parameters and normalizing
   */
  sanitizeUrl(url: string): string {
    try {
      const parsedUrl = new URL(url)

      // Remove potentially dangerous query parameters
      const dangerousParams = ['javascript', 'script', 'eval', 'onload', 'onerror']
      dangerousParams.forEach(param => {
        parsedUrl.searchParams.delete(param)
      })

      // Normalize the URL
      let sanitized = parsedUrl.toString()

      // Remove fragments for consistency
      sanitized = sanitized.split('#')[0]

      return sanitized
    } catch (error) {
      logger.error('Failed to sanitize URL', { url, error })
      return url // Return original if sanitization fails
    }
  }

  /**
   * Check for suspicious patterns in URL
   */
  private containsSuspiciousPatterns(url: string): boolean {
    const suspiciousPatterns = [
      /^javascript:/i,
      /^data:/i,
      /^vbscript:/i,
      /^file:/i,
      /^ftp:/i,
      /<script/i,
      /[?&]onload=/i,
      /[?&]onerror=/i,
      /eval\(/i,
    ]

    return suspiciousPatterns.some(pattern => pattern.test(url))
  }

  /**
   * Transform URL based on domain-specific rules
   */
  transformUrl(url: string): UrlTransformationResult {
    try {
      const originalUrl = url
      let transformedUrl = url
      let wasTransformed = false
      let transformationType: string | undefined

      // First validate and sanitize the URL
      const validation = this.validateUrl(url)
      if (!validation.isValid) {
        throw new Error(validation.error)
      }

      transformedUrl = this.sanitizeUrl(url)

      // Parse URL to get hostname
      const parsedUrl = new URL(transformedUrl)
      const hostname = parsedUrl.hostname

      // Apply transformation rules based on hostname
      for (const [domain, transformFn] of this.transformationRules) {
        if (hostname.includes(domain)) {
          const beforeTransform = transformedUrl
          transformedUrl = transformFn(transformedUrl)
          
          if (beforeTransform !== transformedUrl) {
            wasTransformed = true
            transformationType = domain
            break
          }
        }
      }

      logger.debug('URL transformation completed', {
        originalUrl,
        transformedUrl,
        wasTransformed,
        transformationType,
      })

      return {
        originalUrl,
        transformedUrl,
        wasTransformed,
        transformationType,
      }
    } catch (error) {
      logger.error('URL transformation failed', { url, error })
      throw new Error(`URL transformation failed: ${error.message}`)
    }
  }

  /**
   * Follow redirects and get final URL (mock implementation for testing)
   * In a real implementation, this would use HTTP requests to follow redirects
   */
  async followRedirects(url: string, maxRedirects: number = 5): Promise<RedirectResult> {
    try {
      // This is a mock implementation for testing purposes
      // In a real implementation, you would use HTTP client to follow redirects
      const redirectChain: string[] = [url]
      let currentUrl = url
      let redirectCount = 0

      // Mock some common redirect patterns for testing
      while (redirectCount < maxRedirects) {
        // Mock redirect logic - in real implementation, make HTTP request here
        if (currentUrl.includes('redirect-example.com')) {
          currentUrl = currentUrl.replace('redirect-example.com', 'final-destination.com')
          redirectChain.push(currentUrl)
          redirectCount++
        } else {
          break
        }
      }

      logger.debug('Redirect following completed', {
        originalUrl: url,
        finalUrl: currentUrl,
        redirectChain,
        redirectCount,
      })

      return {
        finalUrl: currentUrl,
        redirectChain,
        statusCode: 200, // Mock status code
      }
    } catch (error) {
      logger.error('Failed to follow redirects', { url, error })
      throw new Error(`Failed to follow redirects: ${error.message}`)
    }
  }

  /**
   * Get the cache key for a URL (uses original URL for consistency)
   */
  getCacheKey(originalUrl: string, options: { width: number; height: number; format: string }): string {
    // Use original URL for cache key to ensure consistency
    const baseKey = Buffer.from(originalUrl).toString('base64').replace(/[+/=]/g, '')
    return `screenshot:${baseKey}:${options.width}x${options.height}:${options.format}`
  }

  /**
   * Add a new transformation rule
   */
  addTransformationRule(domain: string, transformFn: (url: string) => string): void {
    this.transformationRules.set(domain, transformFn)
    logger.info('Added URL transformation rule', { domain })
  }

  /**
   * Remove a transformation rule
   */
  removeTransformationRule(domain: string): boolean {
    const removed = this.transformationRules.delete(domain)
    if (removed) {
      logger.info('Removed URL transformation rule', { domain })
    }
    return removed
  }

  /**
   * Get all available transformation rules
   */
  getTransformationRules(): string[] {
    return Array.from(this.transformationRules.keys())
  }

  /**
   * Process URL with full transformation pipeline
   */
  async processUrl(url: string, followRedirects: boolean = true): Promise<{
    original: string
    transformed: string
    final: string
    wasTransformed: boolean
    transformationType?: string
    redirectChain?: string[]
  }> {
    try {
      // Step 1: Transform URL
      const transformResult = this.transformUrl(url)

      // Step 2: Follow redirects if requested
      let finalUrl = transformResult.transformedUrl
      let redirectChain: string[] | undefined

      if (followRedirects) {
        const redirectResult = await this.followRedirects(transformResult.transformedUrl)
        finalUrl = redirectResult.finalUrl
        redirectChain = redirectResult.redirectChain
      }

      return {
        original: transformResult.originalUrl,
        transformed: transformResult.transformedUrl,
        final: finalUrl,
        wasTransformed: transformResult.wasTransformed,
        transformationType: transformResult.transformationType,
        redirectChain,
      }
    } catch (error) {
      logger.error('URL processing failed', { url, error })
      throw error
    }
  }
}

// Create singleton instance
export const urlTransformationService = new UrlTransformationService()