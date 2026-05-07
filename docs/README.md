# ATT&CK Workbench REST API Documentation

This directory contains supplementary technical documentation for the ATT&CK Workbench REST API. For general usage and contribution guides, please refer to the main documentation in the project root:

- [USAGE.md](../USAGE.md): Comprehensive usage instructions
- [CONTRIBUTING.md](../CONTRIBUTING.md): Guide for developers

## User Documentation

Guides for consumers of the REST API — endpoints, workflows, and terminology.

- [Revoke Workflow](user/revoke-workflow.md): How to revoke ATT&CK objects via the API

### Release Tracks

- [API Reference](user/release-tracks/api-reference.md): Complete endpoint reference for Release Tracks V2
- [Summary](user/release-tracks/summary.md): High-level design summary and problem statement
- [Terminology](user/release-tracks/terminology.md): Complete terminology guide
- [Versioning](user/release-tracks/versioning.md): Git-inspired versioning and release process
- [Virtual Tracks](user/release-tracks/virtual-tracks.md): Virtual release tracks (aggregations)
- [Release Workflow](user/release-tracks/release-workflow.md): Workflow integration and candidacy
- [Output Formats](user/release-tracks/output-formats.md): Output format specifications
- [Workflow Examples](user/release-tracks/workflow-examples.md): End-to-end workflow examples

## Developer Documentation

Architecture, patterns, and implementation details for contributors.

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

- [Entities](developer/release-tracks/entities.md): Database schemas and data models
- [Member Sync Strategies](developer/release-tracks/member-sync-strategies.md): Automatic tracking of member object revisions
- [Error Handling](developer/release-tracks/error-handling.md): Error handling patterns
- [Implementation Notes](developer/release-tracks/implementation-notes.md): Implementation notes and decisions

## Admin Documentation

Configuration, deployment, and identity provider setup.

- [Configuration](admin/configuration.md): Complete configuration guide (environment variables, JSON files)
- [Automation Run Audit Trail](admin/automation-runs.md): How to inspect migration and scheduler audit records

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

- [GitHub Repository](https://github.com/center-for-threat-informed-defense/attack-workbench-rest-api)
- [Frontend Repository](https://github.com/center-for-threat-informed-defense/attack-workbench-frontend)
- [Issue Tracker](https://github.com/center-for-threat-informed-defense/attack-workbench-rest-api/issues)
