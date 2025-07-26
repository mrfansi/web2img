# Web2Img - Website Screenshot Service

A high-performance website screenshot service built with AdonisJS, providing REST APIs for capturing website screenshots and converting them to various image formats.

## Features

- **RESTful API**: Clean API endpoints for screenshot generation
- **Multiple Formats**: Support for PNG, JPEG, WebP formats
- **Queue Processing**: Background job processing with BullMQ
- **Caching**: Redis-based caching for improved performance
- **Rate Limiting**: Built-in rate limiting and API key authentication
- **Batch Processing**: Support for bulk screenshot operations
- **Error Handling**: Comprehensive error handling and logging

## Architecture

This application uses a modern, scalable architecture with:
- **AdonisJS v6**: Modern Node.js framework
- **Redis**: For caching and queue management
- **MySQL**: Primary database
- **Playwright**: For browser automation and screenshot capture
- **BullMQ**: For background job processing

## CentralRedisManager Usage Guide

The `CentralRedisManager` is a singleton class that provides centralized Redis connection management with leak detection and proper resource cleanup. It's designed to prevent connection leaks and ensure all Redis connections are properly tracked and closed.

### Basic Usage

#### Getting a Shared Connection

For most use cases, use the shared Redis client:

```typescript
import { getCentralRedisManager } from '#services/central_redis_manager'

// Get the singleton instance
const redisManager = getCentralRedisManager()

// Get the shared Redis client (lazily initialized)
const client = redisManager.getClient()

// Use the client for Redis operations
await client.set('key', 'value')
const value = await client.get('key')
```

#### Creating Duplicate Connections

When you need dedicated connections (e.g., for blocking operations):

```typescript
import { getCentralRedisManager } from '#services/central_redis_manager'

const redisManager = getCentralRedisManager()

// Create a duplicate connection for dedicated use
const duplicateClient = redisManager.duplicate()

// Use for blocking operations or isolated transactions
await duplicateClient.blpop('queue', 0)

// Remember to close when done
await duplicateClient.quit()
```

#### BullMQ Connections

For BullMQ workers and queues, use the dedicated BullMQ method:

```typescript
import { getCentralRedisManager } from '#services/central_redis_manager'

const redisManager = getCentralRedisManager()

// Create a connection specifically for BullMQ (no keyPrefix)
const bullmqClient = redisManager.duplicateForBullMQ()

// Use with BullMQ
const queue = new Queue('screenshots', { connection: bullmqClient })
const worker = new Worker('screenshots', processor, { connection: bullmqClient })
```

### Connection Sharing vs Duplication

#### When to Share (getClient())

Use the shared client for:
- ✅ Simple get/set operations
- ✅ Short-lived operations
- ✅ Cache operations
- ✅ General Redis commands

```typescript
// ✅ Good: Simple cache operations
const client = redisManager.getClient()
await client.setex('session:123', 3600, 'user-data')
```

#### When to Duplicate

Create duplicate connections for:
- ✅ Blocking operations (`BLPOP`, `BRPOP`, etc.)
- ✅ Long-running operations
- ✅ Pub/Sub subscribers
- ✅ BullMQ workers and queues
- ✅ Database-like transactions

```typescript
// ✅ Good: Blocking operation with dedicated connection
const blockingClient = redisManager.duplicate()
try {
  const result = await blockingClient.blpop('work-queue', 30)
  // Process result...
} finally {
  await blockingClient.quit() // Always clean up!
}
```

### Required shutdown() in Application Lifecycles

The `CentralRedisManager` **must** be properly shut down in all application lifecycles to prevent connection leaks and ensure graceful cleanup.

#### Application/Server Lifecycle

In your main application startup file:

```typescript
// start/app.ts or similar
import { getCentralRedisManager } from '#services/central_redis_manager'

// During application shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...')
  
  // Shutdown Redis connections first
  const redisManager = getCentralRedisManager()
  await redisManager.shutdown()
  
  // Then shutdown other services
  // ...
  
  process.exit(0)
})

process.on('SIGINT', async () => {
  console.log('Received SIGINT, shutting down...')
  
  const redisManager = getCentralRedisManager()
  await redisManager.shutdown()
  
  process.exit(0)
})
```

#### Test Lifecycle

The test bootstrap already includes automatic connection leak detection:

```typescript
// tests/bootstrap.ts (already configured)
export const runnerHooks = {
  teardown: [
    async () => {
      // Shutdown Redis manager after all tests
      const redisManager = getCentralRedisManager()
      await redisManager.shutdown()
    }
  ]
}

// Automatic leak detection after each test
suite.each.teardown(async ({ assert }) => {
  const redisManager = getCentralRedisManager()
  const openConnectionsCount = redisManager.getOpenConnectionsCount()
  
  // This will fail the test if connections are leaked
  assert.equal(0, openConnectionsCount, 'Redis connection leak detected!')
})
```

#### Individual Test Cleanup

For tests that create duplicate connections:

```typescript
import { test } from '@japa/runner'
import { getCentralRedisManager } from '#services/central_redis_manager'

test.group('Redis Operations', (group) => {
  let duplicateClient: IORedis

  group.teardown(async () => {
    // Clean up any duplicate connections created in tests
    if (duplicateClient) {
      await duplicateClient.quit()
    }
  })

  test('should handle blocking operations', async ({ assert }) => {
    const redisManager = getCentralRedisManager()
    duplicateClient = redisManager.duplicate()
    
    // Use duplicate client for test
    await duplicateClient.lpush('test-queue', 'item')
    const result = await duplicateClient.brpop('test-queue', 1)
    
    assert.equal(result[1], 'item')
    // Connection will be cleaned up in group teardown
  })
})
```

#### Worker Process Lifecycle

For background workers or queue processors:

```typescript
// workers/screenshot-worker.ts
import { getCentralRedisManager } from '#services/central_redis_manager'

class ScreenshotWorker {
  private redisClient: IORedis
  
  async start() {
    const redisManager = getCentralRedisManager()
    this.redisClient = redisManager.duplicateForBullMQ()
    
    // Set up worker with dedicated connection
    // ...
  }
  
  async stop() {
    // Always clean up the connection
    if (this.redisClient) {
      await this.redisClient.quit()
    }
  }
}

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  await worker.stop()
  
  // Final cleanup of all Redis connections
  const redisManager = getCentralRedisManager()
  await redisManager.shutdown()
})
```

### Connection Leak Detection

The `CentralRedisManager` includes built-in connection tracking and leak detection:

```typescript
const redisManager = getCentralRedisManager()

// Check how many connections are currently open
const count = redisManager.getOpenConnectionsCount()
console.log(`Open connections: ${count}`)

// Get detailed information about open connections
const info = redisManager.getOpenConnectionsInfo()
console.log('Connection details:', info)
```

### Best Practices

1. **Always use the singleton**: Never instantiate `CentralRedisManager` directly
2. **Prefer shared connections**: Use `getClient()` for most operations
3. **Clean up duplicates**: Always call `quit()` on duplicate connections when done
4. **Implement shutdown handlers**: Ensure `shutdown()` is called during application termination
5. **Monitor in tests**: The automatic leak detection will catch connection leaks
6. **Use BullMQ method for queues**: Use `duplicateForBullMQ()` for BullMQ connections

### Common Pitfalls

```typescript
// ❌ BAD: Creating duplicate without cleanup
const client = redisManager.duplicate()
await client.set('key', 'value')
// Missing: await client.quit()

// ❌ BAD: Not handling shutdown in workers
class Worker {
  start() {
    this.client = redisManager.duplicate()
    // Missing shutdown handling
  }
}

// ✅ GOOD: Proper cleanup pattern
const client = redisManager.duplicate()
try {
  await client.blpop('queue', 0)
} finally {
  await client.quit() // Always clean up
}

// ✅ GOOD: Shared client for simple operations
const client = redisManager.getClient() // No cleanup needed
await client.get('key')
```

## Installation & Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd web2img
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start Redis server**
   ```bash
   redis-server
   ```

5. **Run migrations**
   ```bash
   node ace migration:run
   ```

6. **Start the development server**
   ```bash
   npm run dev
   ```

## Testing

Run the test suite with automatic connection leak detection:

```bash
npm test
```

The test framework includes automatic Redis connection leak detection that will fail tests if connections are not properly closed.

## API Documentation

### Screenshot Endpoints

- `POST /screenshots` - Generate a single screenshot
- `POST /screenshots/batch` - Generate multiple screenshots
- `GET /screenshots/:id` - Get screenshot status/result

### Authentication

All API endpoints require authentication via API key:

```bash
curl -H "X-API-Key: your-api-key" \
     -H "Content-Type: application/json" \
     -d '{"url": "https://example.com"}' \
     http://localhost:3333/screenshots
```

## Deployment

For production deployment, ensure:

1. **Redis is properly configured** with persistence and appropriate memory settings
2. **Database connections** are optimized for your load
3. **Process management** includes proper signal handling for graceful shutdowns
4. **Health checks** monitor Redis connectivity
5. **Monitoring** tracks connection counts and potential leaks

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Ensure all tests pass (including connection leak detection)
5. Submit a pull request

## License

[Your License Here]
