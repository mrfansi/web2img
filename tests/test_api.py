import asyncio
import json
import os
import time
from typing import Dict, Any, Optional

import aiohttp


async def test_screenshot_api(base_url: str = "http://localhost:8000") -> Dict[str, Any]:
    """Test the screenshot API with a sample URL.
    
    Args:
        base_url: The base URL of the API server
        
    Returns:
        Dictionary with test results
    """
    print("Testing web2img API with a sample URL...")
    
    # API endpoint
    url = f"{base_url}/screenshot"
    
    # Test data
    payload = {
        "url": "https://example.com",
        "format": "png",
        "width": 1280,
        "height": 720
    }
    
    result = {
        "success": False,
        "status": None,
        "response": None,
        "error": None,
        "duration": 0,
        "screenshot_url": None
    }
    
    start_time = time.time()
    
    # Make the request
    try:
        async with aiohttp.ClientSession() as session:
            try:
                async with session.post(url, json=payload, timeout=30) as response:
                    status = response.status
                    response_text = await response.text()
                    
                    result["status"] = status
                    result["response"] = response_text
                    
                    print(f"Status: {status}")
                    print(f"Response: {response_text}")
                    
                    if status == 200:
                        data = json.loads(response_text)
                        result["success"] = True
                        result["screenshot_url"] = data.get("url")
                        print(f"\nSuccess! Screenshot URL: {data.get('url')}")
                    else:
                        print(f"\nError: Failed to capture screenshot. Status code: {status}")
            except aiohttp.ClientError as e:
                error_msg = f"Client error: {str(e)}"
                result["error"] = error_msg
                print(f"\nError: {error_msg}")
                print("\nMake sure the server is running with 'python main.py'")
    except Exception as e:
        error_msg = f"Unexpected error: {str(e)}"
        result["error"] = error_msg
        print(f"\nError: {error_msg}")
    finally:
        result["duration"] = time.time() - start_time
        
    return result


if __name__ == "__main__":
    asyncio.run(test_screenshot_api())
