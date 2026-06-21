# VIBA Fallback Pool

If one provider cannot continue, VIBA should keep the job moving.

The unfinished work returns to a shared queue so another available provider can continue.

## Return-to-queue reasons

quota exhausted
rate limited
outage
timeout
invalid key
model unavailable
context limit reached
tool error
partial output only

## States

queued
assigned
running
partial
retryable_failed
returned_to_pool
reassigned
completed
blocked_for_user

## Process

1. Save partial work.
2. Save the reason.
3. Mark the provider as unavailable for a short cooldown.
4. Pick another provider with the required capability.
5. Reassign the work.
6. Continue without forcing the user to restart.
7. Merge useful partial work into the final result.

## Provider choice order

capability match
valid key
available quota
lowest cost
recent speed
success history
context size
user preference

## Suggested limits

max_retries_per_task = 3
max_providers_per_task = 3
cooldown_failed_provider_minutes = 15

## User message example

Claude ran out of credits. VIBA reassigned this task to Groq. Partial work was preserved and the build review is continuing.

## Log events

provider_quota_exhausted
provider_rate_limited
provider_timeout
provider_invalid_key
provider_failed
task_returned_to_pool
task_reassigned
task_completed_by_fallback
all_providers_failed
