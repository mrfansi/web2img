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

**POST /api/v1/screenshot**

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

## Performance

The service is designed to handle at least 100 concurrent requests reliably. The following optimizations are in place:

- Connection pooling for R2 storage client
- Browser instance reuse when possible
- Asynchronous processing for non-blocking I/O operations
- Proper worker configuration for concurrency

## License

MIT
