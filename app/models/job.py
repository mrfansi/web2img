import time
import uuid
from typing import Dict, List, Any, Optional
from datetime import datetime, timezone


class JobItem:
    """A single item in a batch job."""
    
    def __init__(self, item_id: str, request_data: Dict[str, Any]):
        self.id = item_id
        self.request_data = request_data
        self.status = "pending"  # pending, processing, success, error
        self.result: Optional[Dict[str, Any]] = None
        self.error: Optional[str] = None
        self.start_time: Optional[float] = None
        self.end_time: Optional[float] = None
        self.processing_time: Optional[float] = None
        self.cached: Optional[bool] = None
    
    def start_processing(self) -> None:
        """Mark the item as processing and record the start time."""
        self.status = "processing"
        self.start_time = time.time()
    
    def complete(self, result: Dict[str, Any], cached: bool = False) -> None:
        """Mark the item as completed successfully and record the result."""
        self.status = "success"
        self.result = result
        self.cached = cached
        self.end_time = time.time()
        if self.start_time is not None:
            self.processing_time = self.end_time - self.start_time
    
    def fail(self, error: str) -> None:
        """Mark the item as failed and record the error."""
        self.status = "error"
        self.error = error
        self.end_time = time.time()
        if self.start_time is not None:
            self.processing_time = self.end_time - self.start_time
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert the item to a dictionary for serialization."""
        result = {
            "id": self.id,
            "status": self.status
        }
        
        if self.result is not None:
            result["url"] = self.result.get("url")
        
        if self.error is not None:
            result["error"] = self.error
        
        if self.cached is not None:
            result["cached"] = self.cached
        
        return result


class BatchJob:
    """A batch job for processing multiple screenshot requests."""
    
    def __init__(self, items: List[Dict[str, Any]], config: Optional[Dict[str, Any]] = None):
        self.job_id = f"batch-{uuid.uuid4().hex[:8]}"
        self.items: Dict[str, JobItem] = {}
        self.config = config or {}
        self.status = "pending"  # pending, processing, completed, failed
        self.created_at = time.time()
        self.updated_at = self.created_at
        self.completed_at: Optional[float] = None
        self.total_processing_time: Optional[float] = None
        self.start_time: Optional[float] = None
        
        # Initialize items
        for item in items:
            item_id = item.get("id")
            if item_id:
                self.items[item_id] = JobItem(item_id, item)
    
    def start_processing(self) -> None:
        """Mark the job as processing and record the start time."""
        self.status = "processing"
        self.start_time = time.time()
        self.updated_at = self.start_time
    
    def update(self) -> None:
        """Update the job status based on item statuses."""
        self.updated_at = time.time()
        
        # Count items by status
        counts = self._count_items_by_status()
        
        # Update job status
        if counts["total"] == 0:
            self.status = "failed"
        elif counts["pending"] == 0 and counts["processing"] == 0:
            if counts["error"] > 0:
                if counts["success"] > 0:
                    self.status = "completed_with_errors"
                else:
                    self.status = "failed"
            else:
                self.status = "completed"
            
            # Record completion time if not already set
            if self.completed_at is None:
                self.completed_at = time.time()
                if self.start_time is not None:
                    self.total_processing_time = self.completed_at - self.start_time
        else:
            self.status = "processing"
    
    def _count_items_by_status(self) -> Dict[str, int]:
        """Count items by status."""
        counts = {
            "total": len(self.items),
            "pending": 0,
            "processing": 0,
            "success": 0,
            "error": 0
        }
        
        for item in self.items.values():
            counts[item.status] += 1
        
        return counts
    
    def get_item(self, item_id: str) -> Optional[JobItem]:
        """Get an item by ID."""
        return self.items.get(item_id)
    
    def get_next_pending_item(self) -> Optional[JobItem]:
        """Get the next pending item for processing."""
        for item in self.items.values():
            if item.status == "pending":
                return item
        return None
    
    def get_status(self) -> Dict[str, Any]:
        """Get the current status of the job."""
        counts = self._count_items_by_status()
        completed = counts["success"] + counts["error"]
        
        # Calculate estimated completion time
        estimated_completion = None
        if self.status == "processing" and completed > 0 and self.start_time is not None:
            elapsed = time.time() - self.start_time
            avg_time_per_item = elapsed / completed
            remaining_items = counts["pending"] + counts["processing"]
            estimated_remaining = avg_time_per_item * remaining_items
            estimated_completion_timestamp = time.time() + estimated_remaining
            estimated_completion = datetime.fromtimestamp(estimated_completion_timestamp, tz=timezone.utc).isoformat()
        
        return {
            "job_id": self.job_id,
            "status": self.status,
            "total": counts["total"],
            "completed": completed,
            "failed": counts["error"],
            "created_at": datetime.fromtimestamp(self.created_at, tz=timezone.utc).isoformat(),
            "updated_at": datetime.fromtimestamp(self.updated_at, tz=timezone.utc).isoformat(),
            "estimated_completion": estimated_completion
        }
    
    def get_results(self) -> Dict[str, Any]:
        """Get the results of the job."""
        counts = self._count_items_by_status()
        processing_time = self.total_processing_time or 0
        
        if self.total_processing_time is None and self.start_time is not None:
            processing_time = time.time() - self.start_time
        
        results = {
            "job_id": self.job_id,
            "status": self.status,
            "total": counts["total"],
            "succeeded": counts["success"],
            "failed": counts["error"],
            "processing_time": round(processing_time, 2),
            "results": [item.to_dict() for item in self.items.values()]
        }
        
        return results


class JobStore:
    """Store for batch jobs."""
    
    def __init__(self, max_jobs: int = 100, ttl: int = 3600):
        self.jobs: Dict[str, BatchJob] = {}
        self.max_jobs = max_jobs
        self.ttl = ttl  # Time to live in seconds
        self.last_cleanup = time.time()
    
    def create_job(self, items: List[Dict[str, Any]], config: Optional[Dict[str, Any]] = None) -> BatchJob:
        """Create a new batch job."""
        # Clean up old jobs if needed
        self._maybe_cleanup()
        
        # Create the job
        job = BatchJob(items, config)
        
        # Store the job
        self.jobs[job.job_id] = job
        
        return job
    
    def get_job(self, job_id: str) -> Optional[BatchJob]:
        """Get a job by ID."""
        return self.jobs.get(job_id)
    
    def delete_job(self, job_id: str) -> bool:
        """Delete a job by ID."""
        if job_id in self.jobs:
            del self.jobs[job_id]
            return True
        return False
    
    def _maybe_cleanup(self) -> None:
        """Clean up old jobs if needed."""
        current_time = time.time()
        
        # Only clean up every hour
        if current_time - self.last_cleanup < 3600:
            return
        
        self.last_cleanup = current_time
        
        # Check if we need to clean up
        if len(self.jobs) < self.max_jobs:
            return
        
        # Find jobs to delete
        jobs_to_delete = []
        for job_id, job in self.jobs.items():
            # Delete completed jobs that are older than TTL
            if job.status in ["completed", "completed_with_errors", "failed"] and current_time - job.updated_at > self.ttl:
                jobs_to_delete.append(job_id)
        
        # Delete jobs
        for job_id in jobs_to_delete:
            del self.jobs[job_id]
        
        # If we still have too many jobs, delete the oldest ones
        if len(self.jobs) > self.max_jobs:
            sorted_jobs = sorted(self.jobs.items(), key=lambda x: x[1].updated_at)
            jobs_to_delete = sorted_jobs[:len(self.jobs) - self.max_jobs]
            
            for job_id, _ in jobs_to_delete:
                del self.jobs[job_id]


# Create a singleton instance
job_store = JobStore()
