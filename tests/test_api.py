import asyncio
import json
import os

import aiohttp


async def test_screenshot_api():
    """Test the screenshot API with a sample URL."""
    print("Testing web2img API with a sample URL...")
    
    # API endpoint
    url = "http://localhost:8000/api/v1/screenshot"
    
    # Test data
    payload = {
        "url": "https://example.com",
        "format": "png",
        "width": 1280,
        "height": 720
    }
    
    # Make the request
    async with aiohttp.ClientSession() as session:
        try:
            async with session.post(url, json=payload) as response:
                status = response.status
                result = await response.text()
                
                print(f"Status: {status}")
                print(f"Response: {result}")
                
                if status == 200:
                    data = json.loads(result)
                    print(f"\nSuccess! Screenshot URL: {data['url']}")
                else:
                    print(f"\nError: Failed to capture screenshot. Status code: {status}")
        except Exception as e:
            print(f"\nError: {str(e)}")
            print("\nMake sure the server is running with 'python main.py'")


if __name__ == "__main__":
    asyncio.run(test_screenshot_api())
