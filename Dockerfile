FROM python:3.12-slim

WORKDIR /app

# Install system dependencies required for Playwright browsers
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxcb1 \
    libxkbcommon0 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libglib2.0-0 \
    libgtk-3-0 \
    libgdk-pixbuf-2.0-0 \
    libxss1 \
    libxtst6 \
    fonts-liberation \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements file
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright browsers with system dependencies (all three engines for multi-browser support)
RUN playwright install --with-deps chromium firefox webkit

# Copy application code
COPY . .

# Create directory for temporary screenshots
RUN mkdir -p /tmp/web2img

# Set environment variables for optimal browser performance
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0

# Set display for headless browsers
ENV DISPLAY=:99

# Uses the WORKERS environment variable for the number of workers
CMD ["python", "main.py"]
