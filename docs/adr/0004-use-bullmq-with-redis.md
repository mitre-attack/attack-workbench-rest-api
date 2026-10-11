---
status: accepted
---

# Use BullMQ with Redis for background delivery

Workbench will use BullMQ with Redis behind the shared Background Work Module, with consumers embedded in the REST API process. The user selected this approach on 2026-10-10 after isolated evaluation: BullMQ rejected stale lease renewal and completion after replacement-worker takeover, whereas the evaluated Agenda Mongo backend accepted stale state changes. Self-hosted deployment may add one Redis service and persistent volume; this explicitly amends the original no-added-container constraint in [ADR 0002](0002-unify-background-execution.md), without requiring separate worker or scheduler containers.

Mongo remains authoritative for domain intent, schedule configuration, guarded checkpoints and outcomes, attempt history, retry budgets, and effect receipts. Redis supplies delivery, renewable queue ownership, delayed execution, and retry mechanics. A reconciliation mechanism must repair the Mongo-to-Redis dispatch gap and reconstruct eligible delivery after queue-state loss. Raw BullMQ progress, data, and logs are advisory: stale handlers can update those fields and can continue unguarded domain writes. Domain safeguards remain mandatory.

Distinct lease policies use compatible queue/Worker profiles inside the same process because lease and renewal settings belong to Workers. The timing, administration, and retention policies in [ADR 0003](0003-background-work-timing-and-recovery.md) remain unchanged. The tradeoff is maintained queue machinery in exchange for a second datastore, recovery integration, persistence, monitoring, and deployment maintenance. Real domain fault tests and representative embedded HTTP/resource qualification are required before rollout; the isolated spike is not production qualification.
