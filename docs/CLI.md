# CLI Commands

This document describes the available CLI commands for Web2Img administration.

## User Management Commands

### Create User

Create a new user account using the command line interface.

#### Interactive Mode

```bash
node ace create:user
```

This will prompt you for:
- Full name
- Email address  
- Password (with confirmation)

#### Non-Interactive Mode

```bash
node ace create:user --non-interactive --name "John Doe" --email "john@example.com" --password "securepass123"
```

**Flags:**
- `--name` - Full name of the user (required in non-interactive mode)
- `--email` - Email address of the user (required in non-interactive mode)
- `--password` - Password for the user (required in non-interactive mode)
- `--non-interactive` - Skip interactive prompts

**Examples:**

```bash
# Interactive mode (recommended for manual user creation)
node ace create:user

# Non-interactive mode (useful for scripts)
node ace create:user --non-interactive \
  --name "Administrator" \
  --email "admin@company.com" \
  --password "MySecurePassword123"

# Get help
node ace create:user --help
```

**Validation:**
- Full name: 1-100 characters, required
- Email: Valid email format, must be unique
- Password: 6-100 characters, required

### List Users

Display all user accounts in the system.

```bash
node ace list:users
```

**Output includes:**
- User ID
- Full Name
- Email Address
- Created Date
- Last Updated Date

**Example output:**
```
[ info ] Loading user accounts...
[ success ] Found 3 user(s):

ID | Full Name      | Email                   | Created    | Last Updated
-------------------------------------------------------------------------
3  | Test User      | test@example.com        | 2025-07-26 | 2025-07-26  
2  | Muhammad Irfan | mrfansi17@gmail.com     | 2025-07-26 | 2025-07-26  
1  | Dashboard User | dashboard@web2img.local | 2025-07-26 | 2025-07-26  

[ info ] Total users: 3
```

## Usage Scenarios

### Initial Setup

When setting up a new Web2Img installation, create the first admin user:

```bash
node ace create:user --non-interactive \
  --name "System Administrator" \
  --email "admin@yourcompany.com" \
  --password "YourSecurePassword123"
```

### Bulk User Creation

For creating multiple users, use a script:

```bash
#!/bin/bash
# create-users.sh

users=(
  "John Doe:john@company.com:password123"
  "Jane Smith:jane@company.com:password456"
  "Bob Wilson:bob@company.com:password789"
)

for user in "${users[@]}"; do
  IFS=':' read -r name email password <<< "$user"
  node ace create:user --non-interactive \
    --name "$name" \
    --email "$email" \
    --password "$password"
done
```

### User Auditing

List all users to audit accounts:

```bash
# List all users
node ace list:users

# Count total users
node ace list:users | grep "Total users:"
```

## Error Handling

The CLI commands provide proper exit codes:
- **Exit Code 0**: Success
- **Exit Code 1**: Error (validation failed, user exists, etc.)

This makes them suitable for use in automated scripts and CI/CD pipelines.

## Security Notes

1. **Password Security**: Use strong passwords (minimum 6 characters)
2. **Email Uniqueness**: Each user must have a unique email address
3. **Command History**: Be careful when using `--password` flag as it may appear in command history
4. **Interactive Mode**: Preferred for manual user creation as passwords are securely prompted
5. **Script Usage**: For automated scripts, consider reading passwords from environment variables or secure files

## Integration with Dashboard

Users created via CLI can immediately:
- Log in to the dashboard at `/auth/login`
- Create and manage API keys
- Create additional users through the web interface
- Access all dashboard features

The CLI commands complement the dashboard user management features and provide a scriptable interface for administrative tasks.
