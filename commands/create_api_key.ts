import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import ApiKey from '#models/api_key'
import User from '#models/user'

export default class CreateApiKey extends BaseCommand {
  static commandName = 'create:api-key'
  static description = 'Create a new API key for a user'

  static options: CommandOptions = {
    startApp: true,
    allowUnknownFlags: false,
    staysAlive: false,
  }

  @flags.string({ description: 'Name for the API key' })
  declare name: string

  @flags.string({ description: 'Email of the user to create the API key for' })
  declare email: string

  @flags.number({ description: 'Rate limit for the API key (requests per hour)' })
  declare rateLimit: number

  async run() {
    const { name, email, rateLimit } = this

    // Validate required flags
    if (!name || !email) {
      this.logger.error('Both --name and --email are required')
      this.exitCode = 1
      return
    }

    try {
      // Find the user
      const user = await User.findBy('email', email.trim().toLowerCase())
      if (!user) {
        this.logger.error(`User with email "${email}" not found`)
        this.exitCode = 1
        return
      }

      // Create the API key
      const apiKey = await ApiKey.createForUser(
        user.id,
        name.trim(),
        rateLimit || 1000
      )

      this.logger.success('API key created successfully!')
      this.logger.info(`ID: ${apiKey.id}`)
      this.logger.info(`Name: ${apiKey.name}`)
      this.logger.info(`Key: ${apiKey.key}`)
      this.logger.info(`Rate Limit: ${apiKey.rateLimit} requests/hour`)
      this.logger.info(`User: ${user.fullName} (${user.email})`)
      this.logger.info(`Created: ${apiKey.createdAt.toLocaleString()}`)
    } catch (error) {
      this.logger.error('Failed to create API key:')
      this.logger.error(error.message)
      this.exitCode = 1
    }
  }
}
