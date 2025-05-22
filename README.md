# web2img

A high-performance FastAPI service that captures website screenshots, uploads them to Cloudflare R2, and generates signed imgproxy URLs for image transformations.

## Features

- Capture website screenshots using Playwright
- Upload screenshots to Cloudflare R2 storage
- Generate signed imgproxy URLs for image transformations
- Handle concurrent requests reliably
- Validate inputs and provide appropriate error responses
- Clean up temporary files automatically

## Requirements

- Python 3.9+
- FastAPI
- Playwright
- boto3 (for R2 storage)
- imgproxy (external service)

## Installation

1. Clone the repository
2. Create a virtual environment: `python -m venv .venv`
3. Activate the virtual environment:
   - Windows: `.venv\Scripts\activate`
   - Unix/macOS: `source .venv/bin/activate`
4. Install dependencies: `pip install -r requirements.txt`
5. Install Playwright browsers: `playwright install`
6. Copy `.env.example` to `.env` and configure your environment variables

## Configuration

Create a `.env` file with the following variables:

```
# R2 Storage Configuration
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
R2_BUCKET=your_bucket_name
R2_PUBLIC_URL=https://your-public-url.example.com

# imgproxy Configuration
IMGPROXY_BASE_URL=https://cdn-proxy.viding.org
IMGPROXY_KEY=your_imgproxy_key
IMGPROXY_SALT=your_imgproxy_salt

# Server Configuration
PORT=8000
WORKERS=4
RELOAD=True
```

## Usage

### API Documentation

The API is documented using OpenAPI and can be accessed through the Swagger UI at `/docs` or ReDoc at `/redoc`. These interactive documentation pages provide detailed information about all endpoints, including:

- Request parameters and schemas
- Response formats and status codes
- Example requests and responses
- Detailed descriptions of each endpoint

The Swagger UI allows you to test the API directly from the browser, making it easy to explore and understand the service's capabilities.

### Running the Server

```bash
python main.py
```

The server configuration is controlled by environment variables:

- `PORT`: The port to run the server on (default: 8000)
- `WORKERS`: The number of worker processes (default: 4)
- `RELOAD`: Whether to reload the server on code changes (default: True for development, False for production)

You can also run with uvicorn directly, specifying the environment variables:

```bash
WORKERS=8 PORT=9000 uvicorn app.main:app --host 0.0.0.0 --port $PORT --workers $WORKERS
```

For production, use gunicorn with uvicorn workers:

```bash
WORKERS=8 PORT=9000 gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w $WORKERS -b 0.0.0.0:$PORT
```

### API Endpoints

#### Capture Screenshot

**POST /screenshot**

Capture a screenshot of a website, upload it to R2, and return a signed imgproxy URL.

Request body:

```json
{
  "url": "https://example.com",
  "format": "png",
  "width": 1280,
  "height": 720
}
```

Response:

```json
{
  "url": "https://cdn-proxy.viding.org/<signed_imgproxy_path>"
}
```

#### Health Check

**GET /health**

Check the health status of the service and its dependencies.

Response:

```json
{
  "status": "ok",
  "version": "1.0.0",
  "services": {
    "screenshot": "ok",
    "storage": "ok",
    "imgproxy": "ok",
    "system": {
      "python": "3.12.8",
      "platform": "macOS-15.4.1-arm64-arm-64bit"
    }
  }
}
```

Possible status values:
- `ok`: All services are functioning properly
- `degraded`: Some services have issues but the API is still operational
- `error`: Critical services are not functioning

## Performance

The service is designed to handle high volumes of concurrent requests reliably. The following optimizations are in place:

### Browser Instance Management
- Browser context pooling for efficient resource reuse
- Optimized browser launch settings for reduced resource consumption
- Intelligent resource limiting to prevent memory exhaustion
- Efficient page configuration to block unnecessary resources
- Automatic cleanup of browser resources

### Connection Pooling
- Boto3 connection pooling for R2 storage operations (50 connections)
- Proper timeout management for connections (connect: 5s, read: 10s)
- Automatic retry logic with exponential backoff
- Rate limiting detection and handling
- Efficient connection cleanup

### Temporary File Management
- Automatic periodic cleanup of temporary screenshot files (older than 1 hour)
- Efficient resource release to prevent memory leaks
- Robust error handling during cleanup operations

### Asynchronous Processing
- Non-blocking I/O operations throughout the service
- Efficient worker configuration for optimal concurrency
- Proper resource sharing between worker processes

### Load Testing

A load testing script is included in the `tests` directory to verify performance:

```bash
python tests/load_test.py --concurrency 10 --requests 50
```

The script supports the following options:
- `--url`: API base URL (default: http://localhost:8000)
- `--concurrency`: Number of concurrent requests (default: 10)
- `--requests`: Total number of requests to make (default: 50)
- `--output`: Optional JSON file to save detailed results

## License

MIT
