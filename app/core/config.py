import os
from typing import Optional

from pydantic import BaseModel, Field, ConfigDict
from dotenv import load_dotenv

# Load environment variables from .env file if it exists
load_dotenv()


class Settings(BaseModel):
    """Application settings."""
    # Cache Configuration
    cache_enabled: bool = Field(
        default_factory=lambda: os.getenv("CACHE_ENABLED", "True").lower() in ("true", "1", "t")
    )
    cache_ttl_seconds: int = Field(
        default_factory=lambda: int(os.getenv("CACHE_TTL_SECONDS", "3600"))
    )
    cache_max_items: int = Field(
        default_factory=lambda: int(os.getenv("CACHE_MAX_ITEMS", "100"))
    )
    
    # R2 Storage Configuration
    r2_access_key_id: str = Field(
        default_factory=lambda: os.getenv("R2_ACCESS_KEY_ID", "")
    )
    r2_secret_access_key: str = Field(
        default_factory=lambda: os.getenv("R2_SECRET_ACCESS_KEY", "")
    )
    r2_endpoint: str = Field(
        default_factory=lambda: os.getenv("R2_ENDPOINT", "")
    )
    r2_bucket: str = Field(
        default_factory=lambda: os.getenv("R2_BUCKET", "")
    )
    r2_public_url: str = Field(
        default_factory=lambda: os.getenv("R2_PUBLIC_URL", "")
    )
    # imgproxy Configuration
    imgproxy_base_url: str = Field(
        default_factory=lambda: os.getenv("IMGPROXY_BASE_URL", "")
    )
    imgproxy_key: str = Field(
        default_factory=lambda: os.getenv("IMGPROXY_KEY", "")
    )
    imgproxy_salt: str = Field(
        default_factory=lambda: os.getenv("IMGPROXY_SALT", "")
    )

    # Screenshot directory for temporary files
    screenshot_dir: str = Field(
        default_factory=lambda: os.getenv("SCREENSHOT_DIR", "/tmp/web2img")
    )
    
    # Browser user agent string
    user_agent: str = Field(
        default_factory=lambda: os.getenv("USER_AGENT", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36")
    )

    # API settings
    api_prefix: str = ""
    
    # Server settings
    workers: int = Field(
        default_factory=lambda: int(os.getenv("WORKERS", "4"))
    )
    
    # Browser Pool Configuration
    browser_pool_min_size: int = Field(
        default_factory=lambda: int(os.getenv("BROWSER_POOL_MIN_SIZE", "2"))
    )
    browser_pool_max_size: int = Field(
        default_factory=lambda: int(os.getenv("BROWSER_POOL_MAX_SIZE", "10"))
    )
    browser_pool_idle_timeout: int = Field(
        default_factory=lambda: int(os.getenv("BROWSER_POOL_IDLE_TIMEOUT", "300"))
    )
    browser_pool_max_age: int = Field(
        default_factory=lambda: int(os.getenv("BROWSER_POOL_MAX_AGE", "3600"))
    )
    browser_pool_cleanup_interval: int = Field(
        default_factory=lambda: int(os.getenv("BROWSER_POOL_CLEANUP_INTERVAL", "60"))
    )
    
    # Screenshot Service Configuration
    screenshot_cleanup_interval: int = Field(
        default_factory=lambda: int(os.getenv("SCREENSHOT_CLEANUP_INTERVAL", "300"))
    )
    temp_file_retention_hours: int = Field(
        default_factory=lambda: int(os.getenv("TEMP_FILE_RETENTION_HOURS", "24"))
    )
    
    # Timeout Configuration
    navigation_timeout_regular: int = Field(
        default_factory=lambda: int(os.getenv("NAVIGATION_TIMEOUT_REGULAR", "30000"))
    )
    navigation_timeout_complex: int = Field(
        default_factory=lambda: int(os.getenv("NAVIGATION_TIMEOUT_COMPLEX", "60000"))
    )
    browser_launch_timeout: int = Field(
        default_factory=lambda: int(os.getenv("BROWSER_LAUNCH_TIMEOUT", "60000"))
    )
    context_creation_timeout: int = Field(
        default_factory=lambda: int(os.getenv("CONTEXT_CREATION_TIMEOUT", "30000"))
    )
    browser_context_timeout: int = Field(
        default_factory=lambda: int(os.getenv("BROWSER_CONTEXT_TIMEOUT", "15000"))
    )
    page_creation_timeout: int = Field(
        default_factory=lambda: int(os.getenv("PAGE_CREATION_TIMEOUT", "10000"))
    )

    screenshot_timeout: int = Field(
        default_factory=lambda: int(os.getenv("SCREENSHOT_TIMEOUT", "30000"))
    )
    
    # Retry Configuration
    max_retries_regular: int = Field(
        default_factory=lambda: int(os.getenv("MAX_RETRIES_REGULAR", "3"))
    )
    max_retries_complex: int = Field(
        default_factory=lambda: int(os.getenv("MAX_RETRIES_COMPLEX", "5"))
    )
    retry_base_delay: float = Field(
        default_factory=lambda: float(os.getenv("RETRY_BASE_DELAY", "0.5"))
    )
    retry_max_delay: float = Field(
        default_factory=lambda: float(os.getenv("RETRY_MAX_DELAY", "10.0"))
    )
    retry_jitter: float = Field(
        default_factory=lambda: float(os.getenv("RETRY_JITTER", "0.1"))
    )
    
    # Circuit Breaker Configuration
    circuit_breaker_threshold: int = Field(
        default_factory=lambda: int(os.getenv("CIRCUIT_BREAKER_THRESHOLD", "5"))
    )
    circuit_breaker_reset_time: int = Field(
        default_factory=lambda: int(os.getenv("CIRCUIT_BREAKER_RESET_TIME", "300"))
    )
    
    # Logging Configuration
    log_level: str = Field(
        default_factory=lambda: os.getenv("LOG_LEVEL", "INFO")
    )
    log_format: str = Field(
        default_factory=lambda: os.getenv("LOG_FORMAT", "json")
    )
    log_request_body: bool = Field(
        default_factory=lambda: os.getenv("LOG_REQUEST_BODY", "False").lower() in ("true", "1", "t")
    )
    log_response_body: bool = Field(
        default_factory=lambda: os.getenv("LOG_RESPONSE_BODY", "False").lower() in ("true", "1", "t")
    )
    
    # Use model_config instead of class Config to fix Pydantic v2 deprecation warning
    model_config = ConfigDict(env_file=".env")


# Create global settings instance
settings = Settings()
