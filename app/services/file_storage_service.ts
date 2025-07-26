import { promises as fs } from 'node:fs'
import { join, extname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { Exception } from '@adonisjs/core/exceptions'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'

/**
 * File storage statistics interface
 */
export interface StorageStats {
  totalFiles: number
  totalSize: number
  availableSpace: number
  usedSpace: number
  directories: {
    [key: string]: {
      files: number
      size: number
    }
  }
}

/**
 * Storage health check result
 */
export interface StorageHealth {
  healthy: boolean
  availableSpace: number
  usedSpace: number
  warnings: string[]
  errors: string[]
}

/**
 * File metadata interface
 */
export interface FileMetadata {
  path: string
  size: number
  createdAt: Date
  lastAccessed: Date
  hash: string
}

/**
 * File storage service for managing screenshot files
 * Provides organized storage, cleanup, and monitoring capabilities
 */
export class FileStorageService {
  private static instance: FileStorageService
  private readonly basePath: string
  private readonly baseUrl: string
  private readonly maxFileAge: number // in milliseconds
  private readonly maxStorageSize: number // in bytes
  private readonly minFreeSpace: number // in bytes

  constructor() {
    this.basePath = env.get('STORAGE_PATH')
    this.baseUrl = env.get('STORAGE_BASE_URL')
    this.maxFileAge = env.get('SCREENSHOT_CACHE_TTL', 3600) * 1000 // Convert to milliseconds
    this.maxStorageSize = 10 * 1024 * 1024 * 1024 // 10GB default
    this.minFreeSpace = 1024 * 1024 * 1024 // 1GB minimum free space
  }

  /**
   * Get singleton instance of FileStorageService
   */
  public static getInstance(): FileStorageService {
    if (!FileStorageService.instance) {
      FileStorageService.instance = new FileStorageService()
    }
    return FileStorageService.instance
  }

  /**
   * Initialize storage directories
   */
  public async initialize(): Promise<void> {
    try {
      await this.ensureDirectoryExists(this.basePath)
      await this.ensureDirectoryExists(join(this.basePath, 'screenshots'))
      await this.ensureDirectoryExists(join(this.basePath, 'temp'))
      await this.ensureDirectoryExists(join(this.basePath, 'cache'))
      
      logger.info('File storage initialized', { basePath: this.basePath })
    } catch (error) {
      logger.error('Failed to initialize file storage', { error })
      throw new Exception('Failed to initialize file storage', {
        status: 500,
        code: 'STORAGE_INIT_FAILED',
        cause: error
      })
    }
  }

  /**
   * Save file to storage with organized directory structure
   */
  public async saveFile(buffer: Buffer, filename: string, category: string = 'screenshots'): Promise<string> {
    try {
      // Generate organized path structure (year/month/day)
      const now = new Date()
      const year = now.getFullYear().toString()
      const month = (now.getMonth() + 1).toString().padStart(2, '0')
      const day = now.getDate().toString().padStart(2, '0')
      
      const categoryPath = join(this.basePath, category, year, month, day)
      await this.ensureDirectoryExists(categoryPath)
      
      // Generate unique filename if file already exists
      const finalFilename = await this.generateUniqueFilename(categoryPath, filename)
      const filePath = join(categoryPath, finalFilename)
      
      // Write file to disk
      await fs.writeFile(filePath, buffer)
      
      // Generate relative path for URL generation
      const relativePath = join(category, year, month, day, finalFilename)
      
      logger.debug('File saved to storage', { 
        path: relativePath, 
        size: buffer.length,
        category 
      })
      
      return relativePath
    } catch (error) {
      logger.error('Failed to save file to storage', { filename, category, error })
      throw new Exception('Failed to save file to storage', {
        status: 500,
        code: 'STORAGE_SAVE_FAILED',
        cause: error
      })
    }
  }

  /**
   * Get public URL for a stored file
   */
  public getFileUrl(relativePath: string): string {
    // Remove leading slash if present
    const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath
    return `${this.baseUrl}/${cleanPath}`
  }

  /**
   * Get absolute file path from relative path
   */
  public getAbsolutePath(relativePath: string): string {
    return join(this.basePath, relativePath)
  }

  /**
   * Check if file exists
   */
  public async fileExists(relativePath: string): Promise<boolean> {
    try {
      const absolutePath = this.getAbsolutePath(relativePath)
      await fs.access(absolutePath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get file metadata
   */
  public async getFileMetadata(relativePath: string): Promise<FileMetadata | null> {
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
    } catch (error) {
      logger.warn('Failed to get file metadata', { path: relativePath, error })
      return null
    }
  }

  /**
   * Delete file from storage
   */
  public async deleteFile(relativePath: string): Promise<void> {
    try {
      const absolutePath = this.getAbsolutePath(relativePath)
      await fs.unlink(absolutePath)
      
      logger.debug('File deleted from storage', { path: relativePath })
    } catch (error) {
      logger.error('Failed to delete file from storage', { path: relativePath, error })
      throw new Exception('Failed to delete file from storage', {
        status: 500,
        code: 'STORAGE_DELETE_FAILED',
        cause: error
      })
    }
  }

  /**
   * Save temporary file (automatically cleaned up)
   */
  public async saveTempFile(buffer: Buffer, filename: string): Promise<string> {
    const tempPath = await this.saveFile(buffer, filename, 'temp')
    
    // Schedule cleanup after 1 hour
    setTimeout(async () => {
      try {
        await this.deleteFile(tempPath)
      } catch (error) {
        logger.warn('Failed to cleanup temp file', { path: tempPath, error })
      }
    }, 60 * 60 * 1000) // 1 hour
    
    return tempPath
  }

  /**
   * Clean up old files based on age
   */
  public async cleanupOldFiles(olderThan?: Date): Promise<number> {
    const cutoffDate = olderThan || new Date(Date.now() - this.maxFileAge)
    let deletedCount = 0
    
    try {
      const categories = ['screenshots', 'temp', 'cache']
      
      for (const category of categories) {
        const categoryPath = join(this.basePath, category)
        if (await this.directoryExists(categoryPath)) {
          deletedCount += await this.cleanupDirectory(categoryPath, cutoffDate)
        }
      }
      
      logger.info('Cleanup completed', { deletedFiles: deletedCount, cutoffDate })
      return deletedCount
    } catch (error) {
      logger.error('Cleanup failed', { error })
      throw new Exception('File cleanup failed', {
        status: 500,
        code: 'STORAGE_CLEANUP_FAILED',
        cause: error
      })
    }
  }

  /**
   * Get storage statistics
   */
  public async getStorageStats(): Promise<StorageStats> {
    try {
      const stats: StorageStats = {
        totalFiles: 0,
        totalSize: 0,
        availableSpace: 0,
        usedSpace: 0,
        directories: {}
      }
      
      // Get disk space information
      const diskStats = await fs.statfs(this.basePath)
      stats.availableSpace = diskStats.bavail * diskStats.bsize
      stats.usedSpace = (diskStats.blocks - diskStats.bavail) * diskStats.bsize
      
      // Scan directories for file statistics
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
    } catch (error) {
      logger.error('Failed to get storage stats', { error })
      throw new Exception('Failed to get storage statistics', {
        status: 500,
        code: 'STORAGE_STATS_FAILED',
        cause: error
      })
    }
  }

  /**
   * Perform storage health check
   */
  public async healthCheck(): Promise<StorageHealth> {
    const health: StorageHealth = {
      healthy: true,
      availableSpace: 0,
      usedSpace: 0,
      warnings: [],
      errors: []
    }
    
    try {
      // Check if base directory exists and is writable
      if (!await this.directoryExists(this.basePath)) {
        health.errors.push('Storage base directory does not exist')
        health.healthy = false
      } else {
        // Test write permissions
        const testFile = join(this.basePath, '.health-check')
        try {
          await fs.writeFile(testFile, 'health-check')
          await fs.unlink(testFile)
        } catch {
          health.errors.push('Storage directory is not writable')
          health.healthy = false
        }
      }
      
      // Check disk space
      const diskStats = await fs.statfs(this.basePath)
      health.availableSpace = diskStats.bavail * diskStats.bsize
      health.usedSpace = (diskStats.blocks - diskStats.bavail) * diskStats.bsize
      
      if (health.availableSpace < this.minFreeSpace) {
        health.warnings.push(`Low disk space: ${Math.round(health.availableSpace / 1024 / 1024)} MB remaining`)
        if (health.availableSpace < this.minFreeSpace / 2) {
          health.healthy = false
          health.errors.push('Critically low disk space')
        }
      }
      
      // Check storage size limits
      const stats = await this.getStorageStats()
      if (stats.totalSize > this.maxStorageSize) {
        health.warnings.push(`Storage size limit exceeded: ${Math.round(stats.totalSize / 1024 / 1024)} MB`)
      }
      
    } catch (error) {
      health.errors.push(`Health check failed: ${error.message}`)
      health.healthy = false
    }
    
    return health
  }  /**

   * Ensure directory exists, create if it doesn't
   */
  private async ensureDirectoryExists(path: string): Promise<void> {
    try {
      await fs.access(path)
    } catch {
      await fs.mkdir(path, { recursive: true })
    }
  }

  /**
   * Check if directory exists
   */
  private async directoryExists(path: string): Promise<boolean> {
    try {
      const stats = await fs.stat(path)
      return stats.isDirectory()
    } catch {
      return false
    }
  }

  /**
   * Generate unique filename if file already exists
   */
  private async generateUniqueFilename(directory: string, filename: string): Promise<string> {
    const ext = extname(filename)
    const name = basename(filename, ext)
    let counter = 0
    let finalFilename = filename
    
    // Check if file exists in the specific directory
    while (await this.fileExistsInDirectory(directory, finalFilename)) {
      counter++
      finalFilename = `${name}_${counter}${ext}`
    }
    
    return finalFilename
  }

  /**
   * Check if file exists in specific directory
   */
  private async fileExistsInDirectory(directory: string, filename: string): Promise<boolean> {
    try {
      const fullPath = join(directory, filename)
      await fs.access(fullPath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Recursively clean up directory based on file age
   */
  private async cleanupDirectory(directory: string, cutoffDate: Date): Promise<number> {
    let deletedCount = 0
    
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true })
      
      for (const entry of entries) {
        const fullPath = join(directory, entry.name)
        
        if (entry.isDirectory()) {
          deletedCount += await this.cleanupDirectory(fullPath, cutoffDate)
          
          // Remove empty directories
          try {
            const remainingEntries = await fs.readdir(fullPath)
            if (remainingEntries.length === 0) {
              await fs.rmdir(fullPath)
            }
          } catch {
            // Directory not empty or other error, ignore
          }
        } else if (entry.isFile()) {
          const stats = await fs.stat(fullPath)
          if (stats.mtime < cutoffDate) {
            await fs.unlink(fullPath)
            deletedCount++
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to cleanup directory', { directory, error })
    }
    
    return deletedCount
  }

  /**
   * Get statistics for a directory
   */
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
    } catch (error) {
      logger.warn('Failed to get directory stats', { directory, error })
    }
    
    return { files, size }
  }
}

// Export singleton instance
export default FileStorageService.getInstance()