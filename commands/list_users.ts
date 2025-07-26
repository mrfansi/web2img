import { BaseCommand } from '@adonisjs/core/ace'
import type { CommandOptions } from '@adonisjs/core/types/ace'
import User from '#models/user'

export default class ListUsers extends BaseCommand {
    static commandName = 'list:users'
    static description = 'List all user accounts'

    static options: CommandOptions = {
        startApp: true,
        allowUnknownFlags: false,
        staysAlive: false,
    }

    /**
     * Execute the list:users command
     */
    async run(): Promise<void> {
        this.logger.info('Loading user accounts...')

        try {
            const users = await User.query()
                .select('id', 'fullName', 'email', 'createdAt', 'updatedAt')
                .orderBy('createdAt', 'desc')

            if (users.length === 0) {
                this.logger.warning('No users found')
                return
            }

            this.logger.success(`Found ${users.length} user(s):`)
            console.log('')

            // Create a table-like output
            const tableData = users.map(user => ({
                ID: user.id.toString(),
                'Full Name': user.fullName || '-',
                Email: user.email,
                Created: user.createdAt.toFormat('yyyy-MM-dd'),
                'Last Updated': user.updatedAt?.toFormat('yyyy-MM-dd') || '-'
            }))

            // Simple table formatting
            const headers = ['ID', 'Full Name', 'Email', 'Created', 'Last Updated']
            const columnWidths = headers.map(header => {
                return Math.max(
                    header.length,
                    ...tableData.map(row => (row[header as keyof typeof row] || '').length)
                )
            })

            // Print header
            const headerRow = headers.map((header, i) =>
                header.padEnd(columnWidths[i])
            ).join(' | ')
            console.log(headerRow)
            console.log('-'.repeat(headerRow.length))

            // Print rows
            tableData.forEach(row => {
                const dataRow = headers.map((header, i) =>
                    (row[header as keyof typeof row] || '').padEnd(columnWidths[i])
                ).join(' | ')
                console.log(dataRow)
            })

            console.log('')
            this.logger.info(`Total users: ${users.length}`)

        } catch (error) {
            this.logger.error('Failed to load users:')
            this.logger.error(error.message)
            this.exitCode = 1
        }
    }
}
