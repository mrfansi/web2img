import { test } from '@japa/runner'
import { ImgProxyService } from '#services/imgproxy_service'

test.group('ImgProxyService', (group) => {
  let imgProxyService: ImgProxyService

  group.setup(() => {
    // Create new instance for testing with mock config
    imgProxyService = new (ImgProxyService as any)()
    imgProxyService.config = {
      baseUrl: 'https://imgproxy.example.com',
      key: '943b421c9eb07c830af81030552c86009268de4e532ba2ee2eab8247c6da0881',
      salt: '520f986b998545b4785e0defbc4f3c1203f22de2374a3d53cb7a7fe9fea309c5'
    }
    imgProxyService.isConfigured = true
  })

  test('should initialize with proper configuration', async ({ assert }) => {
    assert.isTrue(imgProxyService.isAvailable())
    assert.isTrue(imgProxyService.validateConfig())
  })

  test('should handle missing configuration gracefully', async ({ assert }) => {
    // Create service without configuration by creating a mock service
    const unconfiguredService = new (ImgProxyService as any)()
    unconfiguredService.config = null
    unconfiguredService.isConfigured = false
    
    assert.isFalse(unconfiguredService.isAvailable())
    assert.isFalse(unconfiguredService.validateConfig())
  })

  test('should generate basic ImgProxy URL', async ({ assert }) => {
    const imageUrl = 'https://example.com/image.jpg'
    const options = { width: 300, height: 200 }
    
    const result = imgProxyService.generateUrl(imageUrl, options)
    
    assert.isString(result)
    assert.isTrue(result.startsWith('https://imgproxy.example.com/'))
    assert.isTrue(result.includes('/rs:fit:300:200:0:0/'))
  })

  test('should generate URL with quality option', async ({ assert }) => {
    const imageUrl = 'https://example.com/image.jpg'
    const options = { width: 300, height: 200, quality: 80 }
    
    const result = imgProxyService.generateUrl(imageUrl, options)
    
    assert.isString(result)
    assert.isTrue(result.includes('/q:80/'))
  })

  test('should generate URL with format option', async ({ assert }) => {
    const imageUrl = 'https://example.com/image.jpg'
    const options = { width: 300, height: 200, format: 'webp' }
    
    const result = imgProxyService.generateUrl(imageUrl, options)
    
    assert.isString(result)
    assert.isTrue(result.includes('/f:webp/'))
  })

  test('should generate URL with resize options', async ({ assert }) => {
    const imageUrl = 'https://example.com/image.jpg'
    const options = { 
      width: 300, 
      height: 200, 
      resize: 'fill' as const,
      enlarge: true,
      extend: true
    }
    
    const result = imgProxyService.generateUrl(imageUrl, options)
    
    assert.isString(result)
    assert.isTrue(result.includes('/rs:fill:300:200:1:1/'))
  })

  test('should generate URL with gravity option', async ({ assert }) => {
    const imageUrl = 'https://example.com/image.jpg'
    const options = { width: 300, height: 200, gravity: 'ce' as const }
    
    const result = imgProxyService.generateUrl(imageUrl, options)
    
    assert.isString(result)
    assert.isTrue(result.includes('/g:ce/'))
  })

  test('should generate URL with background color', async ({ assert }) => {
    const imageUrl = 'https://example.com/image.jpg'
    const options = { width: 300, height: 200, background: '#ffffff' }
    
    const result = imgProxyService.generateUrl(imageUrl, options)
    
    assert.isString(result)
    assert.isTrue(result.includes('/bg:ffffff/'))
  })

  test('should generate URL with blur option', async ({ assert }) => {
    const imageUrl = 'https://example.com/image.jpg'
    const options = { width: 300, height: 200, blur: 5 }
    
    const result = imgProxyService.generateUrl(imageUrl, options)
    
    assert.isString(result)
    assert.isTrue(result.includes('/bl:5/'))
  })

  test('should generate URL with sharpen option', async ({ assert }) => {
    const imageUrl = 'https://example.com/image.jpg'
    const options = { width: 300, height: 200, sharpen: 3 }
    
    const result = imgProxyService.generateUrl(imageUrl, options)
    
    assert.isString(result)
    assert.isTrue(result.includes('/sh:3/'))
  })

  test('should generate URL with pixelate option', async ({ assert }) => {
    const imageUrl = 'https://example.com/image.jpg'
    const options = { width: 300, height: 200, pixelate: 10 }
    
    const result = imgProxyService.generateUrl(imageUrl, options)
    
    assert.isString(result)
    assert.isTrue(result.includes('/pix:10/'))
  })

  test('should generate URL with metadata stripping options', async ({ assert }) => {
    const imageUrl = 'https://example.com/image.jpg'
    const options = { 
      width: 300, 
      height: 200, 
      strip_metadata: true,
      strip_color_profile: true,
      auto_rotate: true
    }
    
    const result = imgProxyService.generateUrl(imageUrl, options)
    
    assert.isString(result)
    assert.isTrue(result.includes('/sm:1/'))
    assert.isTrue(result.includes('/scp:1/'))
    assert.isTrue(result.includes('/ar:1/'))
  })

  test('should generate URL with filename option', async ({ assert }) => {
    const imageUrl = 'https://example.com/image.jpg'
    const options = { width: 300, height: 200, filename: 'processed-image.jpg' }
    
    const result = imgProxyService.generateUrl(imageUrl, options)
    
    assert.isString(result)
    // Filename should be base64url encoded
    const encodedFilename = Buffer.from('processed-image.jpg').toString('base64url')
    assert.isTrue(result.includes(`/fn:${encodedFilename}/`))
  })

  test('should generate URL with unsharp masking', async ({ assert }) => {
    const imageUrl = 'https://example.com/image.jpg'
    const options = { width: 300, height: 200, unsharp: true }
    
    const result = imgProxyService.generateUrl(imageUrl, options)
    
    assert.isString(result)
    assert.isTrue(result.includes('/ush:1/'))
  })

  test('should generate URL with fallback when not configured', async ({ assert }) => {
    // Create unconfigured service
    const unconfiguredService = new (ImgProxyService as any)()
    unconfiguredService.config = null
    unconfiguredService.isConfigured = false
    
    const imageUrl = 'https://example.com/image.jpg'
    const options = { width: 300, height: 200 }
    
    const result = unconfiguredService.generateUrlWithFallback(imageUrl, options)
    
    assert.equal(result, imageUrl)
  })

  test('should generate URL with fallback on error', async ({ assert }) => {
    // Mock a service that will fail URL generation
    const mockService = new (ImgProxyService as any)()
    mockService.config = null // Force failure
    
    const imageUrl = 'https://example.com/image.jpg'
    const options = { width: 300, height: 200 }
    
    const result = mockService.generateUrlWithFallback(imageUrl, options)
    
    assert.equal(result, imageUrl)
  })

  test('should generate multiple URLs for different options', async ({ assert }) => {
    const imageUrl = 'https://example.com/image.jpg'
    const optionsArray = [
      { width: 100, height: 100 },
      { width: 200, height: 200, format: 'webp' },
      { width: 300, height: 300, quality: 80 }
    ]
    
    const results = imgProxyService.generateMultipleUrls(imageUrl, optionsArray)
    
    assert.lengthOf(results, 3)
    assert.isString(results[0].url)
    assert.isString(results[1].url)
    assert.isString(results[2].url)
    assert.deepEqual(results[0].options, optionsArray[0])
    assert.deepEqual(results[1].options, optionsArray[1])
    assert.deepEqual(results[2].options, optionsArray[2])
  })

  test('should generate responsive URLs', async ({ assert }) => {
    const imageUrl = 'https://example.com/image.jpg'
    const baseOptions = { height: 200, quality: 80 }
    
    const results = imgProxyService.generateResponsiveUrls(imageUrl, baseOptions)
    
    assert.lengthOf(results, 4)
    assert.equal(results[0].size, 'mobile')
    assert.equal(results[0].width, 320)
    assert.equal(results[1].size, 'tablet')
    assert.equal(results[1].width, 768)
    assert.equal(results[2].size, 'desktop')
    assert.equal(results[2].width, 1024)
    assert.equal(results[3].size, 'large')
    assert.equal(results[3].width, 1920)
    
    results.forEach(result => {
      assert.isString(result.url)
    })
  })

  test('should validate quality bounds', async ({ assert }) => {
    const imageUrl = 'https://example.com/image.jpg'
    
    // Test minimum quality
    const minQualityResult = imgProxyService.generateUrl(imageUrl, { width: 300, quality: -10 })
    assert.isTrue(minQualityResult.includes('/q:1/'))
    
    // Test maximum quality
    const maxQualityResult = imgProxyService.generateUrl(imageUrl, { width: 300, quality: 150 })
    assert.isTrue(maxQualityResult.includes('/q:100/'))
  })

  test('should validate blur bounds', async ({ assert }) => {
    const imageUrl = 'https://example.com/image.jpg'
    
    // Test minimum blur
    const minBlurResult = imgProxyService.generateUrl(imageUrl, { width: 300, blur: -5 })
    assert.isTrue(minBlurResult.includes('/bl:0/'))
  })

  test('should validate pixelate bounds', async ({ assert }) => {
    const imageUrl = 'https://example.com/image.jpg'
    
    // Test minimum pixelate
    const minPixelateResult = imgProxyService.generateUrl(imageUrl, { width: 300, pixelate: 0 })
    assert.isTrue(minPixelateResult.includes('/pix:1/'))
  })

  test('should get health status when configured', async ({ assert }) => {
    const health = imgProxyService.getHealthStatus()
    
    assert.isTrue(health.healthy)
    assert.isTrue(health.configured)
    assert.equal(health.message, 'ImgProxy is healthy')
  })

  test('should get health status when not configured', async ({ assert }) => {
    // Create unconfigured service
    const unconfiguredService = new (ImgProxyService as any)()
    unconfiguredService.config = null
    unconfiguredService.isConfigured = false
    
    const health = unconfiguredService.getHealthStatus()
    
    assert.isFalse(health.healthy)
    assert.isFalse(health.configured)
    assert.equal(health.message, 'ImgProxy is not configured')
  })

  test('should throw error when generating URL without configuration', async ({ assert }) => {
    // Create unconfigured service
    const unconfiguredService = new (ImgProxyService as any)()
    unconfiguredService.config = null
    unconfiguredService.isConfigured = false
    
    const imageUrl = 'https://example.com/image.jpg'
    const options = { width: 300, height: 200 }
    
    await assert.rejects(
      () => unconfiguredService.generateUrl(imageUrl, options),
      'ImgProxy is not configured'
    )
  })

  test('should handle complex URL with all options', async ({ assert }) => {
    const imageUrl = 'https://example.com/path/to/image.jpg?param=value'
    const options = {
      width: 800,
      height: 600,
      resize: 'crop' as const,
      quality: 85,
      format: 'webp',
      gravity: 'ce' as const,
      enlarge: true,
      extend: false,
      background: '#f0f0f0',
      blur: 2,
      sharpen: 1,
      strip_metadata: true,
      auto_rotate: true,
      filename: 'optimized-image.webp'
    }
    
    const result = imgProxyService.generateUrl(imageUrl, options)
    
    assert.isString(result)
    assert.isTrue(result.startsWith('https://imgproxy.example.com/'))
    assert.isTrue(result.includes('/rs:crop:800:600:1:0/'))
    assert.isTrue(result.includes('/q:85/'))
    assert.isTrue(result.includes('/f:webp/'))
    assert.isTrue(result.includes('/g:ce/'))
    assert.isTrue(result.includes('/bg:f0f0f0/'))
    assert.isTrue(result.includes('/bl:2/'))
    assert.isTrue(result.includes('/sh:1/'))
    assert.isTrue(result.includes('/sm:1/'))
    assert.isTrue(result.includes('/ar:1/'))
    
    const encodedFilename = Buffer.from('optimized-image.webp').toString('base64url')
    assert.isTrue(result.includes(`/fn:${encodedFilename}/`))
  })
})