import time
import uuid
import heapq
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime, timezone, timedelta
from enum import Enum


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


class JobPriority(str, Enum):
    """Priority levels for batch jobs."""
    HIGH = "high"
    NORMAL = "normal"
    LOW = "low"


class RecurrencePattern(str, Enum):
    """Recurrence patterns for batch jobs."""
    NONE = "none"
    HOURLY = "hourly"
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    CUSTOM = "custom"  # For custom cron-like expressions


class BatchJob:
    """A batch job for processing multiple screenshot requests."""
    
    def __init__(self, items: List[Dict[str, Any]], config: Optional[Dict[str, Any]] = None):
        self.job_id = f"batch-{uuid.uuid4().hex[:8]}"
        self.items: Dict[str, JobItem] = {}
        self.config = config or {}
        self.status = "pending"  # pending, processing, completed, failed, scheduled
        self.created_at = time.time()
        self.updated_at = self.created_at
        self.completed_at: Optional[float] = None
        self.total_processing_time: Optional[float] = None
        self.start_time: Optional[float] = None
        
        # Priority queue support
        self.priority = JobPriority(self.config.get("priority", JobPriority.NORMAL))
        
        # Job scheduling support
        self.scheduled_time: Optional[float] = None
        if "scheduled_time" in self.config:
            scheduled_time = self.config.get("scheduled_time")
            if isinstance(scheduled_time, str):
                try:
                    # Parse ISO format datetime string
                    dt = datetime.fromisoformat(scheduled_time.replace('Z', '+00:00'))
                    self.scheduled_time = dt.timestamp()
                    self.status = "scheduled"
                except ValueError:
                    # If parsing fails, ignore the scheduled time
                    pass
            elif isinstance(scheduled_time, (int, float)):
                # Assume it's a timestamp
                self.scheduled_time = float(scheduled_time)
                self.status = "scheduled"
        
        # Recurring job support
        recurrence_value = self.config.get("recurrence", RecurrencePattern.NONE.value)
        if recurrence_value is None:
            self.recurrence_pattern = None
        else:
            self.recurrence_pattern = RecurrencePattern(recurrence_value)
        self.recurrence_count = self.config.get("recurrence_count", 0)  # 0 means infinite
        self.recurrence_interval = self.config.get("recurrence_interval", 1)  # Default interval is 1
        self.parent_job_id: Optional[str] = self.config.get("parent_job_id")  # For tracking job lineage
        self.recurrence_cron: Optional[str] = self.config.get("recurrence_cron")  # For custom cron expressions
        self.next_scheduled_time: Optional[float] = None
        
        if self.recurrence_pattern != RecurrencePattern.NONE and self.scheduled_time:
            self._calculate_next_scheduled_time()
        
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
    
    def _add_months(self, dt: datetime, months: int) -> datetime:
        """
        Add a given number of months to a datetime, safely handling month-end edge cases.
        
        Args:
            dt: The base datetime
            months: Number of months to add
            
        Returns:
            A new datetime with the months added
        """
        # Calculate target year and month
        year = dt.year + ((dt.month - 1 + months) // 12)
        month = ((dt.month - 1 + months) % 12) + 1
        
        # Get the last day of the target month
        if month == 2:
            # Handle February and leap years
            if (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0):
                last_day = 29
            else:
                last_day = 28
        elif month in [4, 6, 9, 11]:
            last_day = 30
        else:
            last_day = 31
        
        # Use the original day if possible, otherwise use the last day of the month
        day = min(dt.day, last_day)
        
        # Create the new datetime with the same time components
        return dt.replace(year=year, month=month, day=day)
    
    def _calculate_next_scheduled_time(self) -> None:
        """Calculate the next scheduled time based on recurrence pattern."""
        if self.recurrence_pattern is None or self.recurrence_pattern == RecurrencePattern.NONE or not self.scheduled_time:
            self.next_scheduled_time = None
            return
        
        # Use the scheduled time as base if it's in the future, otherwise use current time
        base_time = max(self.scheduled_time, time.time())
        base_dt = datetime.fromtimestamp(base_time, tz=timezone.utc)
        
        if self.recurrence_pattern == RecurrencePattern.HOURLY:
            next_dt = base_dt + timedelta(hours=self.recurrence_interval)
        elif self.recurrence_pattern == RecurrencePattern.DAILY:
            next_dt = base_dt + timedelta(days=self.recurrence_interval)
        elif self.recurrence_pattern == RecurrencePattern.WEEKLY:
            next_dt = base_dt + timedelta(weeks=self.recurrence_interval)
        elif self.recurrence_pattern == RecurrencePattern.MONTHLY:
            # Add months safely handling month-end edge cases
            next_dt = self._add_months(base_dt, self.recurrence_interval)
        elif self.recurrence_pattern == RecurrencePattern.CUSTOM and self.recurrence_cron:
            # For custom cron expressions, we would need a cron parser library
            raise NotImplementedError(
                "Custom cron expression parsing is not yet implemented. " 
                "Please use one of the standard recurrence patterns (hourly, daily, weekly, monthly)."
            )
        else:
            self.next_scheduled_time = None
            return
        
        self.next_scheduled_time = next_dt.timestamp()
    
    def create_recurrence(self) -> Optional['BatchJob']:
        """Create a new job based on this job's recurrence pattern."""
        if self.recurrence_pattern is None or self.recurrence_pattern == RecurrencePattern.NONE or not self.next_scheduled_time:
            return None
        
        # Check if we've reached the recurrence count limit
        if self.recurrence_count > 0:
            # Count existing recurrences by traversing the parent chain
            recurrence_count = 1  # This job counts as 1
            current_job_id = self.parent_job_id
            
            # Traverse the parent chain to count recurrences
            # Use the module-level job_store variable (no need for local import)
            while current_job_id:
                # Look up the parent job
                parent_job = job_store.get_job(current_job_id)
                if parent_job:
                    recurrence_count += 1
                    current_job_id = parent_job.parent_job_id
                    # If we've reached the limit, stop recurring
                    if recurrence_count >= self.recurrence_count:
                        return None
                else:
                    # Parent job not found, break the chain
                    break
        
        # Create a new config for the recurrence
        new_config = self.config.copy()
        new_config["scheduled_time"] = self.next_scheduled_time
        new_config["parent_job_id"] = self.job_id
        
        # Create items for the new job
        items = [item.request_data for item in self.items.values()]
        
        # Create a new job with the same items and updated config
        new_job = BatchJob(items, new_config)
        
        return new_job
    
    def get_status(self) -> Dict[str, Any]:
        """Get the current status of the job."""
        # Count items by status
        counts = self._count_items_by_status()
        
        # Calculate completed items
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
        
        # Add scheduled time if applicable
        scheduled_time = None
        if self.scheduled_time:
            scheduled_time = datetime.fromtimestamp(self.scheduled_time, tz=timezone.utc).isoformat()
        
        # Add next scheduled time if applicable
        next_scheduled_time = None
        if self.next_scheduled_time:
            next_scheduled_time = datetime.fromtimestamp(self.next_scheduled_time, tz=timezone.utc).isoformat()
        
        return {
            "job_id": self.job_id,
            "status": self.status,
            "priority": self.priority,
            "total": counts["total"],
            "completed": completed,
            "failed": counts["error"],
            "created_at": datetime.fromtimestamp(self.created_at, tz=timezone.utc).isoformat(),
            "updated_at": datetime.fromtimestamp(self.updated_at, tz=timezone.utc).isoformat(),
            "scheduled_time": scheduled_time,
            "recurrence": self.recurrence_pattern,
            "next_scheduled_time": next_scheduled_time,
            "estimated_completion": estimated_completion
        }
    
    def get_results(self) -> Dict[str, Any]:
        """Get the results of the job."""
        counts = self._count_items_by_status()
        processing_time = self.total_processing_time or 0
        
        if self.total_processing_time is None and self.start_time is not None:
            processing_time = time.time() - self.start_time
        
        # Add scheduled time if applicable
        scheduled_time = None
        if self.scheduled_time:
            scheduled_time = datetime.fromtimestamp(self.scheduled_time, tz=timezone.utc).isoformat()
        
        results = {
            "job_id": self.job_id,
            "status": self.status,
            "priority": self.priority,
            "total": counts["total"],
            "succeeded": counts["success"],
            "failed": counts["error"],
            "processing_time": round(processing_time, 2),
            "scheduled_time": scheduled_time,
            "recurrence": self.recurrence_pattern,
            "results": [item.to_dict() for item in self.items.values()]
        }
        
        return results


class PriorityQueue:
    """A priority queue for batch jobs."""
    
    def __init__(self):
        self.queue: List[Tuple[int, float, str]] = []  # (priority, timestamp, job_id)
        self.job_map: Dict[str, BatchJob] = {}  # Maps job_id to BatchJob
    
    def push(self, job: BatchJob) -> None:
        """Add a job to the queue with its priority."""
        # Convert string priority to numeric (lower number = higher priority)
        priority_map = {
            JobPriority.HIGH: 0,
            JobPriority.NORMAL: 1,
            JobPriority.LOW: 2
        }
        priority_value = priority_map.get(job.priority, 1)  # Default to normal priority
        
        # Add to heap queue (priority, timestamp for tie-breaking, job_id)
        heapq.heappush(self.queue, (priority_value, time.time(), job.job_id))
        self.job_map[job.job_id] = job
    
    def pop(self) -> Optional[BatchJob]:
        """Get the highest priority job from the queue."""
        if not self.queue:
            return None
        
        # Pop from heap queue
        _, _, job_id = heapq.heappop(self.queue)
        
        # Get the job from the map
        job = self.job_map.pop(job_id, None)
        return job
    
    def peek(self) -> Optional[BatchJob]:
        """Get the highest priority job without removing it."""
        if not self.queue:
            return None
        
        # Get the job ID from the top of the heap
        _, _, job_id = self.queue[0]
        
        # Get the job from the map
        return self.job_map.get(job_id)
    
    def remove(self, job_id: str) -> bool:
        """Remove a job from the queue."""
        if job_id not in self.job_map:
            return False
        
        # Remove from job map
        del self.job_map[job_id]
        
        # Find and remove from queue
        # Note: This is O(n) operation, but we can't easily remove from a heap
        # In a production system, we might mark it as removed and filter during pop
        self.queue = [(p, ts, jid) for p, ts, jid in self.queue if jid != job_id]
        heapq.heapify(self.queue)
        
        return True
    
    def is_empty(self) -> bool:
        """Check if the queue is empty."""
        return len(self.queue) == 0
    
    def size(self) -> int:
        """Get the number of jobs in the queue."""
        return len(self.queue)


class JobStore:
    """Store for batch jobs."""
    
    def __init__(self, max_jobs: int = 100, ttl: int = 3600):
        self.jobs: Dict[str, BatchJob] = {}
        self.max_jobs = max_jobs
        self.ttl = ttl  # Time to live in seconds
        self.last_cleanup = time.time()
        
        # Priority queue for pending jobs
        self.pending_queue = PriorityQueue()
        
        # Queue for scheduled jobs (sorted by scheduled time)
        self.scheduled_queue: List[Tuple[float, str]] = []  # (scheduled_time, job_id)
    
    def create_job(self, items: List[Dict[str, Any]], config: Optional[Dict[str, Any]] = None) -> BatchJob:
        """Create a new batch job."""
        # Clean up old jobs if needed
        self._maybe_cleanup()
        
        # Create the job
        job = BatchJob(items, config)
        
        # Store the job
        self.jobs[job.job_id] = job
        
        # Add to appropriate queue based on status
        if job.status == "scheduled":
            # Add to scheduled queue
            if job.scheduled_time:
                heapq.heappush(self.scheduled_queue, (job.scheduled_time, job.job_id))
        elif job.status == "pending":
            # Add to pending queue
            self.pending_queue.push(job)
        
        return job
    
    def get_job(self, job_id: str) -> Optional[BatchJob]:
        """Get a job by ID."""
        return self.jobs.get(job_id)
    
    def get_next_pending_job(self) -> Optional[BatchJob]:
        """Get the next pending job based on priority."""
        return self.pending_queue.pop()
    
    def get_due_scheduled_jobs(self) -> List[BatchJob]:
        """Get all scheduled jobs that are due for execution."""
        current_time = time.time()
        due_jobs = []
        
        # Check if there are any scheduled jobs
        while self.scheduled_queue and self.scheduled_queue[0][0] <= current_time:
            # Pop the job from the scheduled queue
            _, job_id = heapq.heappop(self.scheduled_queue)
            
            # Get the job
            job = self.jobs.get(job_id)
            if job and job.status == "scheduled":
                due_jobs.append(job)
        
        return due_jobs
    
    def schedule_job(self, job: BatchJob, scheduled_time: float) -> bool:
        """Schedule a job for future execution."""
        if job.job_id not in self.jobs:
            return False
        
        # Update job status and scheduled time
        job.status = "scheduled"
        job.scheduled_time = scheduled_time
        job.updated_at = time.time()
        
        # Add to scheduled queue
        heapq.heappush(self.scheduled_queue, (scheduled_time, job.job_id))
        
        # Remove from pending queue if it's there
        self.pending_queue.remove(job.job_id)
        
        return True
    
    def delete_job(self, job_id: str) -> bool:
        """Delete a job by ID."""
        if job_id in self.jobs:
            # Remove from jobs dictionary
            del self.jobs[job_id]
            
            # Remove from pending queue if it's there
            self.pending_queue.remove(job_id)
            
            # Remove from scheduled queue if it's there
            # This is O(n) operation, but we can't easily remove from a heap
            self.scheduled_queue = [(st, jid) for st, jid in self.scheduled_queue if jid != job_id]
            heapq.heapify(self.scheduled_queue)
            
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
            self.delete_job(job_id)
        
        # If we still have too many jobs, delete the oldest ones
        if len(self.jobs) > self.max_jobs:
            sorted_jobs = sorted(self.jobs.items(), key=lambda x: x[1].updated_at)
            jobs_to_delete = sorted_jobs[:len(self.jobs) - self.max_jobs]
            
            for job_id, _ in jobs_to_delete:
                self.delete_job(job_id)


# Create a singleton instance
job_store = JobStore()
