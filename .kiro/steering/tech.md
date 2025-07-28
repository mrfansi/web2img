# Technology Stack

## Framework & Runtime

- **AdonisJS v6**: Modern Node.js framework with TypeScript support
- **Node.js**: JavaScript runtime with ES modules
- **TypeScript**: Primary language with strict typing

## Core Dependencies

- **@adonisjs/core**: Framework core
- **@adonisjs/lucid**: ORM for database operations
- **@adonisjs/redis**: Redis integration
- **@adonisjs/auth**: Authentication system
- **@adonisjs/cors**: CORS handling
- **Edge.js**: Template engine for views

## Key Libraries

- **Playwright**: Browser automation for screenshot capture
- **BullMQ**: Queue processing and job management
- **MySQL2**: Database driver
- **IORedis**: Redis client (via AdonisJS Redis)
- **Luxon**: Date/time handling
- **VineJS**: Request validation
- **Swagger**: API documentation (swagger-jsdoc, swagger-ui-express)

## Development Tools

- **ESLint**: Code linting with AdonisJS config
- **Prettier**: Code formatting
- **Japa**: Testing framework with API client plugin
- **Hot-Hook**: Hot module reloading
- **SWC**: Fast TypeScript compilation

## Build System & Commands

### Development

```bash
npm run dev          # Start development server with HMR
npm run build        # Build for production
npm start            # Start production server
```

### Code Quality

```bash
npm run lint         # Run ESLint
npm run format       # Format code with Prettier
npm run typecheck    # TypeScript type checking
```

### Testing

```bash
npm test             # Run all tests with Japa
node ace test        # Alternative test command
```

### Database

```bash
node ace migration:run     # Run database migrations
node ace migration:rollback # Rollback migrations
```

## Path Aliases

The project uses import aliases defined in package.json:

- `#controllers/*` → `./app/controllers/*.js`
- `#services/*` → `./app/services/*.js`
- `#models/*` → `./app/models/*.js`
- `#middleware/*` → `./app/middleware/*.js`
- `#validators/*` → `./app/validators/*.js`
- `#config/*` → `./config/*.js`
- `#types/*` → `./app/types/*.js`

## Configuration

- **adonisrc.ts**: Main application configuration
- **tsconfig.json**: TypeScript configuration extending AdonisJS defaults
- **eslint.config.js**: ESLint configuration using AdonisJS preset
- **.env**: Environment variables (copy from .env.example)

## Docker Support

- **Dockerfile**: Container configuration
- **docker-compose.yml**: Development environment
- **docker-compose.prod.yml**: Production environment
