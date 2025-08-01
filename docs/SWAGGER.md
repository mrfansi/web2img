# OpenAPI/Swagger Documentation Integration

This document describes the OpenAPI/Swagger documentation integration added to the Web2Img API.

## Overview

The Web2Img API now includes comprehensive OpenAPI 3.0 documentation with an interactive Swagger UI interface. This provides developers with:

- Complete API specification with request/response schemas
- Interactive testing interface
- Code examples and usage patterns
- Authentication documentation
- Rate limiting information

## Accessing the Documentation

### Swagger UI Interface

The interactive documentation is available at:

```
http://localhost:3333/docs
```

### OpenAPI JSON Specification

The raw OpenAPI specification can be accessed at:

```
http://localhost:3333/docs/openapi.json
```

## Features

### 🎯 Comprehensive API Coverage

- **Screenshots API**: Single screenshot capture with customizable options
- **Batch Processing**: Multi-URL batch screenshot jobs with webhooks
- **Health Monitoring**: System health checks and metrics
- **Authentication**: API key authentication documentation

### 📚 Rich Documentation

- Detailed parameter descriptions
- Request/response examples
- Error code documentation
- Rate limiting information
- Authentication requirements

### 🔧 Interactive Testing

- Try out API endpoints directly from the browser
- Authentication support (API key input)
- Real-time request/response viewing
- Parameter validation

### 📊 Schema Definitions

- Complete data models for all request/response types
- Validation rules and constraints
- Example values for all parameters
- Error response formats

## API Endpoints Documented

### Screenshots

- `POST /screenshot` - Capture single website screenshot
  - Support for PNG, JPEG, WebP formats
  - Custom viewport dimensions
  - Full page or viewport capture
  - Caching and performance options

### Batch Processing

- `POST /batch/screenshots` - Create batch screenshot job
  - Process up to 100 URLs
  - Configurable concurrency
  - Webhook notifications
  - Priority queue support

- `GET /batch/screenshots/{job_id}` - Get batch job status
  - Real-time progress tracking
  - Download URLs for completed screenshots
  - Error reporting for failed captures

### Health & Monitoring

- `GET /health` - Basic system health
- `GET /health/detailed` - Component-level health details
- `GET /metrics/*` - Various metrics endpoints

## Implementation Details

### Technology Stack

- **OpenAPI 3.0** specification
- **Swagger UI 5.9.0** for interactive interface
- **AdonisJS** inline route handlers for simplicity
- **JSON Schema** for data validation

### Security Documentation

- API key authentication (`X-API-Key` header)
- Rate limiting information
- Error response formats

### Response Examples

Each endpoint includes comprehensive examples:

- Success responses with sample data
- Error responses with proper error codes
- Rate limiting headers
- Authentication errors

## Development

### Adding New Endpoints

To document new API endpoints:

1. Add the endpoint definition to the OpenAPI paths object in `/start/routes.ts`
2. Include request/response schemas
3. Add examples and descriptions
4. Update security requirements if needed

### Schema Updates

Update the OpenAPI schema when:

- Adding new request parameters
- Changing response formats
- Adding new error codes
- Updating validation rules

### Best Practices

- Use descriptive summaries and descriptions
- Include realistic examples
- Document all error conditions
- Specify validation constraints
- Keep schemas up to date with implementation

## Testing

The Swagger UI provides built-in testing capabilities:

1. **Authentication**: Enter your API key in the "Authorize" button
2. **Parameter Testing**: Fill in parameters and see validation
3. **Response Inspection**: View actual API responses
4. **Error Handling**: Test error conditions and rate limits

## Configuration

### Environment Variables

The documentation adapts to your environment:

- Server URLs (development vs production)
- API base paths
- Contact information

### Customization

The Swagger UI can be customized by modifying:

- CSS styles in the HTML template
- Swagger UI options and plugins
- Theme and branding elements

## Production Deployment

For production deployment:

1. Update server URLs in the OpenAPI specification
2. Ensure proper CORS configuration for the documentation
3. Consider adding authentication for the documentation itself
4. Monitor documentation endpoint performance

## Benefits

### For Developers

- **Faster Integration**: Complete API reference in one place
- **Interactive Testing**: Test endpoints without writing code
- **Error Debugging**: Clear error messages and status codes
- **Type Safety**: Schema definitions for request validation

### For API Consumers

- **Self-Service**: Comprehensive documentation without support tickets
- **Code Generation**: OpenAPI spec supports client library generation
- **Validation**: Clear parameter requirements and constraints
- **Examples**: Real-world usage patterns and sample requests

### For Maintenance

- **Living Documentation**: Stays in sync with actual API implementation
- **Version Control**: Documentation changes tracked with code changes
- **Consistency**: Standardized documentation format
- **Automation**: Can be used for automated testing and validation

## Future Enhancements

Potential improvements for the documentation:

1. **Code Generation**: Add client library generation for multiple languages
2. **Postman Collection**: Export OpenAPI spec to Postman collections
3. **Versioning**: Support multiple API versions in documentation
4. **Advanced Examples**: More complex workflow examples
5. **Performance Metrics**: Document expected response times
6. **SDK Documentation**: Language-specific SDK documentation

## Troubleshooting

### Common Issues

**Documentation not loading:**

- Check that the server is running on the correct port
- Verify the `/docs` route is accessible
- Check browser console for JavaScript errors

**API key authentication not working:**

- Ensure you're using a valid API key
- Check the `X-API-Key` header format
- Verify the API key has the correct permissions

**Examples not matching actual responses:**

- Documentation may need updating after API changes
- Check the actual API implementation for discrepancies
- Report inconsistencies for documentation updates

## Support

For questions or issues with the API documentation:

- Review the interactive examples in Swagger UI
- Check the health endpoints for system status
- Refer to the error code documentation for troubleshooting
- Contact support with specific use cases and requirements
