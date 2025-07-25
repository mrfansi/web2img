import { Browser, BrowserContext, Page, chromium } from 'playwright'
import logger from '@adonisjs/core/services/logger'

export interface PageOptions {
    width: number
    height: number
    timeout: number
}

export interface BrowserPoolOptions {
    maxBrowsers: number
    maxPagesPerBrowser: number
    browserTimeout: number
    pageTimeout: number
}

interface BrowserInstance {
    browser: Browser
    context: BrowserContext
    activePagesCount: number
    createdAt: Date
    lastUsed: Date
}

export class BrowserService {
    private browserPool: Map<string, BrowserInstance> = new Map()
    private readonly poolOptions: BrowserPoolOptions
    private cleanupInterval: NodeJS.Timeout | null = null
    private creatingBrowsers: Set<string> = new Set() // Track browsers being created

    constructor(options: Partial<BrowserPoolOptions> = {}) {
        this.poolOptions = {
            maxBrowsers: options.maxBrowsers || 3,
            maxPagesPerBrowser: options.maxPagesPerBrowser || 5,
            browserTimeout: options.browserTimeout || 300000, // 5 minutes
            pageTimeout: options.pageTimeout || 30000, // 30 seconds
        }

        // Start cleanup interval
        this.startCleanupInterval()
    }

    /**
     * Initialize a new browser instance
     */
    async initializeBrowser(): Promise<BrowserInstance> {
        try {
            const browser = await chromium.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                ],
            })

            const context = await browser.newContext({
                ignoreHTTPSErrors: true,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            })

            const instance: BrowserInstance = {
                browser,
                context,
                activePagesCount: 0,
                createdAt: new Date(),
                lastUsed: new Date(),
            }

            logger.info('Browser instance initialized successfully')
            return instance
        } catch (error) {
            logger.error('Failed to initialize browser instance', { error })
            throw new Error(`Failed to initialize browser: ${error.message}`)
        }
    }

    /**
     * Get an available browser instance from the pool
     */
    private async getAvailableBrowserInstance(): Promise<BrowserInstance> {
        // Find an existing browser with available capacity
        for (const [, instance] of this.browserPool) {
            if (instance.activePagesCount < this.poolOptions.maxPagesPerBrowser) {
                instance.lastUsed = new Date()
                return instance
            }
        }

        // Create new browser if pool limit not reached (accounting for browsers being created)
        const totalBrowsers = this.browserPool.size + this.creatingBrowsers.size
        if (totalBrowsers < this.poolOptions.maxBrowsers) {
            const creationId = `creating_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            this.creatingBrowsers.add(creationId)

            try {
                const instance = await this.initializeBrowser()
                const id = `browser_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
                this.browserPool.set(id, instance)
                this.creatingBrowsers.delete(creationId)
                return instance
            } catch (error) {
                this.creatingBrowsers.delete(creationId)
                throw error
            }
        }

        // Wait for an available browser (with exponential backoff)
        let waitTime = 100
        let attempts = 0
        const maxAttempts = 50

        while (attempts < maxAttempts) {
            await new Promise(resolve => setTimeout(resolve, waitTime))

            // Check again for available browser
            for (const [_, instance] of this.browserPool) {
                if (instance.activePagesCount < this.poolOptions.maxPagesPerBrowser) {
                    instance.lastUsed = new Date()
                    return instance
                }
            }

            attempts++
            waitTime = Math.min(waitTime * 1.5, 1000) // Cap at 1 second
        }

        throw new Error('No available browser instances after maximum wait time')
    }

    /**
     * Create a new page with specified options
     */
    async createPage(options: PageOptions): Promise<{ page: Page; cleanup: () => Promise<void> }> {
        const instance = await this.getAvailableBrowserInstance()

        try {
            const page = await instance.context.newPage()
            instance.activePagesCount++

            // Configure viewport
            await page.setViewportSize({
                width: options.width,
                height: options.height,
            })

            // Set timeout
            page.setDefaultTimeout(options.timeout)
            page.setDefaultNavigationTimeout(options.timeout)

            const cleanup = async () => {
                try {
                    await page.close()
                    instance.activePagesCount--
                    instance.lastUsed = new Date()
                    logger.debug('Page closed successfully')
                } catch (error) {
                    logger.error('Error closing page', { error })
                }
            }

            logger.debug('Page created successfully', {
                width: options.width,
                height: options.height,
                timeout: options.timeout,
            })

            return { page, cleanup }
        } catch (error) {
            logger.error('Failed to create page', { error })
            throw new Error(`Failed to create page: ${error.message}`)
        }
    }

    /**
     * Close a specific browser instance
     */
    private async closeBrowserInstance(instance: BrowserInstance): Promise<void> {
        try {
            await instance.context.close()
            await instance.browser.close()
            logger.debug('Browser instance closed successfully')
        } catch (error) {
            logger.error('Error closing browser instance', { error })
        }
    }

    /**
     * Clean up expired browser instances
     */
    private async cleanupExpiredBrowsers(): Promise<void> {
        const now = new Date()
        const expiredInstances: string[] = []

        for (const [id, instance] of this.browserPool) {
            const timeSinceLastUse = now.getTime() - instance.lastUsed.getTime()

            if (timeSinceLastUse > this.poolOptions.browserTimeout && instance.activePagesCount === 0) {
                expiredInstances.push(id)
            }
        }

        for (const id of expiredInstances) {
            const instance = this.browserPool.get(id)
            if (instance) {
                await this.closeBrowserInstance(instance)
                this.browserPool.delete(id)
                logger.debug('Expired browser instance cleaned up', { id })
            }
        }
    }

    /**
     * Start the cleanup interval
     */
    private startCleanupInterval(): void {
        this.cleanupInterval = setInterval(async () => {
            await this.cleanupExpiredBrowsers()
        }, 60000) // Run every minute
    }

    /**
     * Get browser pool statistics
     */
    getPoolStats(): {
        totalBrowsers: number
        totalActivePages: number
        maxBrowsers: number
        maxPagesPerBrowser: number
    } {
        let totalActivePages = 0
        for (const instance of this.browserPool.values()) {
            totalActivePages += instance.activePagesCount
        }

        return {
            totalBrowsers: this.browserPool.size,
            totalActivePages,
            maxBrowsers: this.poolOptions.maxBrowsers,
            maxPagesPerBrowser: this.poolOptions.maxPagesPerBrowser,
        }
    }

    /**
     * Check if the browser service is healthy
     */
    async healthCheck(): Promise<{ healthy: boolean; details: any }> {
        try {
            const stats = this.getPoolStats()

            // Try to create a test page
            const testPage = await this.createPage({
                width: 1280,
                height: 720,
                timeout: 5000,
            })

            await testPage.cleanup()

            return {
                healthy: true,
                details: {
                    ...stats,
                    lastCleanup: new Date().toISOString(),
                },
            }
        } catch (error) {
            logger.error('Browser service health check failed', { error })
            return {
                healthy: false,
                details: {
                    error: error.message,
                    poolStats: this.getPoolStats(),
                },
            }
        }
    }

    /**
     * Gracefully shutdown the browser service
     */
    async shutdown(): Promise<void> {
        logger.info('Shutting down browser service...')

        // Clear cleanup interval
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval)
            this.cleanupInterval = null
        }

        // Close all browser instances
        const shutdownPromises: Promise<void>[] = []
        for (const [_, instance] of this.browserPool) {
            shutdownPromises.push(this.closeBrowserInstance(instance))
        }

        await Promise.all(shutdownPromises)
        this.browserPool.clear()
        this.creatingBrowsers.clear()

        logger.info('Browser service shutdown completed')
    }
}

// Create singleton instance
export const browserService = new BrowserService()