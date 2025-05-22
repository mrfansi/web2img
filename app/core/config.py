import os
from typing import Optional

from pydantic import BaseModel, Field
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

    # API settings
    api_prefix: str = ""
    
    # Server settings
    workers: int = Field(
        default_factory=lambda: int(os.getenv("WORKERS", "4"))
    )

    class Config:
        env_file = ".env"


# Create global settings instance
settings = Settings()
