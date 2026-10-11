---
status: accepted
---

# Unify background execution while preserving domain-owned safeguards

Workbench will use a shared execution module for scheduled, manually requested, and change-triggered background operations. Track composition, validation rules, authorization, and safeguards for durable intent and committed effects remain owned by their domain modules. This concentrates execution and administration without making generic job state the authority for domain correctness.

Prefer the existing Node.js and MongoDB deployment unless an alternative provides enough benefit to justify another operational dependency. The initial scope covers imports, validation, snapshots, cleanup, and repair, including durable retries, progress, and multi-step execution. Workflows that wait for human approval and user-supplied executable jobs are deferred.

Execution will run inside the existing REST API process. A dedicated worker deployment is not required. The original no-added-container constraint was amended by [ADR 0004](0004-use-bullmq-with-redis.md): one Redis service and persistent volume are accepted for self-hosted deployment. The shared module must consequently bound resource use and coordinate execution across API instances, while sharing their process lifecycle.

This decision establishes the scope of the refactoring. The subsequent library selection is recorded in ADR 0004; schemas and migration details remain implementation work. The intended timing and retry behavior is recorded separately in [ADR 0003](0003-background-work-timing-and-recovery.md); these decisions do not describe an already-implemented system.
