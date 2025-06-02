"""
URL Transformer Utility
Handles URL transformations for specific domains before screenshot capture
"""

import re
from urllib.parse import urlparse, urlunparse
from typing import Optional
from app.core.logging import get_logger

logger = get_logger("url_transformer")


class URLTransformer:
    """Handles URL transformations for specific domains."""
    
    def __init__(self):
        self.transformations = {
            'viding.co': {
                'new_domain': 'viding-co_website-revamp',
                'protocol': 'http'
            },
            'viding.org': {
                'new_domain': 'viding-org_website-revamp',
                'protocol': 'http'
            }
        }
    
    def transform_url(self, url: str) -> str:
        """
        Transform URL based on predefined rules.
        
        Args:
            url: Original URL to transform
            
        Returns:
            Transformed URL or original URL if no transformation needed
        """
        try:
            parsed = urlparse(url)
            original_url = url
            
            # Check if domain needs transformation
            domain = parsed.netloc.lower()
            
            # Handle www. prefix
            if domain.startswith('www.'):
                domain = domain[4:]
            
            # Check if this domain has a transformation rule
            if domain in self.transformations:
                transformation = self.transformations[domain]
                
                # Create new URL components
                new_scheme = transformation['protocol']
                new_netloc = transformation['new_domain']
                
                # Keep the original path, query, and fragment
                new_url = urlunparse((
                    new_scheme,
                    new_netloc,
                    parsed.path,
                    parsed.params,
                    parsed.query,
                    parsed.fragment
                ))
                
                logger.info(f"URL transformed: {original_url} -> {new_url}")
                return new_url
            
            # No transformation needed
            return url
            
        except Exception as e:
            logger.warning(f"Failed to transform URL {url}: {str(e)}")
            return url
    
    def is_transformable_domain(self, url: str) -> bool:
        """
        Check if URL domain can be transformed.
        
        Args:
            url: URL to check
            
        Returns:
            True if domain can be transformed, False otherwise
        """
        try:
            parsed = urlparse(url)
            domain = parsed.netloc.lower()
            
            # Handle www. prefix
            if domain.startswith('www.'):
                domain = domain[4:]
            
            return domain in self.transformations
        except:
            return False
    
    def get_original_domain(self, url: str) -> Optional[str]:
        """
        Get the original domain from a URL.
        
        Args:
            url: URL to extract domain from
            
        Returns:
            Domain name or None if extraction fails
        """
        try:
            parsed = urlparse(url)
            return parsed.netloc.lower()
        except:
            return None
    
    def add_transformation_rule(self, original_domain: str, new_domain: str, protocol: str = 'http'):
        """
        Add a new transformation rule.
        
        Args:
            original_domain: Original domain to transform
            new_domain: New domain to transform to
            protocol: Protocol to use (http or https)
        """
        self.transformations[original_domain.lower()] = {
            'new_domain': new_domain,
            'protocol': protocol
        }
        logger.info(f"Added transformation rule: {original_domain} -> {protocol}://{new_domain}")
    
    def remove_transformation_rule(self, domain: str):
        """
        Remove a transformation rule.
        
        Args:
            domain: Domain to remove transformation for
        """
        domain = domain.lower()
        if domain in self.transformations:
            del self.transformations[domain]
            logger.info(f"Removed transformation rule for: {domain}")
    
    def list_transformation_rules(self) -> dict:
        """
        Get all current transformation rules.
        
        Returns:
            Dictionary of transformation rules
        """
        return self.transformations.copy()


# Create a global instance
url_transformer = URLTransformer()


def transform_url(url: str) -> str:
    """
    Convenience function to transform a URL.
    
    Args:
        url: URL to transform
        
    Returns:
        Transformed URL
    """
    return url_transformer.transform_url(url)


def is_transformable_domain(url: str) -> bool:
    """
    Convenience function to check if URL domain can be transformed.
    
    Args:
        url: URL to check
        
    Returns:
        True if domain can be transformed
    """
    return url_transformer.is_transformable_domain(url)
