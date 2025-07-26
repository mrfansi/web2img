# Dashboard Features

This document describes the dashboard functionality added to the Web2Img application.

## Overview

The dashboard provides a web-based interface for monitoring system health, viewing metrics, and managing API keys. It consists of both a web interface and REST API endpoints.

## Features

### 1. Dashboard Web Interface
- **URL**: `/dashboard`
- **Description**: A responsive web interface built with Tailwind CSS that provides real-time system monitoring
- **Features**:
  - System status overview
  - Real-time metrics display
  - API key management interface
  - Auto-refresh every 30 seconds

### 2. System Metrics & Monitoring
- **Health Status**: Overall system health with component-level details
- **Request Metrics**: 
  - Total requests processed
  - Requests per second
  - Average response time
  - Error rate
- **Processing Metrics**:
  - Screenshots generated
  - Average processing time
  - Cache hit rate
  - Queue depth
  - Active workers
- **System Metrics**:
  - Memory usage
  - CPU usage
  - Disk usage

### 3. API Key Management
- **Create API Keys**: Generate new API keys with custom names and rate limits
- **View API Keys**: List all API keys with masked keys for security
- **Toggle Status**: Activate/deactivate API keys
- **Delete API Keys**: Remove API keys permanently
- **Rate Limit Configuration**: Set custom rate limits per API key (1-10,000 requests/hour)

## API Endpoints

### Dashboard Data
- **GET** `/dashboard/api/data` - Get complete dashboard data including health, metrics, and stats

### API Key Management
- **GET** `/dashboard/api/keys` - List all API keys
- **POST** `/dashboard/api/keys` - Create a new API key
  ```json
  {
    "name": "API Key Name",
    "rateLimit": 1000
  }
  ```
- **PATCH** `/dashboard/api/keys/:id/toggle` - Toggle API key active status
- **DELETE** `/dashboard/api/keys/:id` - Delete an API key

## Security Considerations

- **Key Masking**: API keys are masked in list views (only first 8 and last 8 characters shown)
- **Full Key Display**: Complete API key is only shown once during creation
- **No Authentication**: Currently no authentication required (demo purposes)
- **Rate Limiting**: Each API key has configurable rate limits

## Usage Examples

### Creating an API Key via Dashboard Web Interface
1. Open `/dashboard` in your browser
2. Click "Create New API Key" button
3. Enter a name and optional rate limit
4. Copy the generated key (shown only once)
5. Key appears in the API keys table

### Creating an API Key via API
```bash
curl -X POST "http://localhost:57304/dashboard/api/keys" \
  -H "Content-Type: application/json" \
  -d '{"name": "My API Key", "rateLimit": 2000}'
```

### Getting Dashboard Data
```bash
curl "http://localhost:57304/dashboard/api/data"
```

### Using the Generated API Key
```bash
curl -X POST "http://localhost:57304/screenshot" \
  -H "X-API-Key: your-generated-api-key" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

## Technical Implementation

### Controller
- **File**: `app/controllers/dashboard_controller.ts`
- **Features**: 
  - Serves HTML dashboard interface
  - Provides REST API endpoints
  - Integrates with existing health and metrics services
  - Automatic user creation for demo purposes

### Routes
- **File**: `start/routes.ts`
- **Middleware**: Request logging and metrics collection
- **Security**: No authentication (can be added later)

### Dependencies
- **Tailwind CSS**: For responsive UI styling
- **Chart.js**: Ready for future chart implementations
- **Native JavaScript**: No additional frontend frameworks

### Models Used
- **ApiKey**: For API key management
- **User**: For associating keys with users
- **HealthCheckService**: For system health monitoring
- **MetricsService**: For system metrics collection

## Future Enhancements

1. **Authentication**: Add user authentication for dashboard access
2. **User Management**: Multi-user support with role-based access
3. **Charts & Graphs**: Visual representations of metrics over time
4. **Alerts**: Configurable alerts for system health issues
5. **API Key Analytics**: Usage statistics per API key
6. **Webhook Management**: Interface for webhook configuration
7. **Real-time Updates**: WebSocket-based real-time dashboard updates
8. **Export Features**: Export metrics and API key data
9. **Advanced Filtering**: Filter and search API keys
10. **API Key Scopes**: Granular permissions per API key

## Screenshots

The dashboard includes:
- Clean, modern interface with status indicators
- Responsive design that works on desktop and mobile
- Real-time data updates
- Modal dialogs for API key creation
- Success/error notifications
- Sortable and searchable data tables

## Troubleshooting

### Common Issues

1. **Dashboard shows "Loading..." forever**
   - Check if the server is running
   - Verify API endpoints are accessible
   - Check browser console for JavaScript errors

2. **API Key creation fails**
   - Ensure the database is connected
   - Check if the User model has proper migrations
   - Verify the API key validation rules

3. **Metrics showing as zero or dashes**
   - This is normal for a new installation
   - Metrics will populate as the system processes requests
   - Health checks may show issues if optional services aren't configured

4. **System health shows "unhealthy"**
   - Check individual component statuses
   - Verify database, Redis, and other services are running
   - Some components may be optional depending on configuration

### Development Notes

- The dashboard automatically creates a default user if none exists
- API keys are generated using crypto.randomBytes for security
- The interface updates every 30 seconds automatically
- All API operations include proper error handling and validation
