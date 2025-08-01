# Web2Img - Website Screenshot Service

Web2Img is a high-performance website screenshot service that provides REST APIs for capturing website screenshots and converting them to various image formats (PNG, JPEG, WebP).

## Core Features

- **RESTful API**: Clean endpoints for single and batch screenshot generation
- **Queue Processing**: Background job processing with BullMQ for scalability
- **Caching**: Redis-based caching for improved performance
- **Rate Limiting**: Built-in rate limiting and API key authentication
- **Dashboard Interface**: Web-based dashboard for monitoring and API key management
- **Multiple Formats**: Support for PNG, JPEG, WebP with customizable dimensions
- **Error Handling**: Comprehensive error handling and logging
- **OpenAPI Documentation**: Interactive API documentation with Swagger UI

## Architecture

Modern, scalable architecture with:

- Background job processing for screenshot generation
- Redis for caching and queue management
- MySQL for persistent data storage
- Playwright for browser automation
- Comprehensive authentication and authorization
- Real-time system monitoring and health checks

## Key Endpoints

- `POST /screenshots` - Generate single screenshot
- `POST /screenshots/batch` - Generate multiple screenshots
- `GET /screenshots/:id` - Get screenshot status/result
- `/dashboard` - Web interface for system monitoring and API key management
- `/docs` - Interactive API documentation

## Authentication

All API endpoints require authentication via API key in the `X-API-Key` header.
