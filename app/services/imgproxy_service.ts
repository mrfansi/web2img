import { createHmac } from 'node:crypto'
import { Exception } from '@adonisjs/core/exceptions'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'
import type { ImgProxyOptions } from '../types/screenshot.js'

/**
 * ImgProxy configuration interface
 */
export interface ImgProxyConfig {
  baseUrl: string
  key: string
  salt: string
}

/**
 * ImgProxy processing options interface
 */
export interface ImgProxyProcessingOptions extends ImgProxyOptions {
  gravity?: 'no' | 'so' | 'ea' | 'we' | 'noea' | 'nowe' | 'soea' | 'sowe' | 'ce'
  enlarge?: boolean
  extend?: boolean
  background?: string
  blur?: number
  sharpen?: number
  pixelate?: number
  unsharp?: boolean
  strip_metadata?: boolean
  strip_color_profile?: boolean
  auto_rotate?: boolean
  filename?: string
}

/**
 * ImgProxy service for generating signed URLs for image processing
 * Provides URL generation with fallback to direct storage URLs
 */
export class ImgProxyService {
  private static instance: ImgProxyService
  private readonly config: ImgProxyConfig | null
  private readonly isConfigured: boolean

  constructor() {
    const baseUrl = env.get('IMGPROXY_BASE_URL')
    const key = env.get('IMGPROXY_KEY')
    const salt = env.get('IMGPROXY_SALT')

    if (baseUrl && key && salt) {
      this.config = { baseUrl, key, salt }
      this.isConfigured = true
      logger.info('ImgProxy service initialized', { baseUrl })
    } else {
      this.config = null
      this.isConfigured = false
      logger.warn('ImgProxy service not configured - missing required environment variables')
    }
  }

  /**
   * Get singleton instance of ImgProxyService
   */
  public static getInstance(): ImgProxyService {
    if (!ImgProxyService.instance) {
      ImgProxyService.instance = new ImgProxyService()
    }
    return ImgProxyService.instance
  }

  /**
   * Check if ImgProxy is properly configured
   */
  public isAvailable(): boolean {
    return this.isConfigured
  }

  /**
   * Validate ImgProxy configuration
   */
  public validateConfig(): boolean {
    if (!this.config) {
      return false
    }

    try {
      // Test URL generation with minimal parameters
      const testUrl = 'https://example.com/test.jpg'
      this.generateUrl(testUrl, { width: 100, height: 100 })
      return true
    } catch (error) {
      logger.error('ImgProxy configuration validation failed', { error })
      return false
    }
  }

  /**
   * Generate signed ImgProxy URL for image processing
   */
  public generateUrl(imageUrl: string, options: ImgProxyProcessingOptions = {}): string {
    if (!this.config) {
      throw new Exception('ImgProxy is not configured', {
        status: 500,
        code: 'IMGPROXY_NOT_CONFIGURED'
      })
    }

    try {
      // Build processing options string
      const processingOptions = this.buildProcessingOptions(options)

      // Encode the source URL
      const encodedUrl = this.encodeUrl(imageUrl)

      // Build the path
      const path = `/${processingOptions}/${encodedUrl}`

      // Generate signature
      const signature = this.generateSignature(path)

      // Build final URL
      const finalUrl = `${this.config.baseUrl}/${signature}${path}`

      logger.debug('Generated ImgProxy URL', {
        originalUrl: imageUrl,
        options,
        finalUrl: finalUrl.substring(0, 100) + '...'
      })

      return finalUrl
    } catch (error) {
      logger.error('Failed to generate ImgProxy URL', { imageUrl, options, error })
      throw new Exception('Failed to generate ImgProxy URL', {
        status: 500,
        code: 'IMGPROXY_URL_GENERATION_FAILED',
        cause: error
      })
    }
  }

  /**
   * Generate ImgProxy URL with fallback to direct URL
   */
  public generateUrlWithFallback(imageUrl: string, options: ImgProxyProcessingOptions = {}): string {
    if (!this.isConfigured) {
      logger.debug('ImgProxy not configured, using direct URL', { imageUrl })
      return imageUrl
    }

    try {
      return this.generateUrl(imageUrl, options)
    } catch (error) {
      logger.warn('ImgProxy URL generation failed, falling back to direct URL', {
        imageUrl,
        error: error.message
      })
      return imageUrl
    }
  }

  /**
   * Generate multiple ImgProxy URLs for different sizes/formats
   */
  public generateMultipleUrls(
    imageUrl: string,
    optionsArray: ImgProxyProcessingOptions[]
  ): { options: ImgProxyProcessingOptions; url: string }[] {
    return optionsArray.map(options => ({
      options,
      url: this.generateUrlWithFallback(imageUrl, options)
    }))
  }

  /**
   * Generate responsive image URLs for different screen sizes
   */
  public generateResponsiveUrls(imageUrl: string, baseOptions: ImgProxyProcessingOptions = {}) {
    const sizes = [
      { width: 320, suffix: 'mobile' },
      { width: 768, suffix: 'tablet' },
      { width: 1024, suffix: 'desktop' },
      { width: 1920, suffix: 'large' }
    ]

    return sizes.map(size => ({
      size: size.suffix,
      width: size.width,
      url: this.generateUrlWithFallback(imageUrl, {
        ...baseOptions,
        width: size.width,
        height: baseOptions.height ? Math.round((baseOptions.height * size.width) / (baseOptions.width || size.width)) : undefined
      })
    }))
  }

  /**
   * Get ImgProxy service health status
   */
  public getHealthStatus(): { healthy: boolean; configured: boolean; message: string } {
    if (!this.isConfigured) {
      return {
        healthy: false,
        configured: false,
        message: 'ImgProxy is not configured'
      }
    }

    const isValid = this.validateConfig()
    return {
      healthy: isValid,
      configured: true,
      message: isValid ? 'ImgProxy is healthy' : 'ImgProxy configuration is invalid'
    }
  }

  /**
   * Build processing options string for ImgProxy URL
   */
  private buildProcessingOptions(options: ImgProxyProcessingOptions): string {
    const parts: string[] = []

    // Resize options
    if (options.width || options.height) {
      const resize = options.resize || 'fit'
      const width = options.width || 0
      const height = options.height || 0
      const enlarge = options.enlarge ? 1 : 0
      const extend = options.extend ? 1 : 0

      parts.push(`rs:${resize}:${width}:${height}:${enlarge}:${extend}`)
    }

    // Quality
    if (options.quality !== undefined) {
      parts.push(`q:${Math.max(1, Math.min(100, options.quality))}`)
    }

    // Format
    if (options.format) {
      parts.push(`f:${options.format}`)
    }

    // Gravity
    if (options.gravity) {
      parts.push(`g:${options.gravity}`)
    }

    // Background color
    if (options.background) {
      const cleanBg = options.background.replace('#', '')
      parts.push(`bg:${cleanBg}`)
    }

    // Blur
    if (options.blur !== undefined) {
      parts.push(`bl:${Math.max(0, options.blur)}`)
    }

    // Sharpen
    if (options.sharpen !== undefined) {
      parts.push(`sh:${Math.max(0, options.sharpen)}`)
    }

    // Pixelate
    if (options.pixelate !== undefined) {
      parts.push(`pix:${Math.max(1, options.pixelate)}`)
    }

    // Unsharp masking
    if (options.unsharp) {
      parts.push('ush:1')
    }

    // Strip metadata
    if (options.strip_metadata) {
      parts.push('sm:1')
    }

    // Strip color profile
    if (options.strip_color_profile) {
      parts.push('scp:1')
    }

    // Auto rotate
    if (options.auto_rotate) {
      parts.push('ar:1')
    }

    // Filename
    if (options.filename) {
      const encodedFilename = Buffer.from(options.filename).toString('base64url')
      parts.push(`fn:${encodedFilename}`)
    }

    return parts.join('/')
  }

  /**
   * Encode URL for ImgProxy processing
   */
  private encodeUrl(url: string): string {
    // ImgProxy expects base64url encoded URLs
    return Buffer.from(url).toString('base64url')
  }

  /**
   * Generate HMAC signature for ImgProxy URL
   */
  private generateSignature(path: string): string {
    if (!this.config) {
      throw new Error('ImgProxy configuration is not available')
    }

    // Convert hex key and salt to binary
    const keyBinary = Buffer.from(this.config.key, 'hex')
    const saltBinary = Buffer.from(this.config.salt, 'hex')

    // Create HMAC with salt + path
    const hmac = createHmac('sha256', keyBinary)
    hmac.update(saltBinary)
    hmac.update(path)

    // Return base64url encoded signature
    return hmac.digest('base64url')
  }
}

// Export singleton instance
export default ImgProxyService.getInstance()