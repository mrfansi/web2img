import os
import time
import asyncio
import shutil
from pathlib import Path
from typing import Optional

import boto3
import botocore.config
from botocore.exceptions import ClientError

from app.core.config import settings


class StorageService:
    """Service for storing files in Cloudflare R2 or local disk."""

    def __init__(self):
        self._client = None
        self._lock = asyncio.Lock()
        self._last_error_time = 0
        self._error_count = 0
        self._backoff_time = 1  # Initial backoff time in seconds
        self._logger = None  # Will be initialized later
        
    @property
    def logger(self):
        """Get or create a logger."""
        if self._logger is None:
            from app.core.logging import get_logger
            self._logger = get_logger("storage_service")
        return self._logger

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
        """Upload a file to R2 storage or save to local disk based on storage mode.

        Args:
            file_path: Path to the file to upload/save
            content_type: Optional content type for the file

        Returns:
            Public URL to the uploaded/saved file
        """
        if settings.storage_mode.lower() == "local":
            return await self._save_to_local(file_path)
        else:
            return await self._upload_to_r2(file_path, content_type)

    async def _save_to_local(self, file_path: str) -> str:
        """Save file to local storage.

        Args:
            file_path: Path to the file to save

        Returns:
            Public URL to the saved file
        """
        try:
            # Ensure local storage directory exists
            os.makedirs(settings.local_storage_dir, exist_ok=True)

            # Get the filename from the path
            filename = os.path.basename(file_path)

            # Create destination path
            dest_path = os.path.join(settings.local_storage_dir, filename)

            # Get absolute paths to compare
            abs_source = os.path.abspath(file_path)
            abs_dest = os.path.abspath(dest_path)

            # If source and destination are the same, no need to copy
            if abs_source == abs_dest:
                self.logger.debug(f"File already in correct location: {abs_dest}")
            else:
                # Move file to local storage directory (more efficient than copy for temp files)
                await asyncio.to_thread(shutil.move, file_path, dest_path)
                self.logger.debug(f"Moved file from {file_path} to {dest_path}")

            # Construct the public URL
            return f"{settings.local_storage_base_url}/{filename}"

        except Exception as e:
            raise RuntimeError(f"Failed to save file to local storage: {str(e)}") from e

    async def _upload_to_r2(self, file_path: str, content_type: Optional[str] = None) -> str:
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
                        return await self._upload_to_r2(file_path, content_type)

                raise RuntimeError(f"Failed to upload file to R2: {str(e)}") from e

            except Exception as e:
                # Update error tracking
                self._error_count += 1
                self._last_error_time = time.time()

                raise RuntimeError(f"Unexpected error uploading to R2: {str(e)}") from e

    def configure_r2_lifecycle_policy(self) -> bool:
        """Configure R2 bucket lifecycle policy to expire objects after specified days.
        
        Returns:
            bool: True if configuration was successful, False otherwise
        """
        try:
            # Define lifecycle configuration
            lifecycle_config = {
                'Rules': [
                    {
                        'ID': f'Delete after {settings.r2_object_expiration_days} days',
                        'Status': 'Enabled',
                        'Prefix': '',  # Apply to all objects
                        'Expiration': {'Days': settings.r2_object_expiration_days},
                    }
                ]
            }
            
            # Apply lifecycle configuration to bucket
            self.client.put_bucket_lifecycle_configuration(
                Bucket=settings.r2_bucket,
                LifecycleConfiguration=lifecycle_config
            )
            
            self.logger.info(f"Successfully configured {settings.r2_object_expiration_days}-day expiration policy for bucket {settings.r2_bucket}")
            return True
            
        except Exception as e:
            error_str = str(e)
            error_type = type(e).__name__
            
            # Provide more specific guidance for common errors
            if "AccessDenied" in error_str:
                self.logger.error(
                    f"Access denied when configuring lifecycle policy. Your R2 credentials need 'PutBucketLifecycleConfiguration' permission.", 
                    {
                        "error": error_str,
                        "error_type": error_type,
                        "bucket": settings.r2_bucket,
                        "required_permission": "PutBucketLifecycleConfiguration",
                        "resolution": "Update your R2 API token permissions in the Cloudflare dashboard or manually configure the lifecycle policy."
                    }
                )
                # Continue application startup despite this error
                self.logger.warning(
                    f"Application will continue without automatic expiration. Objects in {settings.r2_bucket} will need to be manually expired or configured through the Cloudflare dashboard."
                )
            else:
                self.logger.error(f"Failed to configure lifecycle policy: {error_str}", {
                    "error": error_str,
                    "error_type": error_type,
                    "bucket": settings.r2_bucket,
                    "expiration_days": settings.r2_object_expiration_days
                })
            return False
    
    async def startup(self):
        """Initialize the storage service and configure lifecycle policies."""
        self.logger.info(f"Initializing storage service in {settings.storage_mode} mode")

        if settings.storage_mode.lower() == "local":
            # Initialize local storage
            try:
                os.makedirs(settings.local_storage_dir, exist_ok=True)
                self.logger.info(f"Local storage directory created: {settings.local_storage_dir}")
            except Exception as e:
                self.logger.error(f"Error creating local storage directory: {str(e)}")
                raise
        else:
            # Configure R2 lifecycle policy
            # Run in a thread to avoid blocking the event loop
            try:
                result = await asyncio.to_thread(self.configure_r2_lifecycle_policy)

                if result:
                    self.logger.info(f"R2 storage service initialized with {settings.r2_object_expiration_days}-day expiration policy")
                else:
                    self.logger.warning("R2 storage service initialized but failed to configure expiration policy")
            except Exception as e:
                self.logger.error(f"Error during R2 storage service initialization: {str(e)}", {
                    "error": str(e),
                    "error_type": type(e).__name__
                })
            
    async def get_storage_stats(self):
        """Get storage statistics including object count and total size."""
        try:
            # Run in a thread to avoid blocking the event loop
            stats = await asyncio.to_thread(self._get_storage_stats_impl)
            return stats
        except Exception as e:
            self.logger.error(f"Error getting storage stats: {str(e)}")
            return {"error": str(e)}

    def _get_storage_stats_impl(self):
        """Implementation of storage stats collection."""
        try:
            # List all objects in the bucket
            response = self.client.list_objects_v2(Bucket=settings.r2_bucket)
            
            # Calculate statistics
            object_count = response.get('KeyCount', 0)
            total_size = sum(obj['Size'] for obj in response.get('Contents', []))
            
            # Get lifecycle configuration
            try:
                lifecycle = self.client.get_bucket_lifecycle_configuration(Bucket=settings.r2_bucket)
                expiration_days = lifecycle.get('Rules', [{}])[0].get('Expiration', {}).get('Days', 'Not configured')
            except Exception:
                expiration_days = 'Not configured'
            
            return {
                "object_count": object_count,
                "total_size_bytes": total_size,
                "expiration_days": expiration_days,
                "bucket_name": settings.r2_bucket
            }
        except Exception as e:
            self.logger.error(f"Error in _get_storage_stats_impl: {str(e)}")
            return {
                "error": str(e),
                "error_type": type(e).__name__
            }
            
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
