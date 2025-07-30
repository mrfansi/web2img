# Batch Screenshot Empty Results Fix

## Problem Description

Batch screenshot jobs were completing with status "completed" but returning empty results arrays. The issue was caused by a **race condition between job completion and job cleanup** in the BullMQ queue configuration.

### Root Cause

The screenshot queue worker was configured with:
```typescript
removeOnComplete: { count: 100 }
removeOnFail: { count: 50 }
```

This caused completed jobs to be automatically removed from the queue after 100 jobs. When the batch worker tried to poll for job status, the jobs had already been cleaned up, causing `getJobStatus()` to return `null`.

### Symptoms

- Batch jobs show status "completed"
- `total: 1, succeeded: 0, failed: 0`
- Empty `results: []` array
- Processing time is very short (3 seconds in your example)

## Solution Implemented

### 1. Increased Job Retention Limits

**File:** `app/services/screenshot_queue_worker.ts`

Changed from:
```typescript
removeOnComplete: { count: 100 }
removeOnFail: { count: 50 }
```

To:
```typescript
removeOnComplete: { count: env.get('SCREENSHOT_QUEUE_REMOVE_ON_COMPLETE', 1000) }
removeOnFail: { count: env.get('SCREENSHOT_QUEUE_REMOVE_ON_FAIL', 500) }
```

### 2. Improved Job Status Checking

**File:** `app/services/batch_queue_worker.ts`

Enhanced the `waitForScreenshotJob` method to:
- Handle the case where jobs are cleaned up after completion
- Detect jobs that finish without return values
- Add comprehensive logging for debugging
- Provide better error messages

### 3. Enhanced Error Handling and Logging

Added detailed logging throughout the batch processing pipeline to track:
- Individual job start/completion
- Result collection
- Error scenarios
- Progress tracking

### 4. Environment Configuration

**Files:** `start/env.ts`, `.env.example`

Added new environment variables:
```bash
SCREENSHOT_QUEUE_REMOVE_ON_COMPLETE=1000
SCREENSHOT_QUEUE_REMOVE_ON_FAIL=500
```

## Deployment Instructions

### 1. Update Environment Variables

Add these to your production environment (EasyPanel):

```bash
SCREENSHOT_QUEUE_REMOVE_ON_COMPLETE=1000
SCREENSHOT_QUEUE_REMOVE_ON_FAIL=500
```

### 2. Deploy the Updated Code

Since you're using EasyPanel with the Dockerfile, the deployment process should be:

1. **Commit and push the changes:**
   ```bash
   git add .
   git commit -m "Fix batch screenshot empty results issue"
   git push origin main
   ```

2. **Redeploy in EasyPanel:**
   - Go to your EasyPanel dashboard
   - Navigate to your web2img service
   - Trigger a rebuild/redeploy

### 3. Verify the Fix

After deployment, test with the same request that was failing:

```bash
POST /batch/screenshots
{
  "items": [
    {
      "url": "https://viding.co/mini-rsvp/996144",
      "id": "9961446",
      "format": "png",
      "width": 1280,
      "height": 720
    }
  ]
}
```

You should now see:
- Non-empty `results` array
- Proper `succeeded` or `failed` counts
- Actual screenshot URLs or error messages

## Monitoring

### Log Messages to Watch For

After the fix, you'll see more detailed logs:

```
DEBUG: Starting screenshot job { itemId: "...", jobId: "..." }
DEBUG: Screenshot job completed successfully { jobId: "...", waitTime: ... }
INFO: Batch processing completed { totalJobs: 1, completedCount: 1, failedCount: 0, resultsCount: 1 }
```

### Error Scenarios

If jobs are still being cleaned up too quickly, you'll see:
```
WARN: Screenshot job not found, likely cleaned up after completion { jobId: "...", waitTime: ... }
```

In this case, increase the `SCREENSHOT_QUEUE_REMOVE_ON_COMPLETE` value further.

## Additional Improvements

The fix also includes:

1. **Better error handling** for edge cases
2. **Validation** that results count matches expected jobs
3. **Configurable cleanup behavior** via environment variables
4. **Enhanced logging** for troubleshooting

## Rollback Plan

If issues occur, you can quickly rollback by:

1. Reverting the environment variables to original values:
   ```bash
   SCREENSHOT_QUEUE_REMOVE_ON_COMPLETE=100
   SCREENSHOT_QUEUE_REMOVE_ON_FAIL=50
   ```

2. Redeploying the previous version of the code

## Performance Impact

The increased job retention (1000 vs 100) will:
- Use slightly more Redis memory
- Improve reliability for batch processing
- Have minimal performance impact on normal operations

The trade-off is worth it for the reliability improvement.
