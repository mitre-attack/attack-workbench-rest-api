# ATT&CK Workbench REST API Configuration Guide

This guide explains how to configure the ATT&CK Workbench REST API using environment variables,
JSON configuration files, or a combination of both.

## Table of Contents

- [ATT\&CK Workbench REST API Configuration Guide](#attck-workbench-rest-api-configuration-guide)
  - [Table of Contents](#table-of-contents)
  - [Configuration System Overview](#configuration-system-overview)
  - [Configuration Methods](#configuration-methods)
    - [Environment Variables](#environment-variables)
    - [JSON Configuration File](#json-configuration-file)
    - [Configuration Precedence](#configuration-precedence)
  - [Configuration Options](#configuration-options)
    - [Server](#server)
    - [Database](#database)
    - [Application](#application)
    - [Logging](#logging)
    - [Session](#session)
    - [User Authentication](#user-authentication)
      - [OIDC Configuration](#oidc-configuration)
    - [Service Authentication](#service-authentication)
      - [OIDC Client Credentials](#oidc-client-credentials)
      - [Challenge API Key](#challenge-api-key)
      - [Basic API Key](#basic-api-key)
      - [Multiple Service Authentication Methods](#multiple-service-authentication-methods)
    - [Scheduler](#scheduler)
    - [Validation](#validation)
    - [Collection Indexes](#collection-indexes)
    - [Configuration Files](#configuration-files)
      - [Allowed Values](#allowed-values)
      - [Static Marking Definitions](#static-marking-definitions)
    - [ATT\&CK Specific](#attck-specific)
  - [Additional Resources](#additional-resources)

---

## Configuration System Overview

The REST API uses [Convict](https://github.com/mozilla/node-convict), a configuration management library.
All configuration is defined in `app/config/config.js` with sensible defaults.
You only need to override values specific to your environment.

---

## Configuration Methods

### Environment Variables

Environment variables are the recommended method for configuring the REST API in containerized deployments and for simple configurations.

A `template.env` file is included in the repository for you to make use of this option.

### JSON Configuration File

JSON configuration files are recommended for complex configurations, especially when defining service accounts or OIDC clients.

**Setting up JSON configuration:**

1. Create a configuration file (e.g., `config.json`):

   ```json
   {
     "server": {
       "port": 3000,
       "corsAllowedOrigins": ["https://workbench.example.com", "https://staging.example.com"]
     },
     "database": {
       "url": "mongodb://localhost:27017/attack-workspace"
     },
     "userAuthn": {
       "mechanism": "oidc",
       "oidc": {
         "issuerUrl": "https://auth.example.com/realms/workbench",
         "clientId": "attack-workbench-rest-api",
         "clientSecret": "your-client-secret",
         "redirectOrigin": "https://workbench.example.com"
       }
     },
     "serviceAuthn": {
       "basicApikey": {
         "enable": true,
         "serviceAccounts": [
           {
             "name": "navigator",
             "apikey": "your-navigator-apikey",
             "serviceRole": "read-only"
           },
           {
             "name": "collection-manager",
             "apikey": "your-collection-manager-apikey",
             "serviceRole": "collection-manager"
           }
         ]
       }
     }
   }
   ```

2. Reference the file via environment variable:

   ```bash
   export JSON_CONFIG_PATH=/path/to/config.json
   npm start
   ```

   Or in `.env`:

   ```bash
   JSON_CONFIG_PATH=/path/to/config.json
   ```

### Configuration Precedence

When both environment variables and JSON configuration are used:

1. **Environment variables** are loaded first with their defaults
2. **JSON configuration file** (if specified) is loaded second and overrides environment variables
3. **Validation** occurs after all configuration is loaded

**Example:**

```bash
# .env file
PORT=3000
DATABASE_URL=mongodb://localhost:27017/attack-workspace
JSON_CONFIG_PATH=./config.json
```

```json
// config.json
{
  "server": {
    "port": 8080
  }
}
```

**Result:** Port will be `8080` (JSON overrides environment variable)

---

## Configuration Options

### Server

Configuration for the HTTP server.

| Option               | Environment Variable   | JSON Path                   | Type    | Default | Description                                                                                              |
| -------------------- | ---------------------- | --------------------------- | ------- | ------- | -------------------------------------------------------------------------------------------------------- |
| Port                 | `PORT`                 | `server.port`               | integer | `3000`  | HTTP server port                                                                                         |
| CORS Allowed Origins | `CORS_ALLOWED_ORIGINS` | `server.corsAllowedOrigins` | domains | `*`     | Allowed origins for CORS. Use `*` for all, `disable` to disable CORS, or comma-separated list of origins |

**CORS Allowed Origins** accepts:

- `*` - Allow any origin (not recommended for production)
- `disable` - Disable CORS entirely
- Comma-separated list of origins (with protocol):
  - `https://workbench.example.com`
  - `http://localhost:4200,https://workbench.example.com`
- Supports localhost, private IPs (10.x, 172.16-31.x, 192.168.x), and FQDNs

**Examples:**

```bash
# Environment variable
CORS_ALLOWED_ORIGINS=https://workbench.example.com,https://staging.example.com
```

```json
// JSON
{
  "server": {
    "corsAllowedOrigins": ["https://workbench.example.com", "https://staging.example.com"]
  }
}
```

### Database

MongoDB database configuration.

| Option       | Environment Variable                | JSON Path                   | Type    | Default   | Description                             |
| ------------ | ----------------------------------- | --------------------------- | ------- | --------- | --------------------------------------- |
| URL          | `DATABASE_URL`                      | `database.url`              | string  | _(empty)_ | MongoDB connection string (REQUIRED)    |
| Auto-migrate | `WB_REST_DATABASE_MIGRATION_ENABLE` | `database.migration.enable` | boolean | `true`    | Run migrations automatically on startup |

**Examples:**

```bash
# Local MongoDB
DATABASE_URL=mongodb://localhost:27017/attack-workspace

# Docker Compose
DATABASE_URL=mongodb://attack-workbench-database/attack-workspace
```

**Migration Notes:**

- When `database.migration.enable` is `true`, migrations run automatically at startup
- Set to `false` if you manage migrations separately (e.g., in a Kubernetes init container)
- Migrations are idempotent and safe to run multiple times
- Automation-enabled migrations may also write durable audit records to `automationRuns` and `automationRunItems`; see [Automation Run Audit Trail](automation-runs.md)

### Application

General application settings.

| Option              | Environment Variable | JSON Path               | Type   | Default                     | Description                                            |
| ------------------- | -------------------- | ----------------------- | ------ | --------------------------- | ------------------------------------------------------ |
| Name                | _(none)_             | `app.name`              | string | `attack-workbench-rest-api` | Application name                                       |
| Environment         | `NODE_ENV`           | `app.env`               | string | `development`               | Environment name (`development`, `production`, `test`) |
| Version             | `APP_VERSION`        | `app.version`           | string | _(from package.json)_       | Running application release version                    |
| Git commit          | `GIT_COMMIT`         | `app.gitCommit`         | string | `unknown`                   | Commit used to produce the running build               |
| Build date          | `BUILD_DATE`         | `app.buildDate`         | string | `unknown`                   | RFC 3339 timestamp when the build was produced         |
| ATT&CK Spec Version | _(none)_             | `app.attackSpecVersion` | string | _(from package.json)_       | ATT&CK specification version                           |

**Example:**

```bash
NODE_ENV=production
APP_VERSION=4.20.0-beta.23
GIT_COMMIT=c2c017c146fae040caba559333b35536bfbd1189
BUILD_DATE=2026-08-05T15:13:49.915Z
```

The published Docker image sets the three build variables automatically from
the same build arguments used for its OCI image labels. Source deployments can
set them explicitly; omitted commit and date values are reported as `unknown`.

### Logging

Logging configuration using Winston.

| Option    | Environment Variable | JSON Path          | Type   | Default | Description       |
| --------- | -------------------- | ------------------ | ------ | ------- | ----------------- |
| Log Level | `LOG_LEVEL`          | `logging.logLevel` | string | `info`  | Console log level |

**Log Levels** (from least to most verbose):

- `error` - Only errors
- `warn` - Warnings and errors
- `http` - HTTP requests, warnings, and errors
- `info` - General information (recommended for production)
- `verbose` - Detailed information
- `debug` - Debug messages (recommended for development)

**Example:**

```bash
LOG_LEVEL=debug
```

### Session

Session management for user authentication.

| Option               | Environment Variable       | JSON Path                        | Type   | Default                  | Description                               |
| -------------------- | -------------------------- | -------------------------------- | ------ | ------------------------ | ----------------------------------------- |
| Secret               | `SESSION_SECRET`           | `session.secret`                 | string | _(generated at startup)_ | Secret used to sign session cookies       |
| Mongo Session Secret | `MONGOSTORE_CRYPTO_SECRET` | `session.mongoStoreCryptoSecret` | string | _(generated at startup)_ | Secret to encrypt session data in MongoDB |

**Important Notes:**

- If not set, a secret is generated randomly at startup
- Random secrets are regenerated on restart, forcing users to re-login
- Random secrets cannot be shared across multiple server instances
- **Production:** Always set `SESSION_SECRET` to a fixed, secure value

**Generating a secure secret:**

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

**Example:**

```bash
SESSION_SECRET=your-secure-secret-here
MONGOSTORE_CRYPTO_SECRET=your-secure-secret-here
```

### User Authentication

Configuration for user authentication (how end-users log in).

| Option    | Environment Variable | JSON Path             | Type | Default     | Description                     |
| --------- | -------------------- | --------------------- | ---- | ----------- | ------------------------------- |
| Mechanism | `AUTHN_MECHANISM`    | `userAuthn.mechanism` | enum | `anonymous` | Authentication mechanism to use |

**Mechanism Options:**

- `anonymous` - No authentication required (development only)
- `oidc` - OpenID Connect (recommended for production)

#### OIDC Configuration

Required when `mechanism` is set to `oidc`.

| Option          | Environment Variable         | JSON Path                       | Type   | Default                 | Description                |
| --------------- | ---------------------------- | ------------------------------- | ------ | ----------------------- | -------------------------- |
| Issuer URL      | `AUTHN_OIDC_ISSUER_URL`      | `userAuthn.oidc.issuerUrl`      | string | _(empty)_               | OIDC provider's issuer URL |
| Client ID       | `AUTHN_OIDC_CLIENT_ID`       | `userAuthn.oidc.clientId`       | string | _(empty)_               | OIDC client identifier     |
| Client Secret   | `AUTHN_OIDC_CLIENT_SECRET`   | `userAuthn.oidc.clientSecret`   | string | _(empty)_               | OIDC client secret         |
| Redirect Origin | `AUTHN_OIDC_REDIRECT_ORIGIN` | `userAuthn.oidc.redirectOrigin` | string | `http://localhost:3000` | Base URL for redirect URI  |

**Example:**

```bash
AUTHN_MECHANISM=oidc
AUTHN_OIDC_ISSUER_URL=https://auth.example.com/realms/workbench
AUTHN_OIDC_CLIENT_ID=attack-workbench-rest-api
AUTHN_OIDC_CLIENT_SECRET=your-client-secret
AUTHN_OIDC_REDIRECT_ORIGIN=https://workbench.example.com
```

For detailed OIDC setup, see [Authentication Documentation](./authentication/README.md).

### Service Authentication

Configuration for service-to-service authentication (APIs, automation tools).

The REST API supports three service authentication methods:

1. **OIDC Client Credentials** - OAuth2 client credentials flow
2. **Challenge API Key** - Token exchange with challenge/response
3. **Basic API Key** - Simple API key authentication

All methods support role-based access control with three service roles:

- `read-only` - Read-only access to endpoints
- `collection-manager` - Read/write access for collection management
- `stix-export` - Access to STIX export endpoints

#### OIDC Client Credentials

Uses OAuth2 Client Credentials flow with JWT validation.

| Option   | Environment Variable          | JSON Path                                    | Type    | Default   | Description                                   |
| -------- | ----------------------------- | -------------------------------------------- | ------- | --------- | --------------------------------------------- |
| Enable   | `SERVICE_ACCOUNT_OIDC_ENABLE` | `serviceAuthn.oidcClientCredentials.enable`  | boolean | `false`   | Enable OIDC client credentials authentication |
| JWKS URI | `JWKS_URI`                    | `serviceAuthn.oidcClientCredentials.jwksUri` | string  | _(empty)_ | JWKS endpoint for IdP public keys             |
| Clients  | _(JSON only)_                 | `serviceAuthn.oidcClientCredentials.clients` | array   | `[]`      | Array of authorized OIDC clients              |

**Clients Array Schema:**

```json
{
  "clientId": "string", // OIDC client ID
  "serviceRole": "enum" // Service role (read-only, collection-manager, stix-export)
}
```

**Example:**

```bash
# .env
SERVICE_ACCOUNT_OIDC_ENABLE=true
JWKS_URI=https://auth.example.com/realms/workbench/protocol/openid-connect/certs
JSON_CONFIG_PATH=./config.json
```

```json
// config.json
{
  "serviceAuthn": {
    "oidcClientCredentials": {
      "enable": true,
      "clients": [
        {
          "clientId": "collection-manager-service",
          "serviceRole": "collection-manager"
        }
      ]
    }
  }
}
```

See sample configurations:

- [collection-manager-oidc-keycloak.json](../../resources/sample-configurations/collection-manager-oidc-keycloak.json)
- [collection-manager-oidc-okta.json](../../resources/sample-configurations/collection-manager-oidc-okta.json)

#### Challenge API Key

Token exchange authentication with challenge/response mechanism.

| Option               | Environment Variable                              | JSON Path                                      | Type    | Default                  | Description                             |
| -------------------- | ------------------------------------------------- | ---------------------------------------------- | ------- | ------------------------ | --------------------------------------- |
| Enable               | `WB_REST_SERVICE_ACCOUNT_CHALLENGE_APIKEY_ENABLE` | `serviceAuthn.challengeApikey.enable`          | boolean | `false`                  | Enable challenge API key authentication |
| Token Signing Secret | `WB_REST_TOKEN_SIGNING_SECRET`                    | `serviceAuthn.challengeApikey.secret`          | string  | _(generated at startup)_ | Secret used to sign access tokens       |
| Token Timeout        | `WB_REST_TOKEN_TIMEOUT`                           | `serviceAuthn.challengeApikey.tokenTimeout`    | integer | `300`                    | Access token lifetime in seconds        |
| Service Accounts     | _(JSON only)_                                     | `serviceAuthn.challengeApikey.serviceAccounts` | array   | `[]`                     | Array of service accounts               |

**Service Accounts Array Schema:**

```json
{
  "name": "string", // Service account name
  "apikey": "string", // Shared secret (API key)
  "serviceRole": "enum" // Service role
}
```

**Example:**

```bash
# .env
WB_REST_SERVICE_ACCOUNT_CHALLENGE_APIKEY_ENABLE=true
WB_REST_TOKEN_SIGNING_SECRET=your-secure-secret
WB_REST_TOKEN_TIMEOUT=600
JSON_CONFIG_PATH=./config.json
```

```json
// config.json
{
  "serviceAuthn": {
    "challengeApikey": {
      "enable": true,
      "serviceAccounts": [
        {
          "name": "collection-manager",
          "apikey": "your-secure-apikey",
          "serviceRole": "collection-manager"
        }
      ]
    }
  }
}
```

See sample: [test-service-challenge-apikey.json](../../resources/sample-configurations/test-service-challenge-apikey.json)

#### Basic API Key

Simple API key authentication (no challenge).

| Option           | Environment Variable                          | JSON Path                                  | Type    | Default | Description                         |
| ---------------- | --------------------------------------------- | ------------------------------------------ | ------- | ------- | ----------------------------------- |
| Enable           | `WB_REST_SERVICE_ACCOUNT_BASIC_APIKEY_ENABLE` | `serviceAuthn.basicApikey.enable`          | boolean | `false` | Enable basic API key authentication |
| Service Accounts | _(JSON only)_                                 | `serviceAuthn.basicApikey.serviceAccounts` | array   | `[]`    | Array of service accounts           |

**Service Accounts Array Schema:**

```json
{
  "name": "string", // Service account name
  "apikey": "string", // API key
  "serviceRole": "enum" // Service role
}
```

**Example:**

```bash
# .env
WB_REST_SERVICE_ACCOUNT_BASIC_APIKEY_ENABLE=true
JSON_CONFIG_PATH=./config.json
```

```json
// config.json
{
  "serviceAuthn": {
    "basicApikey": {
      "enable": true,
      "serviceAccounts": [
        {
          "name": "navigator",
          "apikey": "your-navigator-apikey",
          "serviceRole": "read-only"
        }
      ]
    }
  }
}
```

See sample: [navigator-basic-apikey.json](../../resources/sample-configurations/navigator-basic-apikey.json)

#### Multiple Service Authentication Methods

You can enable multiple service authentication methods simultaneously:

```json
{
  "serviceAuthn": {
    "oidcClientCredentials": {
      "enable": true,
      "clients": [
        {
          "clientId": "automated-collection-manager",
          "serviceRole": "collection-manager"
        }
      ]
    },
    "challengeApikey": {
      "enable": true,
      "serviceAccounts": [
        {
          "name": "legacy-service",
          "apikey": "legacy-apikey",
          "serviceRole": "read-only"
        }
      ]
    },
    "basicApikey": {
      "enable": true,
      "serviceAccounts": [
        {
          "name": "navigator",
          "apikey": "navigator-apikey",
          "serviceRole": "read-only"
        }
      ]
    }
  }
}
```

See sample: [multiple-apikey-services.json](../../resources/sample-configurations/multiple-apikey-services.json)

### Scheduler

Background job scheduler configuration.

| Option                       | Environment Variable           | JSON Path                             | Type    | Default     | Description                                             |
| ---------------------------- | ------------------------------ | ------------------------------------- | ------- | ----------- | ------------------------------------------------------- |
| Enable                       | `ENABLE_SCHEDULER`             | `scheduler.enableScheduler`           | boolean | `true`      | Enable background job scheduler                         |
| Virtual-track reconciliation | `VIRTUAL_TRACK_SCHEDULES_CRON` | `scheduler.virtualTrackSchedulesCron` | string  | `* * * * *` | Discover and retry persisted virtual snapshot schedules |

**Scheduler Functions:**

- Checks for collection index updates
- Downloads collection bundles from remote URLs
- Processes subscription update policies
- Materializes virtual release-track snapshots from cron and date schedules

**Example:**

```bash
ENABLE_SCHEDULER=true
VIRTUAL_TRACK_SCHEDULES_CRON="* * * * *"
```

### Validation

Configuration for ATT&CK Data Model (ADM) request validation and the scheduled re-validation task.

| Option            | Environment Variable        | JSON Path                              | Type    | Default     | Description                                                                                  |
| ----------------- | --------------------------- | -------------------------------------- | ------- | ----------- | -------------------------------------------------------------------------------------------- |
| Validate Requests | `VALIDATE_WITH_ADM_SCHEMAS` | `validateRequests.withAttackDataModel` | boolean | `true`      | Evaluate composed revisions through ADM and the configured exemption/error-bypass policy     |
| Re-validate Cron  | `VALIDATE_OBJECTS_CRON`     | `scheduler.validateObjectsCron`        | string  | `0 3 * * *` | Cron pattern for the background task that refreshes `workspace.validation` on every document |
| ADM Log Level     | `ADM_LOG_LEVEL`             | _(env only)_                           | enum    | `warn`      | Verbosity of the ADM library's internal logger                                               |

**`VALIDATE_WITH_ADM_SCHEMAS`**

When enabled (the default), validation-bearing operations evaluate composed
revisions under the current policy. Matching object exemptions skip ADM; other
revisions use full or work-in-progress partial schemas and configured error
bypasses. Ordinary authoring/review gates reject invalid results. Bundle import
keeps its separate strict versus fail-open behavior controlled by
`validateContents`. When disabled, the request gate records a disabled outcome
without claiming ADM conformance. Model, reference, lifecycle and authorization
checks still apply. See [validation rules](../user/validation-rules.md).

This setting does not affect the legacy OpenAPI request validation (`VALIDATE_WITH_LEGACY_SCHEMAS`), which can be enabled or disabled independently.

**`VALIDATE_OBJECTS_CRON`**

The Workbench scheduler periodically re-validates every SDO and SRO in the database against the current ADM and refreshes each document's `workspace.validation` field. This combats _concept drift_: documents that passed validation under an older ADM version may become non-compliant after a Workbench upgrade.

The cron pattern follows standard 5-field syntax (`minute hour day-of-month month day-of-week`). The default `0 3 * * *` runs the task daily at 3:00 AM. The periodic task is skipped if the global scheduler is disabled (`ENABLE_SCHEDULER=false`). Durable policy reconciliation still runs, and both background evaluators enable ADM independently of the request-validation switch.

For the lifecycle of `workspace.validation` itself, see [Stateful Validation Tracking](../developer/workspace-validation.md).

**`ADM_LOG_LEVEL`**

Read by the `@mitre-attack/attack-data-model` library directly — _not_ a Convict-managed setting and not configurable via `JSON_CONFIG_PATH`. It controls the verbosity of the ADM library's own logger, which is independent of the Workbench `LOG_LEVEL`.

This was introduced primarily to suppress the deprecation warning that the ADM emits for every relationship in the database during a re-validation run. Setting `ADM_LOG_LEVEL=error` (or `silent`) keeps the scheduled task quiet without affecting Workbench's own logs.

| Level    | Description                                                        |
| -------- | ------------------------------------------------------------------ |
| `debug`  | Verbose diagnostic output                                          |
| `info`   | Informational status messages (data retrieval, parse counts, etc.) |
| `warn`   | Validation issues in `relaxed` mode and deprecation warnings       |
| `error`  | Errors only                                                        |
| `silent` | Disables all output                                                |

Levels are inclusive: setting `info` enables `info`, `warn`, and `error`. The default is `warn`.

**Examples:**

```bash
# Enable ADM-based request validation
VALIDATE_WITH_ADM_SCHEMAS=true

# Run re-validation hourly instead of daily at 3 AM
VALIDATE_OBJECTS_CRON=0 * * * *

# Suppress noisy ADM deprecation warnings during scheduler runs
ADM_LOG_LEVEL=error
```

### Collection Indexes

Configuration for ATT&CK collection index subscriptions.

| Option           | Environment Variable | JSON Path                         | Type    | Default | Description                              |
| ---------------- | -------------------- | --------------------------------- | ------- | ------- | ---------------------------------------- |
| Default Interval | `DEFAULT_INTERVAL`   | `collectionIndex.defaultInterval` | integer | `300`   | Default update check interval in seconds |

**Notes:**

- Only applies to new collection indexes added after configuration change
- Does not affect existing collection indexes (they retain their configured interval)

### Configuration Files

Paths to additional configuration and data files.

| Option                          | Environment Variable               | JSON Path                                         | Type   | Default                                         | Description                                                           |
| ------------------------------- | ---------------------------------- | ------------------------------------------------- | ------ | ----------------------------------------------- | --------------------------------------------------------------------- |
| JSON Config Path                | `JSON_CONFIG_PATH`                 | `configurationFiles.jsonConfigFile`               | string | _(empty)_                                       | Path to JSON configuration file                                       |
| Allowed Values Path             | `ALLOWED_VALUES_PATH`              | `configurationFiles.allowedValues`                | string | `./app/config/allowed-values.json`              | Seed values used when Allowed Values configuration does not yet exist |
| Static Marking Definitions Path | `WB_REST_STATIC_MARKING_DEFS_PATH` | `configurationFiles.staticMarkingDefinitionsPath` | string | `./app/lib/default-static-marking-definitions/` | Directory containing static marking definitions                       |

#### Allowed Values

Allowed Values controls which choices appear in object editors. Administrators
manage one configuration per property/domain at **Dashboard → Admin → Allowed
Values**, below **Validation Bypasses**.

The three sources have different responsibilities:

| Source                                   | Responsibility                                                                                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installed backend ADM package            | Determines permissible values and object-type/domain constraints through its Zod schemas                                                                         |
| Bundled `app/config/allowed-values.json` | Registers supported object/property pairs, supplies initial groups and values, and provides suggestions for formatted fields and the dropdown response structure |
| MongoDB                                  | Stores the administrator's configured values and enabled states                                                                                                  |

##### Initialization and the JSON file

When the backend starts and no Allowed Values configuration exists in MongoDB,
it reads the file selected by `ALLOWED_VALUES_PATH` (the bundled file by default).
It validates the complete seed against ADM before inserting it, with all seeded
values enabled. An invalid seed fails initialization without a partial insert.

If configuration already exists, startup preserves it: additions, disabled
values, and removals are not reset from the seed. Older configuration documents
receive missing rule keys without restoring removed values.

**The bundled JSON file is still required after initialization.** The backend
loads it for supported-property registration, initial rule keys, formatted-value
suggestions, and the nested dropdown response structure and ordering.
`ALLOWED_VALUES_PATH` replaces the source of initial values; it does not replace
that bundled registration. Editing seed values does not update an existing
database, but editing the bundled object/property structure can change what
Workbench exposes. Use the admin UI or API for runtime configuration.

##### Managing a configuration

**Add New Property** guides the administrator through property, domain and object
type, permitted values, and review. If the property/domain already exists, open
its editor instead of creating a duplicate. This configures a supported field;
it does not define a new STIX schema property.

In **Edit values**, select one object type, then use the searchable checklist:

- Check a value to enable it; uncheck it to retain it as disabled.
- Remove a value to clear its setting for that object type.
- Switch object types without discarding the other types' settings.
- Save the complete draft or cancel without changing configuration.

For data-source/component names, enter the two names separately and choose
**Validate and add**. The value enters the draft only after ADM accepts its
format. Pending input must be validated or cleared before saving.

An empty configuration persists and offers no choices. These operations do not
rewrite existing ATT&CK objects or change their validation requirements.

##### Adding values

A value does not generally need to be added to both ADM and the JSON file:

| Situation                                                                    | ADM change | JSON change                                           | Operator action                                                            |
| ---------------------------------------------------------------------------- | ---------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| ADM already permits the value, but it is not configured or enabled           | None       | None                                                  | Enable it in the relevant property/domain and object-type scope, then save |
| The value is a new enum member that ADM rejects                              | Required   | Only if it should be a default for new configurations | Upgrade the backend ADM package, then enable the value through the UI      |
| A new data-source/component string satisfies ADM's existing format validator | None       | None                                                  | Use Validate and add, then save                                            |

For a new enum member:

1. Add support to the appropriate ADM schema, including any scope constraints,
   and publish a package release.
2. Update the backend's dependency and lockfile to resolve that release.
3. Rebuild and redeploy the backend, or restart it after installing the updated
   dependency in a source deployment.
4. Reload the Allowed Values page and confirm its **Backend ADM** version.
5. Enable the newly available value for the intended scope and save.

Changing ADM's GitHub source alone does not change a running Workbench. New enum
members without saved settings are not enabled automatically. The Allowed
Values UI reads the server catalog, so it does not need a matching frontend ADM
dependency upgrade for this workflow.

Add a value to the JSON seed only when it should start enabled in a newly
initialized configuration. That edit does not update existing installations.
Adding an unsupported property/object-type pair is a separate Workbench code
and registration change, not an operator value addition.

##### ADM version and enforcement

`GET /api/config/allowed-values/catalog` returns `admVersion` from the installed
backend `@mitre-attack/attack-data-model` package's `package.json`. It is not the
dependency range, the frontend's ADM version, or the ATT&CK specification
version. The page and dialogs display it alongside choices derived from that
same installed package.

Both enabled and disabled configuration values must pass ADM validation.
General validation switches and Validation Bypasses cannot exempt them.
Enum choices come from ADM; data-source strings use its format validator.
Software choices must be valid for both tool and malware objects.

##### Legacy invalid settings

A stored setting may be invalid under the current ADM because an earlier
implementation accepted it or an ADM upgrade changed the schema.
_Quarantine_ means retaining that setting while excluding it from use:

- The backend evaluates stored settings on reads; there is no quarantine
  collection or persisted quarantine flag.
- Invalid settings never populate dropdowns, even if stored as enabled.
- The admin response lists them in `invalidValues`, with rejection reasons.
- The editor warns that saving replaces the configuration without those
  invalid settings. Merely opening the editor does not delete them.

Startup does not reject an existing configuration because it contains legacy
invalid settings. If a later ADM version accepts a retained setting again, its
stored enabled state applies; quarantine is not a permanent disable operation.
None of this changes existing STIX objects.

##### API

All management endpoints require an administrator. The dropdown endpoint retains
visitor-or-higher and read-only service access.

| Method and path                                                    | Purpose                                                                                                     |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `GET /api/config/allowed-values`                                   | Enabled, ADM-compliant choices in the existing nested object/property/domain format, including empty scopes |
| `GET /api/config/allowed-values/catalog`                           | Backend ADM version, supported scopes, choices, validation kind, and descriptions                           |
| `GET /api/config/allowed-values/rules`                             | Configured groups, compliant `values`, and legacy `invalidValues` warnings                                  |
| `POST /api/config/allowed-values/rules`                            | Create `{ propertyName, domainName, values }`; returns `201`                                                |
| `PUT /api/config/allowed-values/rules/{propertyName}/{domainName}` | Replace a configured group's complete `{ values }` set                                                      |
| `POST /api/config/allowed-values/validate`                         | Check `{ propertyName, domainName, objectTypes, value }` without saving; return the trimmed `{ value }`     |

Each option in `values` has `{ value, enabled, objectTypes }`: a nonempty trimmed
string, a boolean, and distinct supported object types. Values are case-sensitive.
The same value may have different enabled states in disjoint object-type scopes.

PUT replaces the entire group, so retain every option and scope you intend to
keep. Creating or saving a rule validates its values independently of
`/validate`. Invalid values, scopes, or bodies return `400`; a supported but
unconfigured PUT target returns `404`; duplicate creation or overlapping
scope/value entries return `409`. Validation failure leaves configuration
unchanged. Saves to different groups do not overwrite each other.

Object editors fetch current choices when opened. The legacy collection-bundle
ICS data-source filter also uses this configuration, so changing its choices
can affect that export projection.

#### Static Marking Definitions

Directory containing JSON files with STIX marking definitions that are automatically loaded into the system on startup.

### ATT&CK Specific

ATT&CK-specific configuration values.

| Option                   | Environment Variable | JSON Path              | Type   | Default   | Description                                                |
| ------------------------ | -------------------- | ---------------------- | ------ | --------- | ---------------------------------------------------------- |
| Attack Source Names      | _(JSON only)_        | `attackSourceNames`    | array  | See below | Valid `source_name` values in ATT&CK `external_references` |
| Domain to Kill Chain Map | _(JSON only)_        | `domainToKillChainMap` | object | See below | Maps domain names to kill chain phase names                |

**Default Attack Source Names:**

```json
["mitre-attack", "mitre-mobile-attack", "mobile-attack", "mitre-ics-attack"]
```

**Default Domain to Kill Chain Map:**

```json
{
  "enterprise-attack": "mitre-attack",
  "mobile-attack": "mitre-mobile-attack",
  "ics-attack": "mitre-ics-attack"
}
```

---

## STIX graph-write exclusion

Authoring lifecycle validation and persistence share a database-backed lock in
`graphWriteLocks` with `_id: "stix-graph"`. Writes queue within one API process;
a competing worker returns `409` with `code: "graph_write_conflict"`. Read-only
preflight checks are advisory; final writes revalidate while holding the lock.
Imports participate in write exclusion but retain their source-fidelity policy.

The lock deliberately has **no automatic expiry**. On standalone MongoDB, taking
over an expired lock cannot fence a paused former owner's subsequent writes.
A process crash or failed lock release therefore fails closed: graph writes can
remain blocked until an operator recovers the lock.

Recovery procedure:

1. Stop **all API workers and other graph writers** using this database. Do not
   remove a lock merely because an operation appears slow.
2. Inspect the failed operation's logs and persisted object/SRO revisions.
   Revocation is preflighted but not a multi-document transaction; earlier
   writes may have completed before an unexpected database failure.
3. In the correct Workbench database, inspect the ownership record:
   `db.graphWriteLocks.findOne({_id: "stix-graph"})`.
4. Only after every writer is stopped, remove that record:
   `db.graphWriteLocks.deleteOne({_id: "stix-graph"})`.
5. Restart the workers, refresh affected objects, and reconcile the operation's
   persisted state before retrying. Never delete STIX revisions as lock cleanup.

This recovery does not rebuild embedded-reference metadata or roll back partial
work. See [lifecycle workflow semantics](../user/revoke-workflow.md).

## Additional Resources

- [Authentication Documentation](./authentication/README.md)
- [Sample Configurations](../../resources/sample-configurations/)
- [Template Environment File](../../template.env)

## Validation policy storage and upgrades

The existing `/api/config/validation-bypasses` API accepts `error-bypass` rules
and `object-exemption` rules. An omitted `kind` retains the legacy error bypass
contract. Exemptions require a readable `name`, Boolean `enabled`, a
`retirementStatus` of `revoked` or `deprecated`, and `stixTypes` equal to `all` or
a nonempty list of supported STIX types. Type lists are normalized; duplicate
selectors are rejected even if the names or enabled states differ. Mixed fields
from the two rule kinds are rejected. Existing list pagination, permissions,
rule IDs, and CRUD status codes remain compatible.

Newly initialized policies include separate enabled all-type revoked and deprecated
rules. Their one-time seed marker prevents restart from undoing edits, enabling
disabled rules, or recreating deleted defaults. Custom overlapping rules are
allowed; any enabled match grants exemption. A disabled rule does not cancel
another enabled rule.

The canonical policy stores rules and pending reevaluation intent atomically.
Saving a change advances policy revision and evaluation generation; it does not
synchronously scan historical revisions. Rule payloads and control metadata are
limited to 8 MiB total and 10,000 rules.

For the first upgrade to canonical policy storage, stop all old API writers,
back up the database, and run one designated upgrader with migrations enabled.
Set `WB_REST_DATABASE_MIGRATION_ENABLE=true` (the default) for that designated
server. Keep it out of request traffic until startup completes.
The final validation-policy migration runs after earlier migrations finish
modifying legacy rules. Start new workers only after cutover completes. Mixing
old servers that write the legacy collection with new canonical-policy servers
is unsupported. The old collection is retained as historical input and is no
longer synchronized after cutover; restore the stopped-server backup for rollback.

An engine upgrade (ADM package, ATT&CK specification, or evaluator implementation)
also requires stopping older workers. The designated initializer must explicitly
call `validation-policy-service.initialize({ activateEngine: true })` after
connecting to the database. This activates the engine once and records a new
reevaluation generation. Normal initialization only verifies an existing engine
and fails on a mismatch. For an existing canonical policy, run this one-off command
from the REST API repository with the new engine installed and the target database
configuration loaded, **after all previous API workers have stopped and a backup
has been taken**, before starting the new servers:

```sh
node <<'JS'
const mongoose = require('mongoose');
(async () => {
  try {
    await require('./app/lib/database-connection').initializeConnection();
    const policy = require('./app/services/system/validation-policy-service');
    await policy.initialize({ activateEngine: true });
    const snapshot = await policy.loadSnapshot();
    console.log({
      policy_revision: snapshot.policy_revision,
      evaluation_generation: snapshot.evaluation_generation,
      engine_context: snapshot.engine_context,
    });
  } finally {
    await mongoose.disconnect();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
JS
```

This command writes the canonical engine context and queues reevaluation. It does
not run the API, worker or pending migrations. The first canonical-storage migration
already performs explicit activation; do not run this command ahead of that legacy
cutover, because earlier migrations must finish modifying legacy rules first.
After an existing-policy activation, start one new server with migrations enabled,
confirm startup and matching engine context, then start the remaining new workers.
A repeat activation using the same engine is a no-op. Preserve administrator rule
edits and removed defaults; activation does not reset them. Restore the stopped-server
backup for rollback rather than mixing engines or copying legacy rules back.
See the [storage and evaluation contract](../developer/validation-policy.md).

### Validation diagnostic reconciliation

After initialization, the API explicitly starts a durable validation worker even
when `ENABLE_SCHEDULER=false`. Policy changes and designated engine activation
record pending work atomically with the new context. All object and relationship
revisions are scanned in bounded batches; process restart resumes an expired lease
from its checkpoint. This updates current diagnostics without rewriting STIX,
workflow review decisions, release membership, published bundles, or import reports.
New revisions record recovery work with their content, so interrupted diagnostic
publication and late inserts after a completed scan are also recovered by this
worker after restart, independently of the scheduler.

Use `GET /api/config/validation-bypasses/reconciliation` to inspect progress and
bounded failure information. `POST /api/config/validation-bypasses/reconciliation/retry`
requeues failed work. These routes are administrator-only. Enforcement already uses
the saved policy while cleanup is pending or failed. Older diagnostic markers are
omitted from ordinary HTTP reads rather than shown as current under a newer policy.

An administrator can inspect and retry through an authenticated session:

```sh
curl -b cookies.txt \
  'http://localhost:3000/api/config/validation-bypasses/reconciliation'
curl -b cookies.txt -X POST -H 'Content-Type: application/json' --data '{}' \
  'http://localhost:3000/api/config/validation-bypasses/reconciliation/retry'
```

`progress.total` can be null before counting and is estimated during a scan;
completion finalizes it. Retry resumes failed work from its checkpoint and is a
no-op for pending, running or completed work. Inspect `last_error` when failed.
A newer policy resets progress for a full scan; there is no superseded-job history
in this endpoint. The UI displays enforcement as active while cleanup is pending.

### Optional validation reports

[Validation report retention](validation-reports.md) documents 24-hour TTL storage,
current authorization and the separate durable report key. Reports do not depend
on the scheduler switch or session-secret defaults.
