# Project Structure

## Root Directory
```
├── app/                    # Application logic
├── bin/                    # Executable scripts
├── config/                 # Configuration files
├── database/               # Database related files
├── start/                  # Application bootstrap
├── tests/                  # Test files
└── .kiro/                  # Kiro IDE configuration
```

## Application Directory (`app/`)
```
app/
├── controllers/            # HTTP request handlers
├── exceptions/             # Custom exception classes
├── middleware/             # HTTP middleware
├── models/                 # Database models (Lucid ORM)
├── services/               # Business logic services
├── validators/             # Request validation schemas
├── policies/               # Authorization policies
├── abilities/              # User abilities/permissions
├── events/                 # Event classes
├── listeners/              # Event listeners
└── mails/                  # Email templates
```

## Import Path Aliases
The project uses import maps for clean imports:
- `#controllers/*` → `./app/controllers/*.js`
- `#models/*` → `./app/models/*.js`
- `#middleware/*` → `./app/middleware/*.js`
- `#services/*` → `./app/services/*.js`
- `#validators/*` → `./app/validators/*.js`
- `#config/*` → `./config/*.js`
- `#database/*` → `./database/*.js`
- `#start/*` → `./start/*.js`
- `#tests/*` → `./tests/*.js`

## Key Files
- `adonisrc.ts` - AdonisJS configuration
- `start/routes.ts` - Route definitions
- `start/kernel.ts` - Middleware registration
- `start/env.ts` - Environment validation
- `database/migrations/` - Database schema changes

## Naming Conventions
- **Files**: snake_case for migrations, camelCase for others
- **Classes**: PascalCase (e.g., `AuthMiddleware`, `User`)
- **Methods**: camelCase
- **Database**: snake_case for tables and columns
- **Routes**: kebab-case URLs preferred

## Architecture Patterns
- **MVC Pattern**: Models, Controllers, Views (API responses)
- **Middleware Pipeline**: Request processing through middleware stack
- **Service Layer**: Business logic separated from controllers
- **Repository Pattern**: Data access through Lucid ORM models
- **Event-Driven**: Events and listeners for decoupled operations