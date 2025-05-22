import os
from pathlib import Path
from typing import Optional

import boto3
from botocore.exceptions import ClientError

from app.core.config import settings


class StorageService:
    """Service for storing files in Cloudflare R2."""

    def __init__(self):
        self._client = None

    @property
    def client(self):
        """Get or create an S3 client for R2."""
        if self._client is None:
            self._client = boto3.client(
                's3',
                endpoint_url=settings.r2_endpoint,
                aws_access_key_id=settings.r2_access_key_id,
                aws_secret_access_key=settings.r2_secret_access_key,
                region_name='auto',  # Cloudflare R2 uses 'auto' region
            )
        return self._client

    async def upload_file(self, file_path: str, content_type: Optional[str] = None) -> str:
        """Upload a file to R2 storage.

        Args:
            file_path: Path to the file to upload
            content_type: Optional content type for the file

        Returns:
            Public URL to the uploaded file
        """
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
            
            # Upload to R2 with the screenshots/ prefix
            key = f"screenshots/{filename}"
            self.client.upload_file(
                file_path,
                settings.r2_bucket,
                key,
                ExtraArgs={'ContentType': content_type}
            )
            
            # Use the configured R2_PUBLIC_URL
            # This should be a custom domain mapped to your R2 bucket
            # Format: https://web2img.viding.co/screenshots/<filename>
            
            # Construct the public URL using the configured public URL
            return f"{settings.r2_public_url}/{key}"
        except ClientError as e:
            raise RuntimeError(f"Failed to upload file to R2: {str(e)}") from e
        except Exception as e:
            raise RuntimeError(f"Unexpected error uploading to R2: {str(e)}") from e

    async def cleanup(self):
        """Clean up resources."""
        self._client = None


# Create a singleton instance
storage_service = StorageService()
