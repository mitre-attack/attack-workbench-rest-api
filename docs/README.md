# ATT&CK Workbench REST API Documentation

This directory contains supplementary technical documentation for the ATT&CK Workbench REST API. For general usage and contribution guides, please refer to the main documentation in the project root:

- [USAGE.md](../USAGE.md): Comprehensive usage instructions
- [CONTRIBUTING.md](../CONTRIBUTING.md): Guide for developers

## User Documentation

Guides for consumers of the REST API — endpoints, workflows, and terminology.

- [Build Information](user/build-information.md): Inspect the running REST API release and build provenance
- [Revoke Workflow](user/revoke-workflow.md): How to revoke ATT&CK objects via the API
- [Data Quality Reports](user/data-quality-reports.md): Missing LinkById, parallel relationship, and domain consistency reports under `/api/reports`

### Release Tracks

- [API Reference](user/release-tracks/api-reference.md): Complete endpoint reference for Release Tracks V2
- [Summary](user/release-tracks/summary.md): High-level design summary and problem statement
- [Terminology](user/release-tracks/terminology.md): Complete terminology guide
- [Versioning](user/release-tracks/versioning.md): Git-inspired versioning and release process
- [Virtual Tracks](user/release-tracks/virtual-tracks.md): Virtual release tracks (aggregations)
- [Release Workflow](user/release-tracks/release-workflow.md): Workflow integration and candidacy
- [Output Formats](user/release-tracks/output-formats.md): Output format specifications
- [Workflow Examples](user/release-tracks/workflow-examples.md): End-to-end workflow examples
- [Object Backrefs](user/release-tracks/object-backrefs.md): Release-track membership pointers on object documents (`workspace.release_tracks`)
- [Releases By Object](user/release-tracks/releases-by-object.md): Find tagged releases that directly contain a STIX object

## Developer Documentation

Architecture, patterns, and implementation details for contributors.

- [Build Information](developer/build-information.md): Build metadata provenance, runtime configuration, and frontend integration
- [Data Quality Query Design](developer/data-quality-reports.md): Duplicate-report memory amplification, query optimization, and remaining response-size limits
- [Data Model](developer/data-model.md): Database schema and STIX object structure
- [Event Bus Architecture](developer/event-bus-architecture.md): Event-driven architecture for cross-document dependencies
- [Lifecycle Hooks Guide](developer/lifecycle-hooks-guide.md): Service lifecycle hooks pattern
- [Cross-Service Reads Pattern](developer/cross-service-reads-pattern.md): Cross-service communication patterns
- [Implementation Approach](developer/implementation-approach.md): Detailed implementation pattern for event-driven services
- [Service Exception Middleware](developer/service-exception-middleware.md): Global error handler middleware
- [STIX Versioning and Embedded Relationships](developer/stix-versioning-and-embedded-relationships.md): How STIX versioning interacts with embedded relationships
- [Task Scheduler](developer/task-scheduler.md): Task scheduler implementation
- [Automation Run Audit Trail](developer/automation-runs.md): Taxonomy and implementation guidance for durable automation auditing

### Release Tracks (Internals)

- [Implementation Backlog](developer/TODO.md): Active release-track work and
  completed implementation records
- [Frontend Handoff](developer/FRONTEND_TODO.md): Backend contract changes
  requiring downstream Angular updates
- [Entities](developer/release-tracks/entities.md): Database schemas and data models
- [Snapshot Creation Causes](developer/release-tracks/snapshot-creation-causes.md): Persisted creation-cause enum, standard/virtual operation mapping, and historical fallback
- [Sealed Content Manifests](developer/release-tracks/sealed-content-manifests.md): Why every snapshot seals its bill of materials, how the collection object is projected, and publication inheritance
- [Deletion Guardrails](developer/release-tracks/deletion-guardrails.md): Plain-language explanation of durable scheduler receipts, coordinated snapshot changes, and recoverable cleanup
- [Draft Lifecycle Plan](developer/release-tracks/draft-lifecycle-plan.md): Approved virtual draft-retention and release-time squash implementation plan
- [Backref Reconciliation](developer/release-tracks/backref-reconciliation.md): How `workspace.release_tracks` backrefs stay in sync with snapshots
- [Member Sync Strategies](developer/release-tracks/member-sync-strategies.md): Automatic tracking of member object revisions
- [Error Handling](developer/release-tracks/error-handling.md): Error handling patterns
- [Implementation Notes](developer/release-tracks/implementation-notes.md): Implementation notes and decisions
- [Releases By Object](developer/release-tracks/releases-by-object.md): Registry catalogue, fan-out query, and indexing design
- [Authorization](developer/release-tracks/authorization.md): Role matrix, destructive confirmation, and audit contract

## Admin Documentation

Configuration, deployment, and identity provider setup.

- [Configuration](admin/configuration.md): Complete configuration guide (environment variables, JSON files)
- [Automation Run Audit Trail](admin/automation-runs.md): How to inspect migration and scheduler audit records
- [Virtual Track Schedules](admin/virtual-track-schedules.md): UTC execution, restart recovery, retries, and observability
- [Release-Track Membership Reconciliation](admin/release-track-reconciliation.md): Inspect and repair durable object-backref protection failures
- [Release-Track Destructive Audit Events](admin/release-track-audit.md): Inspect administrator track-deletion attempts
- [Release-Track Deterministic Graph Migration](admin/release-track-graph-migration.md): Preview and operate the relationship-pin and snapshot-manifest backfill
- [ATT&CK Canonical-Domain Migration](admin/canonical-domain-migration.md): Understand the release-agnostic startup repair, inactive-revision handling, strict validation, and verification procedure

### Authentication

- [Authentication Overview](admin/authentication/README.md): Introduction and quick start guide
- [Authentication Configuration](admin/authentication/configuration.md): REST API authentication configuration
- [Authentik Setup](admin/authentication/authentik.md): Step-by-step guide for Authentik
- [Keycloak Setup](admin/authentication/keycloak.md): Step-by-step guide for Keycloak
- [Okta Setup](admin/authentication/okta.md): Step-by-step guide for Okta
- [Testing & Verification](admin/authentication/testing-verification.md): Verify authentication is working

## Legacy Documentation

- [Authentication Details](legacy/authentication.md): Technical details about authentication mechanisms
- [User Management](legacy/user-management.md): Detailed information about user accounts and permissions
- [Docker Deployment](legacy/docker.md): Legacy instructions for Docker deployment
- [Link-by-ID Mechanism](legacy/link-by-id.md): Technical details about object linking

## API Documentation

Interactive API documentation is available when running the application in development mode at the `/api-docs` endpoint.

## Additional Resources

- [GitHub Repository](https://github.com/mitre-attack/attack-workbench-rest-api)
- [Frontend Repository](https://github.com/mitre-attack/attack-workbench-frontend)
- [Issue Tracker](https://github.com/mitre-attack/attack-workbench-rest-api/issues)
