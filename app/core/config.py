import os

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
        default_factory=lambda: int(os.getenv("CACHE_MAX_ITEMS", "300"))
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
    r2_object_expiration_days: int = Field(
        default_factory=lambda: int(os.getenv("R2_OBJECT_EXPIRATION_DAYS", "3"))
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

    # Storage Configuration
    storage_mode: str = Field(
        default_factory=lambda: os.getenv("STORAGE_MODE", "r2")  # "r2" or "local"
    )
    local_storage_dir: str = Field(
        default_factory=lambda: os.getenv("LOCAL_STORAGE_DIR", "/tmp/web2img/screenshots")
    )
    local_storage_base_url: str = Field(
        default_factory=lambda: os.getenv("LOCAL_STORAGE_BASE_URL", "http://localhost:8000/screenshots")
    )

    # imgproxy Configuration for Local Storage
    use_imgproxy_for_local: bool = Field(
        default_factory=lambda: os.getenv("USE_IMGPROXY_FOR_LOCAL", "true").lower() in ("true", "1", "t")
    )



    # Browser Engine Configuration
    browser_engine: str = Field(
        default_factory=lambda: os.getenv("BROWSER_ENGINE", "chromium").lower()
    )

    # Browser user agent string - will be dynamically set based on browser engine
    user_agent: str = Field(
        default_factory=lambda: os.getenv("USER_AGENT", "")
    )

    # API settings
    api_prefix: str = ""

    # Server settings
    workers: int = Field(
        default_factory=lambda: int(os.getenv("WORKERS", "8"))
    )

    # Browser Pool Configuration - Optimized for balanced performance and resource usage
    browser_pool_min_size: int = Field(
        default_factory=lambda: int(os.getenv("BROWSER_POOL_MIN_SIZE", "4"))
    )
    browser_pool_max_size: int = Field(
        default_factory=lambda: int(os.getenv("BROWSER_POOL_MAX_SIZE", "12"))
    )
    browser_pool_idle_timeout: int = Field(
        default_factory=lambda: int(os.getenv("BROWSER_POOL_IDLE_TIMEOUT", "1800"))  # 30 minutes - optimized default
    )
    browser_pool_max_age: int = Field(
        default_factory=lambda: int(os.getenv("BROWSER_POOL_MAX_AGE", "3600"))  # 1 hour - optimized default
    )
    browser_pool_cleanup_interval: int = Field(
        default_factory=lambda: int(os.getenv("BROWSER_POOL_CLEANUP_INTERVAL", "300"))  # 5 minutes - optimized default
    )

    # Browser Pool Load Management - Optimized adaptive scaling configuration
    browser_pool_wait_timeout: int = Field(
        default_factory=lambda: int(os.getenv("BROWSER_POOL_WAIT_TIMEOUT", "15"))
    )
    browser_pool_scale_threshold: float = Field(
        default_factory=lambda: float(os.getenv("BROWSER_POOL_SCALE_THRESHOLD", "0.7"))
    )
    browser_pool_scale_factor: float = Field(
        default_factory=lambda: float(os.getenv("BROWSER_POOL_SCALE_FACTOR", "1.3"))
    )
    enable_adaptive_scaling: bool = Field(
        default_factory=lambda: os.getenv("ENABLE_ADAPTIVE_SCALING", "true").lower() in ("true", "1", "t")
    )
    max_wait_attempts: int = Field(
        default_factory=lambda: int(os.getenv("MAX_WAIT_ATTEMPTS", "5"))  # Increased default
    )

    # Browser Cleanup Control - User preference to disable aggressive cleanup
    disable_browser_cleanup: bool = Field(
        default_factory=lambda: os.getenv("DISABLE_BROWSER_CLEANUP", "false").lower() in ("true", "1", "t")
    )
    disable_browser_recycling: bool = Field(
        default_factory=lambda: os.getenv("DISABLE_BROWSER_RECYCLING", "false").lower() in ("true", "1", "t")
    )
    disable_stuck_browser_detection: bool = Field(
        default_factory=lambda: os.getenv("DISABLE_STUCK_BROWSER_DETECTION", "false").lower() in ("true", "1", "t")
    )
    disable_force_browser_restart: bool = Field(
        default_factory=lambda: os.getenv("DISABLE_FORCE_BROWSER_RESTART", "false").lower() in ("true", "1", "t")
    )

    # Fast Browser Release Configuration
    enable_fast_release: bool = Field(
        default_factory=lambda: os.getenv("ENABLE_FAST_RELEASE", "true").lower() in ("true", "1", "t")
    )
    context_cleanup_timeout: int = Field(
        default_factory=lambda: int(os.getenv("CONTEXT_CLEANUP_TIMEOUT", "1000"))  # 1 second default
    )
    page_close_timeout: int = Field(
        default_factory=lambda: int(os.getenv("PAGE_CLOSE_TIMEOUT", "500"))  # 0.5 seconds default
    )

    # Emergency Load Management - New queue and load shedding configuration
    enable_request_queue: bool = Field(
        default_factory=lambda: os.getenv("ENABLE_REQUEST_QUEUE", "true").lower() in ("true", "1", "t")
    )
    max_queue_size: int = Field(
        default_factory=lambda: int(os.getenv("MAX_QUEUE_SIZE", "200"))  # Max requests in queue
    )
    queue_timeout: int = Field(
        default_factory=lambda: int(os.getenv("QUEUE_TIMEOUT", "60"))  # Max seconds in queue
    )
    enable_load_shedding: bool = Field(
        default_factory=lambda: os.getenv("ENABLE_LOAD_SHEDDING", "true").lower() in ("true", "1", "t")
    )
    load_shedding_threshold: float = Field(
        default_factory=lambda: float(os.getenv("LOAD_SHEDDING_THRESHOLD", "0.95"))  # Shed load at 95% capacity
    )
    emergency_cleanup_interval: int = Field(
        default_factory=lambda: int(os.getenv("EMERGENCY_CLEANUP_INTERVAL", "10"))  # Emergency cleanup every 10s
    )

    # Tab Pool Configuration - Optimized multi-tab support
    max_tabs_per_browser: int = Field(
        default_factory=lambda: int(os.getenv("MAX_TABS_PER_BROWSER", "5"))
    )
    tab_idle_timeout: int = Field(
        default_factory=lambda: int(os.getenv("TAB_IDLE_TIMEOUT", "1800"))  # 30 minutes - optimized default
    )
    tab_max_age: int = Field(
        default_factory=lambda: int(os.getenv("TAB_MAX_AGE", "3600"))  # 1 hour - optimized default
    )
    tab_cleanup_interval: int = Field(
        default_factory=lambda: int(os.getenv("TAB_CLEANUP_INTERVAL", "300"))  # 5 minutes - optimized default
    )
    enable_tab_reuse: bool = Field(
        default_factory=lambda: os.getenv("ENABLE_TAB_REUSE", "true").lower() in ("true", "1", "t")
    )

    # Screenshot Service Configuration
    screenshot_cleanup_interval: int = Field(
        default_factory=lambda: int(os.getenv("SCREENSHOT_CLEANUP_INTERVAL", "1800"))  # 30 minutes - optimized default
    )
    temp_file_retention_hours: int = Field(
        default_factory=lambda: int(os.getenv("TEMP_FILE_RETENTION_HOURS", "6"))
    )

    # Batch Job Persistence Configuration
    batch_job_persistence_dir: str = Field(
        default_factory=lambda: os.getenv("BATCH_JOB_PERSISTENCE_DIR", "/tmp/web2img/jobs")
    )
    batch_job_persistence_enabled: bool = Field(
        default_factory=lambda: os.getenv("BATCH_JOB_PERSISTENCE_ENABLED", "true").lower() in ("true", "1", "t")
    )

    # Browser Cache Configuration
    browser_cache_enabled: bool = Field(
        default_factory=lambda: os.getenv("BROWSER_CACHE_ENABLED", "true").lower() in ("true", "1", "t")
    )
    browser_cache_max_size_mb: int = Field(
        default_factory=lambda: int(os.getenv("BROWSER_CACHE_MAX_SIZE_MB", "200"))
    )
    browser_cache_max_file_size_mb: int = Field(
        default_factory=lambda: int(os.getenv("BROWSER_CACHE_MAX_FILE_SIZE_MB", "10"))
    )
    browser_cache_ttl_hours: int = Field(
        default_factory=lambda: int(os.getenv("BROWSER_CACHE_TTL_HOURS", "24"))
    )
    browser_cache_cleanup_interval: int = Field(
        default_factory=lambda: int(os.getenv("BROWSER_CACHE_CLEANUP_INTERVAL", "1800"))  # 30 minutes - optimized default
    )
    browser_cache_all_content: bool = Field(
        default_factory=lambda: os.getenv("BROWSER_CACHE_ALL_CONTENT", "true").lower() in ("true", "1", "t")  # Enable by default for timeout prevention
    )

    # Timeout Configuration - Optimized for better performance
    navigation_timeout_regular: int = Field(
        default_factory=lambda: int(os.getenv("NAVIGATION_TIMEOUT_REGULAR", "20000"))  # Reduced from 30000
    )
    navigation_timeout_complex: int = Field(
        default_factory=lambda: int(os.getenv("NAVIGATION_TIMEOUT_COMPLEX", "45000"))  # Reduced from 60000
    )
    browser_launch_timeout: int = Field(
        default_factory=lambda: int(os.getenv("BROWSER_LAUNCH_TIMEOUT", "30000"))  # Reduced from 60000
    )
    context_creation_timeout: int = Field(
        default_factory=lambda: int(os.getenv("CONTEXT_CREATION_TIMEOUT", "30000"))  # Reduced from 60000
    )
    browser_context_timeout: int = Field(
        default_factory=lambda: int(os.getenv("BROWSER_CONTEXT_TIMEOUT", "30000"))  # Reduced from 60000
    )
    page_creation_timeout: int = Field(
        default_factory=lambda: int(os.getenv("PAGE_CREATION_TIMEOUT", "30000"))  # Reduced from 60000
    )

    screenshot_timeout: int = Field(
        default_factory=lambda: int(os.getenv("SCREENSHOT_TIMEOUT", "20000"))  # Reduced from 30000
    )

    # Retry Configuration - Optimized for better performance
    max_retries_regular: int = Field(
        default_factory=lambda: int(os.getenv("MAX_RETRIES_REGULAR", "3"))  # Reduced from 8
    )
    max_retries_complex: int = Field(
        default_factory=lambda: int(os.getenv("MAX_RETRIES_COMPLEX", "5"))  # Reduced from 12
    )
    retry_base_delay: float = Field(
        default_factory=lambda: float(os.getenv("RETRY_BASE_DELAY", "0.5"))  # Increased from 0.1
    )
    retry_max_delay: float = Field(
        default_factory=lambda: float(os.getenv("RETRY_MAX_DELAY", "10.0"))  # Increased from 8.0
    )
    retry_jitter: float = Field(
        default_factory=lambda: float(os.getenv("RETRY_JITTER", "0.1"))  # Reduced from 0.2
    )

    # Context Creation Retry Multipliers
    # These multipliers are applied to the base retry settings for context creation operations
    # which need more aggressive retry behavior under high load
    context_retry_max_retries_multiplier: float = Field(
        default_factory=lambda: float(os.getenv("CONTEXT_RETRY_MAX_RETRIES_MULTIPLIER", "2.0"))
    )
    context_retry_base_delay_multiplier: float = Field(
        default_factory=lambda: float(os.getenv("CONTEXT_RETRY_BASE_DELAY_MULTIPLIER", "2.5"))
    )
    context_retry_max_delay_multiplier: float = Field(
        default_factory=lambda: float(os.getenv("CONTEXT_RETRY_MAX_DELAY_MULTIPLIER", "1.6"))
    )
    context_retry_jitter_multiplier: float = Field(
        default_factory=lambda: float(os.getenv("CONTEXT_RETRY_JITTER_MULTIPLIER", "2.0"))
    )

    # Screenshot Capture Retry Configuration - Optimized for balanced performance
    screenshot_max_retries: int = Field(
        default_factory=lambda: int(os.getenv("SCREENSHOT_MAX_RETRIES", "3"))
    )
    screenshot_base_delay: float = Field(
        default_factory=lambda: float(os.getenv("SCREENSHOT_BASE_DELAY", "0.5"))
    )
    screenshot_max_delay: float = Field(
        default_factory=lambda: float(os.getenv("SCREENSHOT_MAX_DELAY", "4.0"))
    )
    screenshot_jitter: float = Field(
        default_factory=lambda: float(os.getenv("SCREENSHOT_JITTER", "0.2"))
    )

    # Circuit Breaker Configuration - Optimized for balanced resilience
    circuit_breaker_threshold: int = Field(
        default_factory=lambda: int(os.getenv("CIRCUIT_BREAKER_THRESHOLD", "15"))
    )
    circuit_breaker_reset_time: int = Field(
        default_factory=lambda: int(os.getenv("CIRCUIT_BREAKER_RESET_TIME", "45"))
    )

    # Performance Optimization Configuration - Optimized for timeout prevention
    disable_images: bool = Field(
        default_factory=lambda: os.getenv("DISABLE_IMAGES", "False").lower() in ("true", "1", "t")  # Keep images for accurate screenshots
    )

    # Concurrency Control Configuration - Optimized for balanced performance
    max_concurrent_screenshots: int = Field(
        default_factory=lambda: int(os.getenv("MAX_CONCURRENT_SCREENSHOTS", "32"))
    )
    max_concurrent_contexts: int = Field(
        default_factory=lambda: int(os.getenv("MAX_CONCURRENT_CONTEXTS", "64"))
    )

    # Emergency Context Creation Configuration
    enable_emergency_context: bool = Field(
        default_factory=lambda: os.getenv("ENABLE_EMERGENCY_CONTEXT", "true").lower() in ("true", "1", "t")
    )
    force_emergency_on_timeout: bool = Field(
        default_factory=lambda: os.getenv("FORCE_EMERGENCY_ON_TIMEOUT", "false").lower() in ("true", "1", "t")
    )
    emergency_context_timeout: int = Field(
        default_factory=lambda: int(os.getenv("EMERGENCY_CONTEXT_TIMEOUT", "10000"))  # 10 seconds for emergency context
    )

    # Resource Management Configuration
    force_browser_restart_interval: int = Field(
        default_factory=lambda: int(os.getenv("FORCE_BROWSER_RESTART_INTERVAL", "7200"))  # 2 hours - optimized default
    )
    memory_cleanup_threshold: int = Field(
        default_factory=lambda: int(os.getenv("MEMORY_CLEANUP_THRESHOLD", "80"))
    )

    # Performance Logging Configuration
    enable_performance_logging: bool = Field(
        default_factory=lambda: os.getenv("ENABLE_PERFORMANCE_LOGGING", "false").lower() in ("true", "1", "t")
    )
    log_browser_pool_stats: bool = Field(
        default_factory=lambda: os.getenv("LOG_BROWSER_POOL_STATS", "false").lower() in ("true", "1", "t")
    )
    disable_javascript: bool = Field(
        default_factory=lambda: os.getenv("DISABLE_JAVASCRIPT", "False").lower() in ("true", "1", "t")  # Keep JS for dynamic content
    )
    disable_css: bool = Field(
        default_factory=lambda: os.getenv("DISABLE_CSS", "False").lower() in ("true", "1", "t")  # Keep CSS for proper rendering
    )
    disable_fonts: bool = Field(
        default_factory=lambda: os.getenv("DISABLE_FONTS", "True").lower() in ("true", "1", "t")  # Disable fonts to reduce load time
    )
    disable_media: bool = Field(
        default_factory=lambda: os.getenv("DISABLE_MEDIA", "True").lower() in ("true", "1", "t")  # Disable media to reduce load time
    )
    disable_analytics: bool = Field(
        default_factory=lambda: os.getenv("DISABLE_ANALYTICS", "True").lower() in ("true", "1", "t")  # Disable analytics to reduce load time
    )

    # Additional performance optimizations for timeout prevention
    disable_third_party_scripts: bool = Field(
        default_factory=lambda: os.getenv("DISABLE_THIRD_PARTY_SCRIPTS", "True").lower() in ("true", "1", "t")
    )
    disable_ads: bool = Field(
        default_factory=lambda: os.getenv("DISABLE_ADS", "True").lower() in ("true", "1", "t")
    )
    disable_social_widgets: bool = Field(
        default_factory=lambda: os.getenv("DISABLE_SOCIAL_WIDGETS", "True").lower() in ("true", "1", "t")
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

    # Real IP Configuration for Proxy/Load Balancer Support
    trust_proxy_headers: bool = Field(
        default_factory=lambda: os.getenv("TRUST_PROXY_HEADERS", "true").lower() in ("true", "1", "t")
    )
    trusted_proxy_ips: str = Field(
        default_factory=lambda: os.getenv("TRUSTED_PROXY_IPS", "")  # Comma-separated list of trusted proxy IPs
    )
    log_proxy_headers: bool = Field(
        default_factory=lambda: os.getenv("LOG_PROXY_HEADERS", "false").lower() in ("true", "1", "t")  # For debugging
    )

    # Pool Watchdog Configuration - Optimized for balanced monitoring
    # These settings control the browser pool monitoring and automatic cleanup
    pool_watchdog_interval: int = Field(
        default_factory=lambda: int(os.getenv("POOL_WATCHDOG_INTERVAL", "300"))  # 5 minutes - optimized default
    )
    pool_watchdog_usage_threshold: float = Field(
        default_factory=lambda: float(os.getenv("POOL_WATCHDOG_USAGE_THRESHOLD", "0.8"))  # 80% - optimized default
    )
    pool_watchdog_idle_threshold: int = Field(
        default_factory=lambda: int(os.getenv("POOL_WATCHDOG_IDLE_THRESHOLD", "1800"))  # 30 minutes - optimized default
    )
    pool_watchdog_request_threshold: int = Field(
        default_factory=lambda: int(os.getenv("POOL_WATCHDOG_REQUEST_THRESHOLD", "20"))  # optimized default
    )
    pool_watchdog_force_recycle_age: int = Field(
        default_factory=lambda: int(os.getenv("POOL_WATCHDOG_FORCE_RECYCLE_AGE", "3600"))  # 1 hour - optimized default
    )

    # Health Check Configuration
    health_check_enabled: bool = Field(
        default_factory=lambda: os.getenv("HEALTH_CHECK_ENABLED", "true").lower() in ("true", "1", "t")
    )
    health_check_interval: int = Field(
        default_factory=lambda: int(os.getenv("HEALTH_CHECK_INTERVAL", "300"))  # 5 minutes
    )
    health_check_url: str = Field(
        default_factory=lambda: os.getenv("HEALTH_CHECK_URL", "https://example.com")  # Default test URL
    )
    health_check_timeout: int = Field(
        default_factory=lambda: int(os.getenv("HEALTH_CHECK_TIMEOUT", "60"))  # 60 seconds timeout
    )
    health_check_port: int = Field(
        default_factory=lambda: int(os.getenv("PORT", "8000"))  # Use same port as the application
    )

    # Use model_config instead of class Config to fix Pydantic v2 deprecation warning
    model_config = ConfigDict()

    def get_user_agent(self) -> str:
        """Get the appropriate user agent based on the browser engine."""
        if self.user_agent:
            return self.user_agent

        # Default user agents for each browser engine
        user_agents = {
            "chromium": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "firefox": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0",
            "webkit": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
        }

        return user_agents.get(self.browser_engine, user_agents["chromium"])

    def validate_browser_engine(self) -> str:
        """Validate and return the browser engine, defaulting to chromium if invalid."""
        valid_engines = ["chromium", "firefox", "webkit"]
        if self.browser_engine in valid_engines:
            return self.browser_engine
        return "chromium"


# Create global settings instance
settings = Settings()
