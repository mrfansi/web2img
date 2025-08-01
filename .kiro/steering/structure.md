# Project Structure

## Root Directory

```
├── app/                    # Application source code
├── bin/                    # Executable scripts
├── commands/               # Custom Ace commands
├── config/                 # Configuration files
├── database/               # Database migrations and seeders
├── docs/                   # Documentation
├── resources/              # Views and static assets
├── scripts/                # Deployment and utility scripts
├── start/                  # Application bootstrap files
├── storage/                # File storage (screenshots, cache, temp)
├── tests/                  # Test suites
└── [config files]         # Root configuration files
```

## App Directory Structure

```
app/
├── controllers/            # HTTP request handlers
├── contracts/              # TypeScript interfaces and contracts
├── dtos/                   # Data Transfer Objects
├── exceptions/             # Custom exception classes
├── middleware/             # HTTP middleware
├── models/                 # Database models (Lucid ORM)
├── services/               # Business logic and external integrations
├── types/                  # TypeScript type definitions
└── validators/             # Request validation schemas
```

## Key Directories

### Controllers (`app/controllers/`)

- HTTP request handlers following AdonisJS conventions
- Each controller handles related endpoints
- Use dependency injection for services
- Examples: `screenshot_controller.ts`, `dashboard_controller.ts`

### Services (`app/services/`)

- Business logic and external service integrations
- Singleton pattern for shared services
- Key services: `browser_service.ts`, `cache_service.ts`, `central_redis_manager.ts`
- Worker services for background processing

### Models (`app/models/`)

- Lucid ORM models representing database entities
- Follow AdonisJS model conventions
- Examples: `user.ts`, `api_key.ts`, `batch_job.ts`

### Middleware (`app/middleware/`)

- HTTP middleware for cross-cutting concerns
- Authentication, rate limiting, logging, metrics
- Applied via `start/kernel.ts`

### Types (`app/types/`)

- TypeScript type definitions
- API response types, service interfaces
- Shared across the application

## Configuration (`config/`)

- Environment-specific configuration
- Database, Redis, authentication, CORS settings
- Imported using AdonisJS config service

## Database (`database/`)

```
database/
└── migrations/             # Database schema migrations
```

## Tests (`tests/`)

```
tests/
├── bootstrap.ts            # Test configuration and setup
├── integration/            # Integration tests
├── performance/            # Performance tests
├── unit/                   # Unit tests (by component)
│   ├── controllers/
│   ├── middleware/
│   ├── models/
│   ├── services/
│   └── validators/
└── utils/                  # Test utilities
```

## Resources (`resources/`)

```
resources/
└── views/                  # Edge.js templates
    ├── auth/               # Authentication views
    ├── dashboard/          # Dashboard interface
    └── components/         # Reusable view components
```

## Storage (`storage/`)

```
storage/
└── screenshots/            # Screenshot file storage
    ├── cache/              # Cached screenshots
    ├── screenshots/        # Generated screenshots (organized by date)
    └── temp/               # Temporary files
```

## Start (`start/`)

- `routes.ts`: Route definitions
- `kernel.ts`: Middleware registration
- `env.ts`: Environment validation

## Naming Conventions

### Files

- **snake_case** for all TypeScript files
- **PascalCase** for class names
- **camelCase** for methods and variables

### Imports

- Use path aliases (`#controllers/*`, `#services/*`, etc.)
- Import from `.js` extensions (AdonisJS requirement)
- Services imported as singletons where applicable

### Database

- **snake_case** for table and column names
- **PascalCase** for model class names
- Migration files include timestamp prefix

### Tests

- Test files end with `.spec.ts`
- Organized by component type (unit/integration/performance)
- Use descriptive test group and case names
