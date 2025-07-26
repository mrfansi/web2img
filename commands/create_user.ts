import { BaseCommand, flags } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import User from '#models/user'

export default class CreateUser extends BaseCommand {
    static commandName = 'create:user'
    static description = 'Create a new user account'

    static options: CommandOptions = {
        startApp: true,
        allowUnknownFlags: false,
        staysAlive: false,
    }

    @flags.string({ description: 'Full name of the user' })
    declare name: string

    @flags.string({ description: 'Email address of the user' })
    declare email: string

    @flags.string({ description: 'Password for the user' })
    declare password: string

    @flags.boolean({ description: 'Skip interactive prompts (requires --name, --email, --password)' })
    declare nonInteractive: boolean

    /**
     * Execute the create:user command
     */
    async run(): Promise<void> {
        this.logger.info('Creating new user account...')

        let fullName: string
        let email: string
        let password: string

        if (this.nonInteractive) {
            // Non-interactive mode - use flags
            if (!this.name || !this.email || !this.password) {
                this.logger.error('Non-interactive mode requires --name, --email, and --password flags')
                this.exitCode = 1
                return
            }

            fullName = this.name
            email = this.email
            password = this.password

            // Validate inputs
            if (fullName.trim().length === 0 || fullName.trim().length > 100) {
                this.logger.error('Full name must be between 1 and 100 characters')
                this.exitCode = 1
                return
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
            if (!emailRegex.test(email)) {
                this.logger.error('Please provide a valid email address')
                this.exitCode = 1
                return
            }

            if (password.length < 6 || password.length > 100) {
                this.logger.error('Password must be between 6 and 100 characters')
                this.exitCode = 1
                return
            }

        } else {
            // Interactive mode - prompt for details
            fullName = await this.prompt.ask('Enter full name', {
                validate: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Full name is required'
                    }
                    if (value.trim().length > 100) {
                        return 'Full name must be less than 100 characters'
                    }
                    return true
                }
            })

            email = await this.prompt.ask('Enter email address', {
                validate: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Email is required'
                    }

                    // Basic email validation
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
                    if (!emailRegex.test(value)) {
                        return 'Please enter a valid email address'
                    }

                    return true
                }
            })

            password = await this.prompt.secure('Enter password (minimum 6 characters)', {
                validate: (value) => {
                    if (!value || value.length < 6) {
                        return 'Password must be at least 6 characters long'
                    }
                    if (value.length > 100) {
                        return 'Password must be less than 100 characters'
                    }
                    return true
                }
            })

            await this.prompt.secure('Confirm password', {
                validate: (value) => {
                    if (value !== password) {
                        return 'Passwords do not match'
                    }
                    return true
                }
            })

            // Password confirmation successful, proceed with user creation
        }

        // Check if user already exists
        const existingUser = await User.findBy('email', email.trim())
        if (existingUser) {
            this.logger.error(`User with email "${email}" already exists`)
            this.exitCode = 1
            return
        }

        try {
            // Create the user
            const user = await User.create({
                fullName: fullName.trim(),
                email: email.trim().toLowerCase(),
                password: password
            })

            this.logger.success(`User created successfully!`)
            this.logger.info(`ID: ${user.id}`)
            this.logger.info(`Name: ${user.fullName}`)
            this.logger.info(`Email: ${user.email}`)
            this.logger.info(`Created: ${user.createdAt.toLocaleString()}`)

        } catch (error) {
            this.logger.error('Failed to create user:')
            this.logger.error(error.message)
            this.exitCode = 1
        }
    }
}
