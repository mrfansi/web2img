import os
import time
import asyncio
from pathlib import Path
from typing import Optional, Dict, Any

import boto3
import botocore.config
from botocore.exceptions import ClientError

from app.core.config import settings


class StorageService:
    """Service for storing files in Cloudflare R2."""

    def __init__(self):
        self._client = None
        self._lock = asyncio.Lock()
        self._last_error_time = 0
        self._error_count = 0
        self._backoff_time = 1  # Initial backoff time in seconds

    @property
    def client(self):
        """Get or create an S3 client for R2 with connection pooling."""
        if self._client is None:
            # Configure connection pooling for boto3
            boto_config = botocore.config.Config(
                max_pool_connections=50,  # Increase connection pool size
                connect_timeout=5,  # Connection timeout in seconds
                read_timeout=10,  # Read timeout in seconds
                retries={
                    'max_attempts': 3,  # Maximum number of retry attempts
                    'mode': 'standard'  # Standard retry mode with exponential backoff
                }
            )
            
            self._client = boto3.client(
                's3',
                endpoint_url=settings.r2_endpoint,
                aws_access_key_id=settings.r2_access_key_id,
                aws_secret_access_key=settings.r2_secret_access_key,
                region_name='auto',  # Cloudflare R2 uses 'auto' region
                config=boto_config  # Apply the connection pooling configuration
            )
        return self._client

    async def _handle_backoff(self):
        """Handle exponential backoff for rate limiting."""
        current_time = time.time()
        
        # Reset error count if it's been more than 60 seconds since the last error
        if current_time - self._last_error_time > 60:
            self._error_count = 0
            self._backoff_time = 1
            return
            
        # Implement exponential backoff
        if self._error_count > 0:
            # Wait for backoff time
            await asyncio.sleep(self._backoff_time)
            
            # Increase backoff time for next error (exponential)
            self._backoff_time = min(self._backoff_time * 2, 30)  # Cap at 30 seconds
    
    async def upload_file(self, file_path: str, content_type: Optional[str] = None) -> str:
        """Upload a file to R2 storage with retry logic and connection pooling.

        Args:
            file_path: Path to the file to upload
            content_type: Optional content type for the file

        Returns:
            Public URL to the uploaded file
        """
        # Apply backoff if needed
        await self._handle_backoff()
        
        # Use a lock to prevent too many concurrent uploads
        # This helps with rate limiting and connection pooling
        async with self._lock:
            try:
                # Get the filename from the path
                filename = os.path.basename(file_path)
                
                # Determine content type based on file extension if not provided
                if content_type is None:
                    extension = Path(file_path).suffix.lower()
                    content_type = {
                        '.png': 'image/png',
                        '.jpg': 'image/jpeg',
                        '.jpeg': 'image/jpeg',
                        '.webp': 'image/webp',
                    }.get(extension, 'application/octet-stream')
                
                # Prepare upload parameters
                key = f"screenshots/{filename}"
                extra_args = {
                    'ContentType': content_type,
                    'CacheControl': 'max-age=31536000',  # Cache for 1 year
                }
                
                # Upload to R2 with the screenshots/ prefix
                self.client.upload_file(
                    file_path,
                    settings.r2_bucket,
                    key,
                    ExtraArgs=extra_args
                )
                
                # Reset error count on successful upload
                self._error_count = 0
                self._backoff_time = 1
                
                # Construct the public URL using the configured public URL
                return f"{settings.r2_public_url}/{key}"
                
            except ClientError as e:
                # Update error tracking
                self._error_count += 1
                self._last_error_time = time.time()
                
                # Check for specific error types
                error_code = getattr(e, 'response', {}).get('Error', {}).get('Code', '')
                
                if error_code == 'SlowDown' or error_code == 'ThrottlingException':
                    # Handle rate limiting
                    if self._error_count <= 3:  # Retry up to 3 times
                        await asyncio.sleep(self._backoff_time)
                        return await self.upload_file(file_path, content_type)
                        
                raise RuntimeError(f"Failed to upload file to R2: {str(e)}") from e
                
            except Exception as e:
                # Update error tracking
                self._error_count += 1
                self._last_error_time = time.time()
                
                raise RuntimeError(f"Unexpected error uploading to R2: {str(e)}") from e

    async def cleanup(self):
        """Clean up resources."""
        try:
            # Close any open connections
            if self._client and hasattr(self._client, '_endpoint') and hasattr(self._client._endpoint, 'http_session'):
                await asyncio.to_thread(self._client._endpoint.http_session.close)
        except Exception:
            pass  # Ignore errors during cleanup
            
        self._client = None


# Create a singleton instance
storage_service = StorageService()
