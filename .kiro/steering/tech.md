# Technology Stack

## Framework & Runtime
- **AdonisJS v6** - Full-stack Node.js framework
- **Node.js** with TypeScript
- **MySQL** database with Lucid ORM

## Key Dependencies
- `@adonisjs/auth` - Authentication system
- `@adonisjs/lucid` - Database ORM
- `@adonisjs/cors` - CORS middleware
- `@vinejs/vine` - Validation library
- `luxon` - Date/time handling
- `mysql2` - MySQL driver

## Development Tools
- **TypeScript** - Type safety
- **ESLint** - Code linting with AdonisJS config
- **Prettier** - Code formatting
- **Japa** - Testing framework
- **Hot-Hook** - Hot module reloading

## Common Commands

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
npm test             # Run all tests
node ace test        # Alternative test command
```

### Database
```bash
node ace migration:run     # Run pending migrations
node ace migration:rollback # Rollback last migration
node ace make:migration    # Create new migration
```

## Build System
- Uses AdonisJS Assembler for building
- TypeScript compilation with SWC
- ES modules with import maps for path aliases
- Hot reloading in development mode