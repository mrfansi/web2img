import logger from '@adonisjs/core/services/logger'
import ErrorLog, { ErrorLevel } from '#models/error_log'
import type { HttpContext } from '@adonisjs/core/http'
import { randomUUID } from 'node:crypto'

export interface ServiceTrace {
  serviceName: string
  methodName: string
  startTime: number
  endTime?: number
  duration?: number
  success?: boolean
  errorMessage?: string
}

export interface ErrorTrace {
  traceId: string
  parentTraceId?: string
  serviceStack: ServiceTrace[]
  errorChain: Array<{
    service: string
    method: string
    error: string
    timestamp: number
  }>
  rootCause?: {
    service: string
    method: string
    error: string
  }
}

export interface ErrorLogOptions {
  level?: ErrorLevel
  context?: Record<string, any>
  endpoint?: string
  method?: string
  userAgent?: string
  ipAddress?: string
  correlationId?: string
  apiKeyId?: number | null
  traceId?: string
  parentTraceId?: string
  serviceName?: string
  serviceMethod?: string
  errorTrace?: ErrorTrace
  performanceMetrics?: {
    duration?: number
    memoryUsage?: number
    cpuUsage?: number
  }
  errorCategory?: 'system' | 'business' | 'validation' | 'external' | 'performance'
  severity?: 'low' | 'medium' | 'high' | 'critical'
}

/**
 * Enhanced service for logging errors with comprehensive tracing capabilities
 */
export class ErrorLoggingService {
  private static activeTraces = new Map<string, ErrorTrace>()
  private static serviceCallStack = new Map<string, ServiceTrace[]>()

  /**
   * Generate a new trace ID
   */
  static generateTraceId(): string {
    return randomUUID()
  }

  /**
   * Start a service trace
   */
  static startServiceTrace(
    traceId: string,
    serviceName: string,
    methodName: string,
    parentTraceId?: string
  ): void {
    const trace: ServiceTrace = {
      serviceName,
      methodName,
      startTime: Date.now(),
    }

    // Initialize or update the service call stack
    if (!this.serviceCallStack.has(traceId)) {
      this.serviceCallStack.set(traceId, [])
    }
    this.serviceCallStack.get(traceId)!.push(trace)

    // Initialize or update the error trace
    if (!this.activeTraces.has(traceId)) {
      this.activeTraces.set(traceId, {
        traceId,
        parentTraceId,
        serviceStack: [],
        errorChain: [],
      })
    }
  }

  /**
   * End a service trace
   */
  static endServiceTrace(
    traceId: string,
    serviceName: string,
    methodName: string,
    success: boolean = true,
    errorMessage?: string
  ): void {
    const stack = this.serviceCallStack.get(traceId)
    if (stack) {
      const trace = stack.find(t => t.serviceName === serviceName && t.methodName === methodName && !t.endTime)
      if (trace) {
        trace.endTime = Date.now()
        trace.duration = trace.endTime - trace.startTime
        trace.success = success
        trace.errorMessage = errorMessage

        // Update the active trace
        const activeTrace = this.activeTraces.get(traceId)
        if (activeTrace) {
          activeTrace.serviceStack = [...stack]

          if (!success && errorMessage) {
            activeTrace.errorChain.push({
              service: serviceName,
              method: methodName,
              error: errorMessage,
              timestamp: Date.now(),
            })

            // Set root cause if this is the first error
            if (!activeTrace.rootCause) {
              activeTrace.rootCause = {
                service: serviceName,
                method: methodName,
                error: errorMessage,
              }
            }
          }
        }
      }
    }
  }

  /**
   * Get trace information
   */
  static getTrace(traceId: string): ErrorTrace | undefined {
    return this.activeTraces.get(traceId)
  }

  /**
   * Clean up old traces (call periodically)
   */
  static cleanupTraces(maxAge: number = 300000): void { // 5 minutes default
    const now = Date.now()
    for (const [traceId, trace] of this.activeTraces.entries()) {
      const lastActivity = Math.max(
        ...trace.serviceStack.map(s => s.endTime || s.startTime),
        ...trace.errorChain.map(e => e.timestamp)
      )

      if (now - lastActivity > maxAge) {
        this.activeTraces.delete(traceId)
        this.serviceCallStack.delete(traceId)
      }
    }
  }
  /**
   * Log an error to both application logger and database with enhanced tracing
   */
  static async logError(
    error: Error | string,
    options: ErrorLogOptions = {},
    ctx?: HttpContext
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : error
    const errorStack = error instanceof Error ? error.stack : undefined
    const level = options.level || ErrorLevel.ERROR

    // Generate trace ID if not provided
    const traceId = options.traceId || this.generateTraceId()

    // Extract context information from HttpContext if provided
    let contextData = options.context || {}
    let endpoint = options.endpoint
    let method = options.method
    let userAgent = options.userAgent
    let ipAddress = options.ipAddress
    let correlationId = options.correlationId
    let apiKeyId = options.apiKeyId

    if (ctx) {
      endpoint = endpoint || ctx.request.url()
      method = method || ctx.request.method()
      userAgent = userAgent || ctx.request.header('user-agent')
      ipAddress = ipAddress || ctx.request.ip()
      correlationId = correlationId || ctx.correlationId
      apiKeyId = apiKeyId || ctx.apiKey?.id || null
    }

    // End service trace if service information is provided
    if (options.serviceName && options.serviceMethod) {
      this.endServiceTrace(traceId, options.serviceName, options.serviceMethod, false, errorMessage)
    }

    // Get trace information
    const errorTrace = options.errorTrace || this.getTrace(traceId)

    // Enhanced context with tracing information
    const enhancedContext = {
      ...contextData,
      tracing: {
        traceId,
        parentTraceId: options.parentTraceId,
        serviceName: options.serviceName,
        serviceMethod: options.serviceMethod,
        errorTrace: errorTrace ? {
          serviceStack: errorTrace.serviceStack,
          errorChain: errorTrace.errorChain,
          rootCause: errorTrace.rootCause,
        } : undefined,
        performanceMetrics: options.performanceMetrics,
      },
      errorCategory: options.errorCategory || 'system',
      severity: options.severity || 'medium',
    }

    // Log to application logger with enhanced context
    logger.error('Error occurred with trace', {
      level,
      message: errorMessage,
      stack: errorStack,
      context: enhancedContext,
      endpoint,
      method,
      userAgent,
      ipAddress,
      correlationId,
      apiKeyId,
      traceId,
    })

    // Save to database for dashboard
    try {
      await ErrorLog.logError({
        level,
        message: errorMessage,
        stack: errorStack,
        context: enhancedContext,
        endpoint,
        method,
        userAgent,
        ipAddress,
        correlationId,
        apiKeyId,
      })
    } catch (dbError) {
      logger.error('Failed to save error to database', {
        originalError: errorMessage,
        dbError: dbError instanceof Error ? dbError.message : String(dbError),
        traceId,
      })
    }
  }

  /**
   * Log a warning to both application logger and database
   */
  static async logWarning(
    message: string,
    options: ErrorLogOptions = {},
    ctx?: HttpContext
  ): Promise<void> {
    await this.logError(message, { ...options, level: ErrorLevel.WARN }, ctx)
  }

  /**
   * Log a fatal error to both application logger and database
   */
  static async logFatal(
    error: Error | string,
    options: ErrorLogOptions = {},
    ctx?: HttpContext
  ): Promise<void> {
    await this.logError(error, { ...options, level: ErrorLevel.FATAL }, ctx)
  }

  /**
   * Log an HTTP error based on status code
   */
  static async logHttpError(
    statusCode: number,
    message: string,
    options: ErrorLogOptions = {},
    ctx?: HttpContext
  ): Promise<void> {
    const level = statusCode >= 500 ? ErrorLevel.ERROR : ErrorLevel.WARN
    const errorMessage = `HTTP ${statusCode}: ${message}`

    await this.logError(errorMessage, {
      ...options,
      level,
      context: {
        ...options.context,
        statusCode,
      },
    }, ctx)
  }

  /**
   * Log a service error with enhanced tracing
   */
  static async logServiceError(
    serviceName: string,
    methodName: string,
    error: Error | string,
    options: ErrorLogOptions = {},
    traceId?: string
  ): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : error
    const currentTraceId = traceId || options.traceId || this.generateTraceId()

    // End the service trace
    this.endServiceTrace(currentTraceId, serviceName, methodName, false, errorMessage)

    const contextData = {
      ...options.context,
      service: serviceName,
      method: methodName,
      serviceType: 'internal',
    }

    await this.logError(error, {
      ...options,
      context: contextData,
      serviceName,
      serviceMethod: methodName,
      traceId: currentTraceId,
      errorCategory: options.errorCategory || 'system',
      severity: options.severity || 'medium',
    })
  }

  /**
   * Log a controller error with standardized format
   */
  static async logControllerError(
    controllerName: string,
    methodName: string,
    error: Error | string,
    options: ErrorLogOptions = {},
    ctx?: HttpContext
  ): Promise<void> {
    const contextData = {
      ...options.context,
      controller: controllerName,
      method: methodName,
      layer: 'controller',
    }

    await this.logError(error, {
      ...options,
      context: contextData,
      errorCategory: options.errorCategory || 'business',
      severity: options.severity || 'medium',
    }, ctx)
  }

  /**
   * Log an external service error
   */
  static async logExternalServiceError(
    serviceName: string,
    methodName: string,
    error: Error | string,
    options: ErrorLogOptions = {},
    traceId?: string
  ): Promise<void> {
    const currentTraceId = traceId || options.traceId || this.generateTraceId()

    const contextData = {
      ...options.context,
      externalService: serviceName,
      method: methodName,
      serviceType: 'external',
    }

    await this.logError(error, {
      ...options,
      context: contextData,
      serviceName,
      serviceMethod: methodName,
      traceId: currentTraceId,
      errorCategory: 'external',
      severity: options.severity || 'high',
    })
  }

  /**
   * Wrap a service method with automatic error logging and tracing
   */
  static async wrapServiceMethod<T>(
    serviceName: string,
    methodName: string,
    serviceMethod: () => Promise<T>,
    options: {
      traceId?: string
      parentTraceId?: string
      context?: Record<string, any>
      errorCategory?: 'system' | 'business' | 'validation' | 'external' | 'performance'
      performanceThreshold?: number
    } = {}
  ): Promise<T> {
    const traceId = options.traceId || this.generateTraceId()
    const startTime = Date.now()

    // Start service trace
    this.startServiceTrace(traceId, serviceName, methodName, options.parentTraceId)

    try {
      const result = await serviceMethod()
      const duration = Date.now() - startTime

      // End successful trace
      this.endServiceTrace(traceId, serviceName, methodName, true)

      // Log performance warning if threshold exceeded
      if (options.performanceThreshold && duration > options.performanceThreshold) {
        await this.logPerformanceError(
          serviceName,
          methodName,
          `Method execution exceeded threshold: ${duration}ms > ${options.performanceThreshold}ms`,
          { duration },
          { context: options.context },
          traceId
        )
      }

      return result
    } catch (error) {
      const duration = Date.now() - startTime

      // Log service error with tracing
      await this.logServiceError(
        serviceName,
        methodName,
        error,
        {
          context: {
            ...options.context,
            duration,
          },
          errorCategory: options.errorCategory,
          performanceMetrics: { duration },
        },
        traceId
      )

      throw error
    }
  }

  /**
   * Log a performance-related error
   */
  static async logPerformanceError(
    serviceName: string,
    methodName: string,
    error: Error | string,
    performanceMetrics: {
      duration: number
      memoryUsage?: number
      cpuUsage?: number
    },
    options: ErrorLogOptions = {},
    traceId?: string
  ): Promise<void> {
    const currentTraceId = traceId || options.traceId || this.generateTraceId()

    const contextData = {
      ...options.context,
      service: serviceName,
      method: methodName,
      performanceIssue: true,
    }

    await this.logError(error, {
      ...options,
      context: contextData,
      serviceName,
      serviceMethod: methodName,
      traceId: currentTraceId,
      performanceMetrics,
      errorCategory: 'performance',
      severity: performanceMetrics.duration > 10000 ? 'critical' : 'high',
    })
  }
}

export default ErrorLoggingService
