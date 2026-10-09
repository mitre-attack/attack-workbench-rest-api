---
status: accepted
---

# Configure retired-object ADM exemptions as a distinct bypass rule kind

Previously, Workbench skipped ADM validation for retired bundle imports, while ordinary writes, review, and scheduled validation could reject the same content. Workbench now provides an object exemption rule kind alongside existing ADM error bypasses, managed through the frontend's Validation Bypasses page, with independent revoked/deprecated matching and scope to all or selected STIX types. A matching exemption skips ADM entirely without asserting schema conformance; one policy governs imports, authoring and metadata writes, workflow review, release-track admission, and scheduled revalidation so an operation cannot silently reintroduce ADM errors for exempt content.

Existing field/error bypass rules retain their behavior. Object exemptions do not relax request, persistence, reference, authorization, or lifecycle requirements, and apply to a revision's retirement status rather than the specification's deprecation of its object type. A separate rule kind expresses whole-object eligibility directly instead of encoding it as artificial field/error matches or disconnected instance settings.

New and upgraded instances start with two enabled all-type exemptions, one for revoked revisions and one for deprecated revisions. Any enabled matching rule grants exemption; a disabled rule does not negate another match. Each revision is evaluated independently, so an active revision restored from deprecated content undergoes normal ADM validation while its historical retired revisions remain eligible for exemption.

Policy changes apply to subsequent operations immediately and trigger background reevaluation of affected existing revisions. The administration page exposes reconciliation progress and failures rather than implying that saving a rule synchronously repairs historical diagnostics.

Exemption reporting is opt-in and separate from errors and warnings. Consumers can request summaries or details filtered by revoked/deprecated exemptions or specific rule identities, with readable rule names for selection; these filters never change enforcement. The frontend presents matching explanations in a collapsed ADM validation details section, without routine exemption notices, warning rows, or object badges.

Reconciliation changes current validation diagnostics only. Past review decisions, release membership, and published content remain intact; future admission and publication checks use the current policy. Reevaluation work is durable and resumable across API restarts, operates independently of the periodic scheduler switch, and exposes pending/running/completed/failed progress with retry after failure.

Default exemptions are seeded once; restart does not recreate deleted defaults or undo administrator changes. Each operation uses one policy snapshot, while reconciliation follows the newest policy and prevents superseded results from replacing newer diagnostics. Requested reports provide filtered counts and bounded, paginated details with explicit continuation; an empty report does not imply ADM conformance. Original import reports remain historical evidence even when current diagnostics change.
