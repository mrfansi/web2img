import base64
import hashlib
import hmac

from app.core.config import settings


class ImgproxyService:
    """Service for generating signed imgproxy URLs."""

    def __init__(self):
        # Convert hex key and salt to bytes
        self.key = bytes.fromhex(settings.imgproxy_key)
        self.salt = bytes.fromhex(settings.imgproxy_salt)
        self.base_url = settings.imgproxy_base_url

    def generate_url(self, image_url: str, width: int, height: int, format: str) -> str:
        """Generate a signed imgproxy URL.

        Args:
            image_url: URL to the original image
            width: Desired width for resizing
            height: Desired height for resizing
            format: Desired output format (png, jpeg, webp)

        Returns:
            Signed imgproxy URL
        """
        # Encode the image URL in base64
        encoded_url = base64.urlsafe_b64encode(image_url.encode()).rstrip(b'=')
        
        # Create the path for imgproxy
        path = f"/resize:fit:{width}:{height}/format:{format}/{encoded_url.decode()}"
        
        # Generate the signature
        signature = self._sign(path.encode())
        
        # Return the full URL
        return f"{self.base_url}/{signature}{path}"

    def _sign(self, path: bytes) -> str:
        """Sign the path using HMAC-SHA256 with the key and salt.

        Args:
            path: Path to sign

        Returns:
            Base64-encoded signature
        """
        # Create the HMAC
        h = hmac.new(self.key, self.salt + path, hashlib.sha256)
        
        # Encode the signature in base64
        signature = base64.urlsafe_b64encode(h.digest()).rstrip(b'=')
        
        # Return the signature as a string
        return signature.decode()


# Create a singleton instance
imgproxy_service = ImgproxyService()
