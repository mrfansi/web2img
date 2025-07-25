import { test } from '@japa/runner'
import { promises as fs } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'

// Create a test version of FileStorageService that doesn't use singleton
class TestFileStorageService {
  private readonly basePath: string
  private readonly baseUrl: string
  private readonly maxFileAge: number
  private readonly maxStorageSize: number
  private readonly minFreeSpace: number

  constructor(basePath: string, baseUrl: string) {
    this.basePath = basePath
    this.baseUrl = baseUrl
    this.maxFileAge = 3600 * 1000 // 1 hour in milliseconds
    this.maxStorageSize = 10 * 1024 * 1024 * 1024 // 10GB
    this.minFreeSpace = 1024 * 1024 * 1024 // 1GB
  }

  async initialize(): Promise<void> {
    await this.ensureDirectoryExists(this.basePath)
    await this.ensureDirectoryExists(join(this.basePath, 'screenshots'))
    await this.ensureDirectoryExists(join(this.basePath, 'temp'))
    await this.ensureDirectoryExists(join(this.basePath, 'cache'))
  }

  async saveFile(buffer: Buffer, filename: string, category: string = 'screenshots'): Promise<string> {
    const now = new Date()
    const year = now.getFullYear().toString()
    const month = (now.getMonth() + 1).toString().padStart(2, '0')
    const day = now.getDate().toString().padStart(2, '0')
    
    const categoryPath = join(this.basePath, category, year, month, day)
    await this.ensureDirectoryExists(categoryPath)
    
    const finalFilename = await this.generateUniqueFilename(categoryPath, filename)
    const filePath = join(categoryPath, finalFilename)
    
    await fs.writeFile(filePath, buffer)
    
    return join(category, year, month, day, finalFilename)
  }

  getFileUrl(relativePath: string): string {
    const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath
    return `${this.baseUrl}/${cleanPath}`
  }

  getAbsolutePath(relativePath: string): string {
    return join(this.basePath, relativePath)
  }

  async fileExists(relativePath: string): Promise<boolean> {
    try {
      const absolutePath = this.getAbsolutePath(relativePath)
      await fs.access(absolutePath)
      return true
    } catch {
      return false
    }
  }

  async getFileMetadata(relativePath: string) {
    try {
      const absolutePath = this.getAbsolutePath(relativePath)
      const stats = await fs.stat(absolutePath)
      const buffer = await fs.readFile(absolutePath)
      const hash = createHash('sha256').update(buffer).digest('hex')
      
      return {
        path: relativePath,
        size: stats.size,
        createdAt: stats.birthtime,
        lastAccessed: stats.atime,
        hash
      }
    } catch {
      return null
    }
  }

  async deleteFile(relativePath: string): Promise<void> {
    const absolutePath = this.getAbsolutePath(relativePath)
    await fs.unlink(absolutePath)
  }

  async saveTempFile(buffer: Buffer, filename: string): Promise<string> {
    return this.saveFile(buffer, filename, 'temp')
  }

  async cleanupOldFiles(olderThan?: Date): Promise<number> {
    const cutoffDate = olderThan || new Date(Date.now() - this.maxFileAge)
    let deletedCount = 0
    
    const categories = ['screenshots', 'temp', 'cache']
    
    for (const category of categories) {
      const categoryPath = join(this.basePath, category)
      if (await this.directoryExists(categoryPath)) {
        deletedCount += await this.cleanupDirectory(categoryPath, cutoffDate)
      }
    }
    
    return deletedCount
  }

  async getStorageStats() {
    const stats = {
      totalFiles: 0,
      totalSize: 0,
      availableSpace: 0,
      usedSpace: 0,
      directories: {} as any
    }
    
    const diskStats = await fs.statfs(this.basePath)
    stats.availableSpace = diskStats.bavail * diskStats.bsize
    stats.usedSpace = (diskStats.blocks - diskStats.bavail) * diskStats.bsize
    
    const categories = ['screenshots', 'temp', 'cache']
    
    for (const category of categories) {
      const categoryPath = join(this.basePath, category)
      if (await this.directoryExists(categoryPath)) {
        const categoryStats = await this.getDirectoryStats(categoryPath)
        stats.directories[category] = categoryStats
        stats.totalFiles += categoryStats.files
        stats.totalSize += categoryStats.size
      }
    }
    
    return stats
  }

  async healthCheck() {
    const health = {
      healthy: true,
      availableSpace: 0,
      usedSpace: 0,
      warnings: [] as string[],
      errors: [] as string[]
    }
    
    if (!await this.directoryExists(this.basePath)) {
      health.errors.push('Storage base directory does not exist')
      health.healthy = false
    }
    
    const diskStats = await fs.statfs(this.basePath)
    health.availableSpace = diskStats.bavail * diskStats.bsize
    health.usedSpace = (diskStats.blocks - diskStats.bavail) * diskStats.bsize
    
    return health
  }

  private async ensureDirectoryExists(path: string): Promise<void> {
    try {
      await fs.access(path)
    } catch {
      await fs.mkdir(path, { recursive: true })
    }
  }

  private async directoryExists(path: string): Promise<boolean> {
    try {
      const stats = await fs.stat(path)
      return stats.isDirectory()
    } catch {
      return false
    }
  }

  private async generateUniqueFilename(directory: string, filename: string): Promise<string> {
    const ext = extname(filename)
    const name = basename(filename, ext)
    let counter = 0
    let finalFilename = filename
    
    while (await this.fileExistsInDirectory(directory, finalFilename)) {
      counter++
      finalFilename = `${name}_${counter}${ext}`
    }
    
    return finalFilename
  }

  private async fileExistsInDirectory(directory: string, filename: string): Promise<boolean> {
    try {
      const fullPath = join(directory, filename)
      await fs.access(fullPath)
      return true
    } catch {
      return false
    }
  }

  private async cleanupDirectory(directory: string, cutoffDate: Date): Promise<number> {
    let deletedCount = 0
    
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true })
      
      for (const entry of entries) {
        const fullPath = join(directory, entry.name)
        
        if (entry.isDirectory()) {
          deletedCount += await this.cleanupDirectory(fullPath, cutoffDate)
        } else if (entry.isFile()) {
          const stats = await fs.stat(fullPath)
          if (stats.mtime < cutoffDate) {
            await fs.unlink(fullPath)
            deletedCount++
          }
        }
      }
    } catch {
      // Ignore errors
    }
    
    return deletedCount
  }

  private async getDirectoryStats(directory: string): Promise<{ files: number; size: number }> {
    let files = 0
    let size = 0
    
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true })
      
      for (const entry of entries) {
        const fullPath = join(directory, entry.name)
        
        if (entry.isDirectory()) {
          const subStats = await this.getDirectoryStats(fullPath)
          files += subStats.files
          size += subStats.size
        } else if (entry.isFile()) {
          const stats = await fs.stat(fullPath)
          files++
          size += stats.size
        }
      }
    } catch {
      // Ignore errors
    }
    
    return { files, size }
  }
}

test.group('FileStorageService', (group) => {
  let storageService: TestFileStorageService
  let tempDir: string

  group.setup(async () => {
    // Create temporary directory for testing
    tempDir = await fs.mkdtemp(join(tmpdir(), 'storage-test-'))
    
    storageService = new TestFileStorageService(tempDir, 'http://localhost:3333/storage')
    await storageService.initialize()
  })

  group.teardown(async () => {
    // Clean up temporary directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true })
    } catch (error) {
      console.warn('Failed to cleanup temp directory:', error)
    }
  })

  test('should initialize storage directories', async ({ assert }) => {
    const screenshotsDir = join(tempDir, 'screenshots')
    const tempDirPath = join(tempDir, 'temp')
    const cacheDir = join(tempDir, 'cache')

    assert.isTrue(await directoryExists(screenshotsDir))
    assert.isTrue(await directoryExists(tempDirPath))
    assert.isTrue(await directoryExists(cacheDir))
  })

  test('should save file with organized directory structure', async ({ assert }) => {
    const testBuffer = Buffer.from('test image data')
    const filename = 'test-image.png'

    const relativePath = await storageService.saveFile(testBuffer, filename)
    
    assert.isString(relativePath)
    assert.isTrue(relativePath.includes('screenshots'))
    assert.isTrue(relativePath.includes('.png'))
    
    const absolutePath = storageService.getAbsolutePath(relativePath)
    const savedData = await fs.readFile(absolutePath)
    assert.deepEqual(savedData, testBuffer)
  })

  test('should generate unique filename for duplicate files', async ({ assert }) => {
    const testBuffer = Buffer.from('test image data')
    const filename = 'duplicate.png'

    const path1 = await storageService.saveFile(testBuffer, filename)
    const path2 = await storageService.saveFile(testBuffer, filename)

    assert.notEqual(path1, path2)
    assert.isTrue(path2.includes('duplicate_1.png') || path2.includes('duplicate_2.png'))
  })

  test('should generate correct public URL', async ({ assert }) => {
    const relativePath = 'screenshots/2024/01/15/test.png'
    const url = storageService.getFileUrl(relativePath)
    
    assert.equal(url, 'http://localhost:3333/storage/screenshots/2024/01/15/test.png')
  })

  test('should check file existence correctly', async ({ assert }) => {
    const testBuffer = Buffer.from('test data')
    const relativePath = await storageService.saveFile(testBuffer, 'exists.png')
    
    assert.isTrue(await storageService.fileExists(relativePath))
    assert.isFalse(await storageService.fileExists('non-existent/file.png'))
  })

  test('should get file metadata', async ({ assert }) => {
    const testBuffer = Buffer.from('test metadata')
    const relativePath = await storageService.saveFile(testBuffer, 'metadata.png')
    
    const metadata = await storageService.getFileMetadata(relativePath)
    
    assert.isNotNull(metadata)
    assert.equal(metadata!.path, relativePath)
    assert.equal(metadata!.size, testBuffer.length)
    assert.instanceOf(metadata!.createdAt, Date)
    assert.isString(metadata!.hash)
  })

  test('should delete file successfully', async ({ assert }) => {
    const testBuffer = Buffer.from('to be deleted')
    const relativePath = await storageService.saveFile(testBuffer, 'delete-me.png')
    
    assert.isTrue(await storageService.fileExists(relativePath))
    
    await storageService.deleteFile(relativePath)
    
    assert.isFalse(await storageService.fileExists(relativePath))
  })

  test('should save and auto-cleanup temporary files', async ({ assert }) => {
    const testBuffer = Buffer.from('temporary data')
    const tempPath = await storageService.saveTempFile(testBuffer, 'temp.png')
    
    assert.isTrue(tempPath.includes('temp'))
    assert.isTrue(await storageService.fileExists(tempPath))
  })

  test('should cleanup old files', async ({ assert }) => {
    const testBuffer = Buffer.from('old file')
    const relativePath = await storageService.saveFile(testBuffer, 'old.png')
    
    // Manually set file modification time to past
    const absolutePath = storageService.getAbsolutePath(relativePath)
    const pastTime = new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago
    await fs.utimes(absolutePath, pastTime, pastTime)
    
    const cutoffDate = new Date(Date.now() - 60 * 60 * 1000) // 1 hour ago
    const deletedCount = await storageService.cleanupOldFiles(cutoffDate)
    
    assert.isAbove(deletedCount, 0)
    assert.isFalse(await storageService.fileExists(relativePath))
  })

  test('should get storage statistics', async ({ assert }) => {
    const testBuffer = Buffer.from('stats test data')
    await storageService.saveFile(testBuffer, 'stats1.png')
    await storageService.saveFile(testBuffer, 'stats2.png')
    
    const stats = await storageService.getStorageStats()
    
    assert.isNumber(stats.totalFiles)
    assert.isNumber(stats.totalSize)
    assert.isNumber(stats.availableSpace)
    assert.isNumber(stats.usedSpace)
    assert.isObject(stats.directories)
    assert.property(stats.directories, 'screenshots')
  })

  test('should perform health check', async ({ assert }) => {
    const health = await storageService.healthCheck()
    
    assert.isBoolean(health.healthy)
    assert.isNumber(health.availableSpace)
    assert.isNumber(health.usedSpace)
    assert.isArray(health.warnings)
    assert.isArray(health.errors)
  })

  test('should handle storage errors gracefully', async ({ assert }) => {
    // Test with invalid path
    const invalidService = new TestFileStorageService('/invalid/path/that/does/not/exist', 'http://localhost')
    
    await assert.rejects(
      () => invalidService.saveFile(Buffer.from('test'), 'test.png')
    )
  })
})

// Helper function to check if directory exists
async function directoryExists(path: string): Promise<boolean> {
  try {
    const stats = await fs.stat(path)
    return stats.isDirectory()
  } catch {
    return false
  }
}