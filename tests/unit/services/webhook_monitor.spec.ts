import { test } from '@japa/runner'
import { WebhookMonitor } from '#services/webhook_monitor'
import type { WebhookMonitorConfig } from '#services/webhook_monitor'

test.group('WebhookMonitor', (group) => {
  let monitor: WebhookMonitor

  group.setup(() => {
    monitor = WebhookMonitor.getInstance()
  })

  group.teardown(() => {
    // Ensure monitoring is stopped after tests
    monitor.stopMonitoring()
  })

  test('should be a singleton', ({ assert }) => {
    const instance1 = WebhookMonitor.getInstance()
    const instance2 = WebhookMonitor.getInstance()
    
    assert.strictEqual(instance1, instance2)
  })

  test('should start and stop monitoring', ({ assert }) => {
    assert.isFalse(monitor.isActive())
    
    monitor.startMonitoring()
    assert.isTrue(monitor.isActive())
    
    monitor.stopMonitoring()
    assert.isFalse(monitor.isActive())
  })

  test('should not start monitoring if already running', ({ assert }) => {
    monitor.startMonitoring()
    assert.isTrue(monitor.isActive())
    
    // Should not throw or cause issues
    monitor.startMonitoring()
    assert.isTrue(monitor.isActive())
    
    monitor.stopMonitoring()
  })

  test('should update monitoring configuration', ({ assert }) => {
    const originalConfig = monitor.getConfig()
    
    const newConfig: Partial<WebhookMonitorConfig> = {
      successRateThreshold: 0.9,
      failureCountThreshold: 5
    }
    
    monitor.updateConfig(newConfig)
    
    const updatedConfig = monitor.getConfig()
    assert.equal(updatedConfig.successRateThreshold, 0.9)
    assert.equal(updatedConfig.failureCountThreshold, 5)
    
    // Other values should remain unchanged
    assert.equal(updatedConfig.timeWindowMinutes, originalConfig.timeWindowMinutes)
    assert.equal(updatedConfig.checkIntervalMinutes, originalConfig.checkIntervalMinutes)
  })

  test('should get health status', async ({ assert }) => {
    const healthStatus = await monitor.getHealthStatus()
    
    assert.isObject(healthStatus)
    assert.property(healthStatus, 'status')
    assert.property(healthStatus, 'stats')
    assert.property(healthStatus, 'alerts')
    
    assert.include(['healthy', 'degraded', 'unhealthy'], healthStatus.status)
    assert.isArray(healthStatus.alerts)
    
    // Stats should have expected properties
    assert.isNumber(healthStatus.stats.totalDeliveries)
    assert.isNumber(healthStatus.stats.successfulDeliveries)
    assert.isNumber(healthStatus.stats.failedDeliveries)
    assert.isNumber(healthStatus.stats.averageAttempts)
    assert.isNumber(healthStatus.stats.successRate)
    assert.isArray(healthStatus.stats.commonErrors)
  })

  test('should get failure report', async ({ assert }) => {
    const failureReport = await monitor.getFailureReport(10)
    
    assert.isObject(failureReport)
    assert.property(failureReport, 'recentFailures')
    assert.property(failureReport, 'commonIssues')
    assert.property(failureReport, 'recommendations')
    
    assert.isArray(failureReport.recentFailures)
    assert.isArray(failureReport.commonIssues)
    assert.isArray(failureReport.recommendations)
    
    // Common issues should have expected structure
    failureReport.commonIssues.forEach(issue => {
      assert.property(issue, 'issue')
      assert.property(issue, 'count')
      assert.property(issue, 'examples')
      assert.isString(issue.issue)
      assert.isNumber(issue.count)
      assert.isArray(issue.examples)
    })
    
    // Recommendations should be strings
    failureReport.recommendations.forEach(rec => {
      assert.isString(rec)
    })
  })

  test('should handle monitoring with custom configuration', ({ assert }) => {
    const customConfig: Partial<WebhookMonitorConfig> = {
      successRateThreshold: 0.95,
      failureCountThreshold: 3,
      timeWindowMinutes: 30,
      checkIntervalMinutes: 5
    }
    
    monitor.startMonitoring(customConfig)
    
    const config = monitor.getConfig()
    assert.equal(config.successRateThreshold, 0.95)
    assert.equal(config.failureCountThreshold, 3)
    assert.equal(config.timeWindowMinutes, 30)
    assert.equal(config.checkIntervalMinutes, 5)
    
    monitor.stopMonitoring()
  })

  test('should restart monitoring when config is updated while running', ({ assert }) => {
    monitor.startMonitoring()
    assert.isTrue(monitor.isActive())
    
    const newConfig: Partial<WebhookMonitorConfig> = {
      checkIntervalMinutes: 10
    }
    
    monitor.updateConfig(newConfig)
    
    // Should still be monitoring after config update
    assert.isTrue(monitor.isActive())
    assert.equal(monitor.getConfig().checkIntervalMinutes, 10)
    
    monitor.stopMonitoring()
  })

  test('should handle errors gracefully during monitoring', async ({ assert }) => {
    // Start monitoring
    monitor.startMonitoring({
      checkIntervalMinutes: 0.01 // Very short interval for testing
    })
    
    // Wait a bit to let monitoring run
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Should still be active even if there are errors
    assert.isTrue(monitor.isActive())
    
    monitor.stopMonitoring()
  })

  test('should generate appropriate recommendations', async ({ assert }) => {
    const failureReport = await monitor.getFailureReport()
    
    // Recommendations should be helpful strings
    failureReport.recommendations.forEach(recommendation => {
      assert.isString(recommendation)
      assert.isAbove(recommendation.length, 10) // Should be meaningful
    })
  })

  test('should provide configuration getter', ({ assert }) => {
    const config = monitor.getConfig()
    
    assert.isObject(config)
    assert.property(config, 'successRateThreshold')
    assert.property(config, 'failureCountThreshold')
    assert.property(config, 'timeWindowMinutes')
    assert.property(config, 'checkIntervalMinutes')
    
    assert.isNumber(config.successRateThreshold)
    assert.isNumber(config.failureCountThreshold)
    assert.isNumber(config.timeWindowMinutes)
    assert.isNumber(config.checkIntervalMinutes)
    
    // Values should be reasonable
    assert.isAbove(config.successRateThreshold, 0)
    assert.isAtMost(config.successRateThreshold, 1)
    assert.isAbove(config.failureCountThreshold, 0)
    assert.isAbove(config.timeWindowMinutes, 0)
    assert.isAbove(config.checkIntervalMinutes, 0)
  })

  test('should handle health status with different conditions', async ({ assert }) => {
    // Test with default configuration
    const healthStatus1 = await monitor.getHealthStatus()
    assert.include(['healthy', 'degraded', 'unhealthy'], healthStatus1.status)
    
    // Test with stricter configuration
    monitor.updateConfig({
      successRateThreshold: 0.99,
      failureCountThreshold: 1
    })
    
    const healthStatus2 = await monitor.getHealthStatus()
    assert.include(['healthy', 'degraded', 'unhealthy'], healthStatus2.status)
  })
})