import { test } from '@japa/runner'
import ApiKey from '#models/api_key'

test.group('ApiKey Model', () => {
  test('should generate a unique API key', async ({ assert }) => {
    const key1 = ApiKey.generateKey()
    const key2 = ApiKey.generateKey()
    
    assert.isString(key1)
    assert.isString(key2)
    assert.notEqual(key1, key2)
    assert.equal(key1.length, 64) // 32 bytes * 2 (hex)
  })

  test('should generate keys with proper format', async ({ assert }) => {
    const key = ApiKey.generateKey()
    
    // Should be hex string (only contains 0-9 and a-f)
    assert.match(key, /^[0-9a-f]{64}$/)
  })
})