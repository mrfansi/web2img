"""
URL Transformer API Endpoints
Provides endpoints to manage URL transformation rules
"""

from typing import Dict, Any, List
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.utils.url_transformer import url_transformer
from app.core.logging import get_logger

# Create router
router = APIRouter(tags=["url-transformer"])
logger = get_logger("url_transformer_api")


class TransformationRule(BaseModel):
    """Model for transformation rule."""
    original_domain: str = Field(..., description="Original domain to transform")
    new_domain: str = Field(..., description="New domain to transform to")
    protocol: str = Field(default="http", description="Protocol to use (http or https)")


class URLTransformRequest(BaseModel):
    """Model for URL transformation request."""
    url: str = Field(..., description="URL to transform")


class URLTransformResponse(BaseModel):
    """Model for URL transformation response."""
    original_url: str = Field(..., description="Original URL")
    transformed_url: str = Field(..., description="Transformed URL")
    was_transformed: bool = Field(..., description="Whether transformation occurred")


class TransformationRulesResponse(BaseModel):
    """Model for transformation rules response."""
    rules: Dict[str, Dict[str, str]] = Field(..., description="Current transformation rules")


@router.get(
    "/url-transformer/rules",
    response_model=TransformationRulesResponse,
    summary="Get URL transformation rules",
    description="Get all current URL transformation rules"
)
async def get_transformation_rules() -> TransformationRulesResponse:
    """Get all current URL transformation rules."""
    rules = url_transformer.list_transformation_rules()
    return TransformationRulesResponse(rules=rules)


@router.post(
    "/url-transformer/transform",
    response_model=URLTransformResponse,
    summary="Transform a URL",
    description="Transform a URL using current transformation rules"
)
async def transform_url_endpoint(request: URLTransformRequest) -> URLTransformResponse:
    """Transform a URL using current transformation rules."""
    original_url = request.url
    transformed_url = url_transformer.transform_url(original_url)
    was_transformed = transformed_url != original_url
    
    logger.info(f"URL transformation request: {original_url} -> {transformed_url} (transformed: {was_transformed})")
    
    return URLTransformResponse(
        original_url=original_url,
        transformed_url=transformed_url,
        was_transformed=was_transformed
    )


@router.post(
    "/url-transformer/rules",
    summary="Add URL transformation rule",
    description="Add a new URL transformation rule"
)
async def add_transformation_rule(rule: TransformationRule) -> Dict[str, str]:
    """Add a new URL transformation rule."""
    try:
        url_transformer.add_transformation_rule(
            rule.original_domain,
            rule.new_domain,
            rule.protocol
        )
        
        logger.info(f"Added transformation rule: {rule.original_domain} -> {rule.protocol}://{rule.new_domain}")
        
        return {
            "message": f"Transformation rule added successfully",
            "original_domain": rule.original_domain,
            "new_domain": rule.new_domain,
            "protocol": rule.protocol
        }
    except Exception as e:
        logger.error(f"Failed to add transformation rule: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Failed to add transformation rule: {str(e)}")


@router.delete(
    "/url-transformer/rules/{domain}",
    summary="Remove URL transformation rule",
    description="Remove a URL transformation rule for a specific domain"
)
async def remove_transformation_rule(domain: str) -> Dict[str, str]:
    """Remove a URL transformation rule."""
    try:
        # Check if rule exists
        rules = url_transformer.list_transformation_rules()
        if domain.lower() not in rules:
            raise HTTPException(status_code=404, detail=f"No transformation rule found for domain: {domain}")
        
        url_transformer.remove_transformation_rule(domain)
        
        logger.info(f"Removed transformation rule for domain: {domain}")
        
        return {
            "message": f"Transformation rule removed successfully",
            "domain": domain
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to remove transformation rule: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Failed to remove transformation rule: {str(e)}")


@router.get(
    "/url-transformer/check",
    summary="Check if URL is transformable",
    description="Check if a URL domain can be transformed"
)
async def check_transformable(url: str = Query(..., description="URL to check")) -> Dict[str, Any]:
    """Check if a URL domain can be transformed."""
    is_transformable = url_transformer.is_transformable_domain(url)
    original_domain = url_transformer.get_original_domain(url)
    
    result = {
        "url": url,
        "is_transformable": is_transformable,
        "original_domain": original_domain
    }
    
    if is_transformable:
        transformed_url = url_transformer.transform_url(url)
        result["transformed_url"] = transformed_url
    
    return result


@router.get(
    "/url-transformer/test",
    summary="Test URL transformations",
    description="Test URL transformations with common examples"
)
async def test_transformations() -> Dict[str, Any]:
    """Test URL transformations with common examples."""
    test_urls = [
        "https://viding.co",
        "https://www.viding.co",
        "https://viding.co/about",
        "https://viding.org",
        "https://www.viding.org",
        "https://viding.org/contact",
        "https://example.com",
        "https://google.com"
    ]
    
    results = []
    for url in test_urls:
        transformed = url_transformer.transform_url(url)
        is_transformable = url_transformer.is_transformable_domain(url)
        
        results.append({
            "original": url,
            "transformed": transformed,
            "was_transformed": transformed != url,
            "is_transformable": is_transformable
        })
    
    return {
        "test_results": results,
        "total_tests": len(test_urls),
        "transformed_count": sum(1 for r in results if r["was_transformed"])
    }


# Add some example responses for documentation
@router.get(
    "/url-transformer/examples",
    summary="Get transformation examples",
    description="Get examples of URL transformations"
)
async def get_transformation_examples() -> Dict[str, Any]:
    """Get examples of URL transformations."""
    return {
        "examples": [
            {
                "description": "viding.co transformation",
                "original": "https://viding.co",
                "transformed": "http://viding-co_website-revamp",
                "rule": {
                    "domain": "viding.co",
                    "new_domain": "viding-co_website-revamp",
                    "protocol": "http"
                }
            },
            {
                "description": "viding.org transformation",
                "original": "https://viding.org",
                "transformed": "http://viding-org_website-revamp",
                "rule": {
                    "domain": "viding.org",
                    "new_domain": "viding-org_website-revamp",
                    "protocol": "http"
                }
            },
            {
                "description": "Path preservation",
                "original": "https://viding.co/about?ref=test#section",
                "transformed": "http://viding-co_website-revamp/about?ref=test#section",
                "note": "Paths, query parameters, and fragments are preserved"
            }
        ],
        "usage_notes": [
            "URL transformations are applied automatically in /screenshot and /batch/screenshots endpoints",
            "Original URLs are used for caching to maintain consistency",
            "Transformations are logged for debugging purposes",
            "Custom transformation rules can be added via the API"
        ]
    }
