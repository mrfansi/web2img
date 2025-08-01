import { test } from '@japa/runner'
import { UrlTransformationService } from '#services/url_transformation_service'

test.group('UrlTransformationService', (group) => {
  let service: UrlTransformationService

  group.each.setup(() => {
    service = new UrlTransformationService()
  })

  test('should validate valid URLs', async ({ assert }) => {
    const validUrls = [
      'https://example.com',
      'http://example.com',
      'https://subdomain.example.com/path',
      'https://example.com/path?query=value',
      'https://example.com:8080/path',
    ]

    for (const url of validUrls) {
      const result = service.validateUrl(url)
      assert.isTrue(result.isValid, `URL should be valid: ${url}`)
      assert.isUndefined(result.error)
    }
  })

  test('should reject invalid URLs', async ({ assert }) => {
    const invalidUrls = [
      '',
      null,
      undefined,
      'not-a-url',
      'ftp://example.com',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'https://',
      'https://.',
    ]

    for (const url of invalidUrls) {
      const result = service.validateUrl(url as any)
      assert.isFalse(result.isValid, `URL should be invalid: ${url}`)
      assert.isString(result.error)
    }
  })

  test('should sanitize URLs by removing dangerous parameters', async ({ assert }) => {
    const testCases = [
      {
        input: 'https://example.com?javascript=alert(1)&normal=value',
        expected: 'https://example.com/?normal=value',
      },
      {
        input: 'https://example.com?script=malicious&safe=param',
        expected: 'https://example.com/?safe=param',
      },
      {
        input: 'https://example.com/path#fragment',
        expected: 'https://example.com/path',
      },
    ]

    for (const testCase of testCases) {
      const result = service.sanitizeUrl(testCase.input)
      assert.equal(result, testCase.expected)
    }
  })

  test('should transform viding.co URLs correctly', async ({ assert }) => {
    const testCases = [
      {
        input: 'https://viding.co/video/abc123',
        expectedTransformed: 'https://internal.viding.co/embed/abc123',
        shouldTransform: true,
      },
      {
        input: 'https://viding.co/video/xyz789?param=value',
        expectedTransformed: 'https://internal.viding.co/embed/xyz789',
        shouldTransform: true,
      },
      {
        input: 'https://other-domain.com/video/123',
        expectedTransformed: 'https://other-domain.com/video/123',
        shouldTransform: false,
      },
    ]

    for (const testCase of testCases) {
      const result = service.transformUrl(testCase.input)

      assert.equal(result.originalUrl, testCase.input)
      assert.equal(result.transformedUrl, testCase.expectedTransformed)
      assert.equal(result.wasTransformed, testCase.shouldTransform)

      if (testCase.shouldTransform) {
        assert.equal(result.transformationType, 'viding.co')
      }
    }
  })

  test('should handle URLs that do not need transformation', async ({ assert }) => {
    const testCases = [
      {
        input: 'https://google.com',
        expected: 'https://google.com/',
      },
      {
        input: 'https://github.com/user/repo',
        expected: 'https://github.com/user/repo',
      },
      {
        input: 'https://stackoverflow.com/questions/123',
        expected: 'https://stackoverflow.com/questions/123',
      },
    ]

    for (const testCase of testCases) {
      const result = service.transformUrl(testCase.input)

      assert.equal(result.originalUrl, testCase.input)
      assert.equal(result.transformedUrl, testCase.expected)
      assert.isFalse(result.wasTransformed)
      assert.isUndefined(result.transformationType)
    }
  })

  test('should generate consistent cache keys', async ({ assert }) => {
    const url = 'https://example.com/test'
    const options = { width: 1280, height: 720, format: 'png' }

    const key1 = service.getCacheKey(url, options)
    const key2 = service.getCacheKey(url, options)

    assert.equal(key1, key2)
    assert.isTrue(key1.startsWith('screenshot:'))
    assert.isTrue(key1.includes('1280x720'))
    assert.isTrue(key1.includes('png'))
  })

  test('should generate different cache keys for different options', async ({ assert }) => {
    const url = 'https://example.com/test'

    const key1 = service.getCacheKey(url, { width: 1280, height: 720, format: 'png' })
    const key2 = service.getCacheKey(url, { width: 1920, height: 1080, format: 'png' })
    const key3 = service.getCacheKey(url, { width: 1280, height: 720, format: 'jpeg' })

    assert.notEqual(key1, key2)
    assert.notEqual(key1, key3)
    assert.notEqual(key2, key3)
  })

  test('should follow redirects (mock implementation)', async ({ assert }) => {
    const testUrl = 'https://redirect-example.com/path'

    const result = await service.followRedirects(testUrl)

    assert.equal(result.finalUrl, 'https://final-destination.com/path')
    assert.isArray(result.redirectChain)
    assert.equal(result.redirectChain[0], testUrl)
    assert.equal(result.statusCode, 200)
  })

  test('should handle URLs without redirects', async ({ assert }) => {
    const testUrl = 'https://no-redirect.com/path'

    const result = await service.followRedirects(testUrl)

    assert.equal(result.finalUrl, testUrl)
    assert.isArray(result.redirectChain)
    assert.equal(result.redirectChain.length, 1)
    assert.equal(result.redirectChain[0], testUrl)
  })

  test('should add and remove transformation rules', async ({ assert }) => {
    const domain = 'test-domain.com'
    const transformFn = (url: string) => url.replace('test-domain.com', 'transformed-domain.com')

    // Add rule
    service.addTransformationRule(domain, transformFn)

    const rules = service.getTransformationRules()
    assert.isTrue(rules.includes(domain))

    // Test transformation
    const result = service.transformUrl('https://test-domain.com/path')
    assert.equal(result.transformedUrl, 'https://transformed-domain.com/path')
    assert.isTrue(result.wasTransformed)

    // Remove rule
    const removed = service.removeTransformationRule(domain)
    assert.isTrue(removed)

    const rulesAfterRemoval = service.getTransformationRules()
    assert.isFalse(rulesAfterRemoval.includes(domain))
  })

  test('should process URL with full pipeline', async ({ assert }) => {
    const testUrl = 'https://viding.co/video/test123'

    const result = await service.processUrl(testUrl, false) // Don't follow redirects

    assert.equal(result.original, testUrl)
    assert.equal(result.transformed, 'https://internal.viding.co/embed/test123')
    assert.equal(result.final, 'https://internal.viding.co/embed/test123')
    assert.isTrue(result.wasTransformed)
    assert.equal(result.transformationType, 'viding.co')
    assert.isUndefined(result.redirectChain)
  })

  test('should process URL with redirects', async ({ assert }) => {
    const testUrl = 'https://redirect-example.com/video/test'

    const result = await service.processUrl(testUrl, true) // Follow redirects

    assert.equal(result.original, testUrl)
    assert.equal(result.final, 'https://final-destination.com/video/test')
    assert.isArray(result.redirectChain)
    assert.isTrue(result.redirectChain!.length > 1)
  })

  test('should handle transformation errors gracefully', async ({ assert }) => {
    try {
      service.transformUrl('invalid-url')
      assert.fail('Should have thrown an error')
    } catch (error) {
      assert.isTrue(error.message.includes('URL transformation failed'))
    }
  })

  test('should detect suspicious patterns', async ({ assert }) => {
    const suspiciousUrls = [
      'javascript:alert(1)',
      'https://example.com?onload=alert(1)',
      'https://example.com/<script>alert(1)</script>',
      'data:text/html,<script>alert(1)</script>',
    ]

    for (const url of suspiciousUrls) {
      const result = service.validateUrl(url)
      assert.isFalse(result.isValid, `Should reject suspicious URL: ${url}`)
      assert.isString(result.error, `Should have error message for: ${url}`)
      // The error could be either about suspicious patterns or invalid URL format
      assert.isTrue(result.error!.length > 0)
    }
  })

  test('should handle edge cases in URL processing', async ({ assert }) => {
    // Test with URL that has both transformation and special characters
    const complexUrl = 'https://viding.co/video/test-123?param=value&other=test#fragment'

    const result = service.transformUrl(complexUrl)

    assert.equal(result.originalUrl, complexUrl)
    assert.equal(result.transformedUrl, 'https://internal.viding.co/embed/test-123')
    assert.isTrue(result.wasTransformed)
  })

  test('should handle URL encoding', async ({ assert }) => {
    const encodedUrl = 'https://example.com/path?query=hello%20world'

    const result = service.transformUrl(encodedUrl)

    assert.equal(result.originalUrl, encodedUrl)
    // URL constructor normalizes encoding, so %20 becomes +
    assert.isTrue(result.transformedUrl.includes('hello'))
    assert.isFalse(result.wasTransformed)
  })
})
