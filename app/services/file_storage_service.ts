import { join, extname, basename } from 'node:path'
import { createHash } from 'node:crypto'
import { Exception } from '@adonisjs/core/exceptions'
import logger from '@adonisjs/core/services/logger'
import drive from '@adonisjs/drive/services/main'
import env from '#start/env'
import ErrorLoggingService from '#services/error_logging_service'

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
 * File storage service for managing screenshot files using @adonisjs/drive
 * Provides organized storage, cleanup, and monitoring capabilities
 */
export class FileStorageService {
  private static instance: FileStorageService
  private readonly diskName: 'fs' | 'r2'
  private readonly baseUrl: string
  private readonly maxFileAge: number // in milliseconds
  private readonly maxStorageSize: number // in bytes
  private readonly minFreeSpace: number // in bytes

  constructor() {
    this.diskName = env.get('DRIVE_DISK', 'fs')

    // Set base URL based on storage type
    if (this.diskName === 'r2') {
      this.baseUrl = env.get('R2_PUBLIC_URL') || `https://${env.get('R2_BUCKET')}.r2.dev`
    } else {
      this.baseUrl = env.get('DRIVE_BASE_URL')
        ? `${env.get('DRIVE_BASE_URL')}/storage`
        : 'http://localhost:3333/storage'
    }

    this.maxFileAge = (env.get('SCREENSHOT_MAX_AGE_DAYS') || 7) * 24 * 60 * 60 * 1000 // Convert days to milliseconds
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
      const disk = drive.use(this.diskName)

      // Ensure base directories exist for local filesystem
      if (this.diskName === 'fs') {
        const directories = ['screenshots', 'temp', 'cache']
        for (const dir of directories) {
          try {
            await disk.exists(dir)
          } catch {
            // Directory doesn't exist, create it by putting a placeholder file and removing it
            await disk.put(`${dir}/.gitkeep`, '')
          }
        }
      }

      logger.info('File storage initialized', { disk: this.diskName })
    } catch (error) {
      // Log error with enhanced tracing
      await ErrorLoggingService.logServiceError(
        'FileStorageService',
        'initialize',
        error,
        {
          context: { diskName: this.diskName },
          errorCategory: 'system',
          severity: 'critical',
        }
      )
      throw new Exception('Failed to initialize file storage', {
        status: 500,
        code: 'STORAGE_INIT_FAILED',
        cause: error,
      })
    }
  }

  /**
   * Save file to storage with organized directory structure
   */
  public async saveFile(
    buffer: Buffer,
    filename: string,
    category: string = 'screenshots'
  ): Promise<string> {
    try {
      const disk = drive.use(this.diskName)

      // Generate organized path structure (year/month/day)
      const now = new Date()
      const year = now.getFullYear().toString()
      const month = (now.getMonth() + 1).toString().padStart(2, '0')
      const day = now.getDate().toString().padStart(2, '0')

      // Generate unique filename if file already exists
      const finalFilename = await this.generateUniqueFilename(category, year, month, day, filename)

      // Create the full path
      const relativePath = join(category, year, month, day, finalFilename).replace(/\\/g, '/')

      // Write file using drive
      await disk.put(relativePath, buffer)

      logger.debug('File saved to storage', {
        path: relativePath,
        size: buffer.length,
        category,
        disk: this.diskName,
      })

      return relativePath
    } catch (error) {
      // Log error with enhanced tracing
      await ErrorLoggingService.logServiceError(
        'FileStorageService',
        'saveFile',
        error,
        {
          context: { filename, category, fileSize: buffer.length },
          errorCategory: 'system',
          severity: 'high',
        }
      )
      throw new Exception('Failed to save file to storage', {
        status: 500,
        code: 'STORAGE_SAVE_FAILED',
        cause: error,
      })
    }
  }

  /**
   * Get public URL for a stored file
   */
  public getFileUrl(relativePath: string): string {
    const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath

    // For R2, use the CDN URL if available, otherwise construct URL
    if (this.diskName === 'r2') {
      return `${this.baseUrl}/${cleanPath}`
    }

    // For local filesystem, use the configured base URL
    return `${this.baseUrl}/${cleanPath}`
  }

  /**
   * Get absolute file path from relative path (for local filesystem only)
   */
  public getAbsolutePath(relativePath: string): string {
    if (this.diskName !== 'fs') {
      throw new Exception('Absolute paths are only available for local filesystem', {
        status: 400,
        code: 'INVALID_OPERATION',
      })
    }

    // For local filesystem, construct the path manually
    const { join } = require('node:path')
    const app = require('@adonisjs/core/services/app').default
    const storagePath = app.makePath(env.get('DRIVE_LOCAL_PATH', 'storage'))
    return join(storagePath, relativePath)
  }

  /**
   * Check if file exists
   */
  public async fileExists(relativePath: string): Promise<boolean> {
    try {
      const disk = drive.use(this.diskName)
      return await disk.exists(relativePath)
    } catch {
      return false
    }
  }

  /**
   * Get file metadata
   */
  public async getFileMetadata(relativePath: string): Promise<FileMetadata | null> {
    try {
      const disk = drive.use(this.diskName)

      // Get file content for hash calculation and size
      const buffer = await disk.get(relativePath)
      const hash = createHash('sha256').update(buffer).digest('hex')

      // For local filesystem, we can get more detailed stats
      let createdAt = new Date()
      let lastAccessed = new Date()

      if (this.diskName === 'fs') {
        try {
          const { promises: fs } = await import('node:fs')
          const absolutePath = this.getAbsolutePath(relativePath)
          const stats = await fs.stat(absolutePath)
          createdAt = stats.birthtime
          lastAccessed = stats.atime
        } catch {
          // Use current date as fallback
        }
      }

      return {
        path: relativePath,
        size: buffer.length,
        createdAt,
        lastAccessed,
        hash,
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
      const disk = drive.use(this.diskName)
      await disk.delete(relativePath)

      logger.debug('File deleted from storage', { path: relativePath, disk: this.diskName })
    } catch (error) {
      // Log error with enhanced tracing
      await ErrorLoggingService.logServiceError(
        'FileStorageService',
        'deleteFile',
        error,
        {
          context: { path: relativePath },
          errorCategory: 'system',
          severity: 'medium',
        }
      )
      throw new Exception('Failed to delete file from storage', {
        status: 500,
        code: 'STORAGE_DELETE_FAILED',
        cause: error,
      })
    }
  }

  /**
   * Save temporary file (automatically cleaned up)
   */
  public async saveTempFile(buffer: Buffer, filename: string): Promise<string> {
    const tempPath = await this.saveFile(buffer, filename, 'temp')

    // Schedule cleanup after 1 hour
    setTimeout(
      async () => {
        try {
          await this.deleteFile(tempPath)
        } catch (error) {
          logger.warn('Failed to cleanup temp file', { path: tempPath, error })
        }
      },
      60 * 60 * 1000
    ) // 1 hour

    return tempPath
  }

  /**
   * Scheduled cleanup method for old files
   */
  public async scheduledCleanup(): Promise<{ deletedFiles: number; errors: string[] }> {
    const errors: string[] = []
    let totalDeleted = 0

    try {
      logger.info('Starting scheduled file cleanup', {
        maxAge: this.maxFileAge,
        diskName: this.diskName,
      })

      totalDeleted = await this.cleanupOldFiles()

      logger.info('Scheduled cleanup completed', {
        deletedFiles: totalDeleted,
        diskName: this.diskName,
      })
    } catch (error) {
      const errorMsg = `Scheduled cleanup failed: ${error.message}`
      errors.push(errorMsg)
      logger.error(errorMsg, { error })
    }

    return { deletedFiles: totalDeleted, errors }
  }

  /**
   * Clean up old files based on age
   */
  public async cleanupOldFiles(olderThan?: Date): Promise<number> {
    const cutoffDate = olderThan || new Date(Date.now() - this.maxFileAge)
    let deletedCount = 0

    try {
      const disk = drive.use(this.diskName)
      const categories = ['screenshots', 'temp', 'cache']

      for (const category of categories) {
        try {
          deletedCount += await this.cleanupDirectory(disk, category, cutoffDate)
        } catch (error) {
          logger.warn('Failed to cleanup category', { category, error })
        }
      }

      logger.info('Cleanup completed', {
        deletedFiles: deletedCount,
        cutoffDate,
        disk: this.diskName,
      })
      return deletedCount
    } catch (error) {
      logger.error('Cleanup failed', { error })
      throw new Exception('File cleanup failed', {
        status: 500,
        code: 'STORAGE_CLEANUP_FAILED',
        cause: error,
      })
    }
  }

  /**
   * Get storage statistics
   */
  public async getStorageStats(): Promise<StorageStats> {
    try {
      const disk = drive.use(this.diskName)
      const stats: StorageStats = {
        totalFiles: 0,
        totalSize: 0,
        availableSpace: 0,
        usedSpace: 0,
        directories: {},
      }

      // For local filesystem, get disk space information
      if (this.diskName === 'fs') {
        try {
          const { promises: fs } = await import('node:fs')
          const app = require('@adonisjs/core/services/app').default
          const storagePath = app.makePath(env.get('DRIVE_LOCAL_PATH', 'storage'))
          const diskStats = await fs.statfs(storagePath)
          stats.availableSpace = diskStats.bavail * diskStats.bsize
          stats.usedSpace = (diskStats.blocks - diskStats.bavail) * diskStats.bsize
        } catch (error) {
          logger.warn('Failed to get disk space stats', { error })
        }
      }

      // Scan directories for file statistics
      const categories = ['screenshots', 'temp', 'cache']

      for (const category of categories) {
        try {
          const categoryStats = await this.getDirectoryStats(disk, category)
          stats.directories[category] = categoryStats
          stats.totalFiles += categoryStats.files
          stats.totalSize += categoryStats.size
        } catch (error) {
          logger.warn('Failed to get stats for category', { category, error })
          stats.directories[category] = { files: 0, size: 0 }
        }
      }

      return stats
    } catch (error) {
      logger.error('Failed to get storage stats', { error })
      throw new Exception('Failed to get storage statistics', {
        status: 500,
        code: 'STORAGE_STATS_FAILED',
        cause: error,
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
      errors: [],
    }

    try {
      const disk = drive.use(this.diskName)

      // Test write permissions
      const testFile = '.health-check'
      try {
        await disk.put(testFile, 'health-check')
        await disk.delete(testFile)
      } catch (error) {
        health.errors.push('Storage is not writable')
        health.healthy = false
      }

      // Check disk space (for local filesystem only)
      if (this.diskName === 'fs') {
        try {
          const { promises: fs } = await import('node:fs')
          const app = require('@adonisjs/core/services/app').default
          const storagePath = app.makePath(env.get('DRIVE_LOCAL_PATH', 'storage'))
          const diskStats = await fs.statfs(storagePath)
          health.availableSpace = diskStats.bavail * diskStats.bsize
          health.usedSpace = (diskStats.blocks - diskStats.bavail) * diskStats.bsize

          if (health.availableSpace < this.minFreeSpace) {
            health.warnings.push(
              `Low disk space: ${Math.round(health.availableSpace / 1024 / 1024)} MB remaining`
            )
            if (health.availableSpace < this.minFreeSpace / 2) {
              health.healthy = false
              health.errors.push('Critically low disk space')
            }
          }
        } catch (error) {
          health.warnings.push('Could not check disk space')
        }
      }

      // Check storage size limits
      try {
        const stats = await this.getStorageStats()
        if (stats.totalSize > this.maxStorageSize) {
          health.warnings.push(
            `Storage size limit exceeded: ${Math.round(stats.totalSize / 1024 / 1024)} MB`
          )
        }
      } catch (error) {
        health.warnings.push('Could not check storage size limits')
      }
    } catch (error) {
      health.errors.push(`Health check failed: ${error.message}`)
      health.healthy = false
    }

    return health
  }

  /**
   * Generate unique filename if file already exists
   */
  private async generateUniqueFilename(
    category: string,
    year: string,
    month: string,
    day: string,
    filename: string
  ): Promise<string> {
    const disk = drive.use(this.diskName)
    const ext = extname(filename)
    const name = basename(filename, ext)
    let counter = 0
    let finalFilename = filename

    // Check if file exists in the specific path
    while (await this.fileExistsInPath(disk, category, year, month, day, finalFilename)) {
      counter++
      finalFilename = `${name}_${counter}${ext}`
    }

    return finalFilename
  }

  /**
   * Check if file exists in specific path
   */
  private async fileExistsInPath(
    disk: any,
    category: string,
    year: string,
    month: string,
    day: string,
    filename: string
  ): Promise<boolean> {
    try {
      const fullPath = join(category, year, month, day, filename).replace(/\\/g, '/')
      return await disk.exists(fullPath)
    } catch {
      return false
    }
  }

  /**
   * Recursively clean up directory based on file age
   */
  private async cleanupDirectory(disk: any, directory: string, cutoffDate: Date): Promise<number> {
    let deletedCount = 0

    try {
      // For drive, we need to list files and check their modification dates
      const files = await this.listFilesRecursively(disk, directory)

      for (const filePath of files) {
        try {
          // For local filesystem, check file stats directly
          if (this.diskName === 'fs') {
            const { promises: fs } = await import('node:fs')
            const absolutePath = this.getAbsolutePath(filePath)
            const stats = await fs.stat(absolutePath)
            if (stats.mtime < cutoffDate) {
              await disk.delete(filePath)
              deletedCount++
            }
          } else {
            // For cloud storage, we'll delete files older than the cutoff
            // Since we can't easily get modification dates, we'll use a simpler approach
            await disk.delete(filePath)
            deletedCount++
          }
        } catch (error) {
          logger.warn('Failed to cleanup file', { file: filePath, error })
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
  private async getDirectoryStats(
    disk: any,
    directory: string
  ): Promise<{ files: number; size: number }> {
    let files = 0
    let size = 0

    try {
      const fileList = await this.listFilesRecursively(disk, directory)

      for (const filePath of fileList) {
        try {
          // Get file size using drive's get method
          const buffer = await disk.get(filePath)
          files++
          size += buffer.length
        } catch (error) {
          logger.warn('Failed to get file stats', { file: filePath, error })
        }
      }
    } catch (error) {
      logger.warn('Failed to get directory stats', { directory, error })
    }

    return { files, size }
  }

  /**
   * List all files recursively in a directory
   */
  private async listFilesRecursively(disk: any, directory: string): Promise<string[]> {
    const files: string[] = []

    try {
      // For local filesystem, we can use native methods
      if (this.diskName === 'fs') {
        const { promises: fs } = await import('node:fs')
        const app = require('@adonisjs/core/services/app').default
        const storagePath = app.makePath(env.get('DRIVE_LOCAL_PATH', 'storage'))
        const fullPath = join(storagePath, directory)

        try {
          await fs.access(fullPath)
          const entries = await fs.readdir(fullPath, { withFileTypes: true })

          for (const entry of entries) {
            const relativePath = join(directory, entry.name).replace(/\\/g, '/')

            if (entry.isDirectory()) {
              const subFiles = await this.listFilesRecursively(disk, relativePath)
              files.push(...subFiles)
            } else if (entry.isFile()) {
              files.push(relativePath)
            }
          }
        } catch {
          // Directory doesn't exist or is empty
        }
      } else {
        // For cloud storage, this would need to be implemented differently
        // depending on the provider's API capabilities
        logger.warn('Recursive file listing not fully implemented for cloud storage', { directory })
      }
    } catch (error) {
      logger.warn('Failed to list files recursively', { directory, error })
    }

    return files
  }
}

// Export singleton instance
export default FileStorageService.getInstance()
