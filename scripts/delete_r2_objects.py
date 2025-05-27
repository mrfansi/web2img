#!/usr/bin/env python
"""
Script to delete all objects in a Cloudflare R2 bucket.

This script will list all objects in the specified R2 bucket and delete them.
It uses the boto3 library to interact with R2 via the S3-compatible API.

Usage:
    python delete_r2_objects.py [--dry-run] [--confirm]

Options:
    --dry-run  List objects that would be deleted without actually deleting them
    --confirm  Skip the confirmation prompt and proceed with deletion
"""

import argparse
import os
import sys
import time
from typing import Dict, List, Optional

import boto3
import botocore
from botocore.exceptions import ClientError
from dotenv import load_dotenv

# Add the project root to the Python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# Load environment variables from .env file
load_dotenv()


def get_r2_client():
    """
Create and return a boto3 S3 client configured for Cloudflare R2.

Returns:
    boto3.client: Configured S3 client for R2
    """
    r2_access_key_id = os.getenv("R2_ACCESS_KEY_ID")
    r2_secret_access_key = os.getenv("R2_SECRET_ACCESS_KEY")
    r2_endpoint = os.getenv("R2_ENDPOINT")
    
    if not all([r2_access_key_id, r2_secret_access_key, r2_endpoint]):
        print("Error: R2 credentials not found in environment variables.")
        print("Please make sure R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_ENDPOINT are set.")
        sys.exit(1)

    boto_config = botocore.config.Config(
        max_pool_connections=50,  # Increase connection pool size
        connect_timeout=5,  # Connection timeout in seconds
        read_timeout=10,  # Read timeout in seconds
        retries={
            'max_attempts': 3,  # Maximum number of retry attempts
            'mode': 'standard'  # Standard retry mode with exponential backoff
        }
    )
    
    return boto3.client(
        's3',
        endpoint_url=r2_endpoint,
        aws_access_key_id=r2_access_key_id,
        aws_secret_access_key=r2_secret_access_key,
        region_name='auto',  # Cloudflare R2 uses 'auto' region
        config=boto_config  # Apply the connection pooling configuration
    )


def list_objects(client, bucket_name: str) -> List[Dict]:
    """
List all objects in the specified bucket.

Args:
    client: boto3 S3 client
    bucket_name: Name of the R2 bucket

Returns:
    List[Dict]: List of object dictionaries with 'Key' and 'Size' fields
    """
    try:
        # Use paginator to handle buckets with more than 1000 objects
        paginator = client.get_paginator('list_objects_v2')
        objects = []
        
        for page in paginator.paginate(Bucket=bucket_name):
            if 'Contents' in page:
                for obj in page['Contents']:
                    objects.append({
                        'Key': obj['Key'],
                        'Size': obj['Size'],
                        'LastModified': obj['LastModified']
                    })
        
        return objects
    except ClientError as e:
        print(f"Error listing objects: {e}")
        sys.exit(1)


def delete_objects(client, bucket_name: str, objects: List[Dict], dry_run: bool = False) -> int:
    """
Delete objects from the bucket.

Args:
    client: boto3 S3 client
    bucket_name: Name of the R2 bucket
    objects: List of objects to delete
    dry_run: If True, don't actually delete objects

Returns:
    int: Number of objects deleted
    """
    if not objects:
        print("No objects to delete.")
        return 0
    
    if dry_run:
        print(f"Would delete {len(objects)} objects (dry run).")
        return 0
    
    # Delete objects in batches of 1000 (S3 API limit)
    batch_size = 1000
    deleted_count = 0
    
    for i in range(0, len(objects), batch_size):
        batch = objects[i:i + batch_size]
        delete_keys = {'Objects': [{'Key': obj['Key']} for obj in batch]}
        
        try:
            result = client.delete_objects(Bucket=bucket_name, Delete=delete_keys)
            deleted_count += len(result.get('Deleted', []))
            
            # Check for errors
            if 'Errors' in result and result['Errors']:
                for error in result['Errors']:
                    print(f"Error deleting {error['Key']}: {error['Code']} - {error['Message']}")
            
            # Print progress
            print(f"Deleted {deleted_count}/{len(objects)} objects...")
            
        except ClientError as e:
            print(f"Error deleting batch: {e}")
    
    return deleted_count


def main():
    """
Main function to parse arguments and execute the script.
    """
    parser = argparse.ArgumentParser(description="Delete all objects in a Cloudflare R2 bucket.")
    parser.add_argument("--dry-run", action="store_true", help="List objects without deleting them")
    parser.add_argument("--confirm", action="store_true", help="Skip confirmation prompt")
    args = parser.parse_args()
    
    # Get bucket name from environment
    bucket_name = os.getenv("R2_BUCKET")
    if not bucket_name:
        print("Error: R2_BUCKET not found in environment variables.")
        sys.exit(1)
    
    # Create R2 client
    client = get_r2_client()
    
    # List objects
    print(f"Listing objects in bucket '{bucket_name}'...")
    objects = list_objects(client, bucket_name)
    
    if not objects:
        print("Bucket is empty.")
        return
    
    # Calculate total size
    total_size = sum(obj['Size'] for obj in objects)
    total_size_mb = total_size / (1024 * 1024)
    
    # Print summary
    print(f"Found {len(objects)} objects with total size of {total_size_mb:.2f} MB")
    
    # Show sample of objects
    if objects:
        print("\nSample of objects:")
        for obj in objects[:5]:
            print(f"  {obj['Key']} ({obj['Size'] / 1024:.2f} KB, Last Modified: {obj['LastModified']})")
        
        if len(objects) > 5:
            print(f"  ... and {len(objects) - 5} more")
    
    # Confirm deletion
    if not args.dry_run and not args.confirm:
        confirmation = input(f"\nAre you sure you want to delete all {len(objects)} objects? (yes/no): ")
        if confirmation.lower() != "yes":
            print("Deletion cancelled.")
            return
    
    # Delete objects
    start_time = time.time()
    deleted = delete_objects(client, bucket_name, objects, args.dry_run)
    elapsed_time = time.time() - start_time
    
    if args.dry_run:
        print(f"\nDry run complete. Would have deleted {len(objects)} objects.")
    else:
        print(f"\nDeleted {deleted} objects in {elapsed_time:.2f} seconds.")


if __name__ == "__main__":
    main()
