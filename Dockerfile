FROM python:3.12-slim

WORKDIR /app

# Install system dependencies required for Playwright (all browsers: Chromium, Firefox, WebKit)
RUN apt-get update && apt-get install -y \
    # Basic system tools
    wget \
    gnupg \
    ca-certificates \
    # Core libraries for all browsers
    libglib2.0-0 \
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
    # Additional dependencies for WebKit and Firefox
    libgstreamer1.0-0 \
    libgtk-4-1 \
    libpangocairo-1.0-0 \
    libgdk-pixbuf-2.0-0 \
    libcairo-gobject2 \
    libgraphene-1.0-0 \
    libatomic1 \
    libxslt1.1 \
    liblcms2-2 \
    libwoff2dec1.0.2 \
    libvpx7 \
    libevent-2.1-7 \
    libopus0 \
    # GStreamer plugins for media support
    libgstreamer-plugins-base1.0-0 \
    libgstreamer-plugins-bad1.0-0 \
    gstreamer1.0-plugins-base \
    gstreamer1.0-plugins-good \
    gstreamer1.0-plugins-bad \
    gstreamer1.0-plugins-ugly \
    gstreamer1.0-libav \
    # Text-to-speech libraries
    libflite1 \
    # Image format support
    libwebpdemux2 \
    libavif15 \
    libharfbuzz-icu0 \
    libepoxy0 \
    libjpeg62-turbo \
    libwebpmux3 \
    libwebp7 \
    # Spell checking and security
    libenchant-2-2 \
    libsecret-1-0 \
    libhyphen0 \
    # Wayland support
    libwayland-egl1 \
    libwayland-client0 \
    # Game controller support
    libmanette-0.2-0 \
    # HTTP/2 support
    libnghttp2-14 \
    # OpenGL support
    libgles2-mesa \
    # Video encoding
    libx264-dev \
    # Additional X11 libraries
    libxss1 \
    libgconf-2-4 \
    libxtst6 \
    libxrandr2 \
    libasound2 \
    libpangocairo-1.0-0 \
    libatk1.0-0 \
    libcairo-gobject2 \
    libgtk-3-0 \
    libgdk-pixbuf2.0-0 \
    # Fonts
    fonts-liberation \
    fonts-noto-color-emoji \
    fonts-noto-cjk \
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
