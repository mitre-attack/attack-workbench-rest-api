---
status: accepted
---

# Make background timing and recovery explicit

Recurring work will combine redundant triggers into one catch-up operation using current state, with one active operation and at most one pending follow-up per collection index or snapshot track. Validation converges on the latest policy. Record missed or combined intervals; a late snapshot represents inputs available when it executes, not reconstructed historical state. Each explicit date remains a separate intent, eligible for automatic execution within a configurable lateness window and otherwise visibly overdue for an admin decision. Committed effects are recovered regardless of lateness.

The lateness window defaults to 24 hours and is configurable per schedule. An admin may execute an overdue occurrence late or dismiss it with a recorded reason; neither action erases a committed result. New and edited cron schedules use explicit UTC, with local-time previews in the dashboard. Existing schedules that depend on the server timezone preserve their effective timing until explicitly converted.

Transient failures use bounded exponential backoff with jitter and operation-specific attempt and time budgets. Invalid configuration or missing prerequisites become visibly blocked. Exhaustion retains intent and progress for repair or retry; required recovery remains visible and can resume when its underlying condition changes. Retry resumes the same logical operation and effect identity, while run-now creates new authorized intent.

Replacing a schedule supersedes its old unstarted, uncommitted occurrences. Already-running work finishes safely, and committed results are recovered before schedule eligibility is reconsidered. Pausing stops future optional scheduled admissions while previously admitted work and required recovery continue. Record schedule revisions without allowing revision changes to bypass domain effect identity or retained receipts.

Admins may edit supported schedules, pause future optional admissions, and adjust lateness windows through persisted Workbench settings. Existing domain schedule records remain authoritative, and the admin view shows effective values and their sources. Lease lifetimes, concurrency, and retry-budget tuning remain code or deployment settings initially.

New execution attempt details have a deployment-configurable 90-day retention default. Current unresolved work, latest outcome summaries, and correctness-critical receipts have independent retention. This does not establish blanket deletion of existing unrelated audit records.

These policies deliberately replace implicit and inconsistent behavior across the existing task families. The tradeoff is additional explicit operation state in exchange for bounded backlogs, visible failures, and predictable admin controls. Per-kind execution limits require evaluation, and the implementation remains to be specified.
