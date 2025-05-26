#!/usr/bin/env python3
"""
Async test utilities for web2img application.

This module provides common utilities for async testing, including
AsyncClient creation, waiting patterns, and other helper functions.
"""

import asyncio
import time
from typing import Callable, Any, Dict, Optional, TypeVar, Awaitable

import httpx
from fastapi.testclient import TestClient
from app.main import app

T = TypeVar('T')


async def get_async_client() -> httpx.AsyncClient:
    """
    Create an AsyncClient for testing with proper ASGI transport.
    
    This ensures the AsyncClient properly interacts with the FastAPI app
    and avoids event loop issues.
    
    Returns:
        AsyncClient instance configured for testing
    """
    transport = httpx.ASGITransport(app=app)
    return httpx.AsyncClient(transport=transport, base_url="http://localhost:8000")


async def wait_for_condition(
    condition_func: Callable[[], Awaitable[bool]],
    timeout: float = 30.0,
    interval: float = 1.0,
    error_message: str = "Condition not met within timeout period"
) -> bool:
    """
    Wait for an async condition to be true with timeout.
    
    Args:
        condition_func: Async function that returns True when condition is met
        timeout: Maximum time to wait in seconds
        interval: Time between condition checks in seconds
        error_message: Message to include in TimeoutError if condition not met
        
    Returns:
        True if condition was met, False if timeout occurred
        
    Example:
        async def is_job_complete():
            response = await client.get(f"/jobs/{job_id}/status")
            return response.json().get("status") == "completed"
            
        # Wait for job to complete
        completed = await wait_for_condition(is_job_complete, timeout=60)
    """
    start_time = time.time()
    while time.time() - start_time < timeout:
        if await condition_func():
            return True
        await asyncio.sleep(interval)
    return False


async def wait_for_response_condition(
    client: httpx.AsyncClient,
    url: str,
    condition_func: Callable[[Dict[str, Any]], bool],
    timeout: float = 30.0,
    interval: float = 1.0,
    method: str = "GET",
    params: Optional[Dict[str, Any]] = None,
    json_data: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None
) -> Optional[Dict[str, Any]]:
    """
    Poll an endpoint until a condition on the response is met.
    
    Args:
        client: AsyncClient instance to use for requests
        url: URL to poll
        condition_func: Function that takes response JSON and returns True when condition is met
        timeout: Maximum time to wait in seconds
        interval: Time between polls in seconds
        method: HTTP method to use (GET, POST, etc.)
        params: Query parameters for the request
        json_data: JSON data for the request body (for POST/PUT)
        headers: Headers for the request
        
    Returns:
        Response JSON if condition was met, None if timeout occurred
        
    Example:
        # Wait for job to reach 'completed' status
        response_data = await wait_for_response_condition(
            client,
            f"/jobs/{job_id}/status",
            lambda data: data.get("status") in ["completed", "failed"],
            timeout=60
        )
    """
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            if method.upper() == "GET":
                response = await client.get(url, params=params, headers=headers)
            elif method.upper() == "POST":
                response = await client.post(url, params=params, json=json_data, headers=headers)
            elif method.upper() == "PUT":
                response = await client.put(url, params=params, json=json_data, headers=headers)
            elif method.upper() == "DELETE":
                response = await client.delete(url, params=params, headers=headers)
            else:
                raise ValueError(f"Unsupported HTTP method: {method}")
                
            if response.status_code < 400:  # Only check condition for successful responses
                response_json = response.json()
                if condition_func(response_json):
                    return response_json
        except Exception as e:
            # Log exception but continue polling
            print(f"Error polling {url}: {str(e)}")
            
        await asyncio.sleep(interval)
    return None


async def cleanup_async_resources() -> None:
    """
    Clean up any lingering async resources to prevent event loop issues.
    
    This should be called at the end of async tests to ensure proper cleanup.
    """
    # Get all running tasks in the current event loop
    try:
        loop = asyncio.get_running_loop()
        tasks = [t for t in asyncio.all_tasks(loop=loop) 
                if t is not asyncio.current_task(loop)]
        
        if tasks:
            # Cancel all tasks and wait for them to complete
            for task in tasks:
                task.cancel()
                
            # Wait for all tasks to be cancelled
            await asyncio.gather(*tasks, return_exceptions=True)
    except RuntimeError:
        # No running event loop
        pass


async def run_concurrent_requests(
    client: httpx.AsyncClient,
    request_func: Callable[[httpx.AsyncClient, int], Awaitable[Any]],
    count: int,
    max_concurrency: Optional[int] = None
) -> list:
    """
    Run multiple concurrent requests with optional concurrency limit.
    
    Args:
        client: AsyncClient instance to use for requests
        request_func: Async function that takes client and request index as arguments
        count: Number of requests to make
        max_concurrency: Maximum number of concurrent requests (None for unlimited)
        
    Returns:
        List of results from all requests
        
    Example:
        async def make_request(client, i):
            response = await client.get(f"/items/{i}")
            return response.json()
            
        # Run 10 requests with max 5 concurrent
        results = await run_concurrent_requests(client, make_request, 10, 5)
    """
    semaphore = asyncio.Semaphore(max_concurrency) if max_concurrency else None
    
    async def wrapped_request(i):
        if semaphore:
            async with semaphore:
                return await request_func(client, i)
        else:
            return await request_func(client, i)
    
    tasks = [wrapped_request(i) for i in range(count)]
    return await asyncio.gather(*tasks, return_exceptions=True)
