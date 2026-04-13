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
    - [Collection Indexes](#collection-indexes)
    - [Configuration Files](#configuration-files)
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

| Option               | Environment Variable    | JSON Path                  | Type    | Default | Description                                                                                                     |
|----------------------|-------------------------|----------------------------|---------|---------|-----------------------------------------------------------------------------------------------------------------|
| Port                 | `PORT`                  | `server.port`              | integer | `3000`  | HTTP server port                                                                                                |
| CORS Allowed Origins | `CORS_ALLOWED_ORIGINS`  | `server.corsAllowedOrigins`| domains | `*`     | Allowed origins for CORS. Use `*` for all, `disable` to disable CORS, or comma-separated list of origins        |

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

| Option       | Environment Variable                | JSON Path                    | Type    | Default     | Description                               |
|--------------|-------------------------------------|------------------------------|---------|-------------|-------------------------------------------|
| URL          | `DATABASE_URL`                      | `database.url`               | string  | *(empty)*   | MongoDB connection string (REQUIRED)      |
| Auto-migrate | `WB_REST_DATABASE_MIGRATION_ENABLE` | `database.migration.enable`  | boolean | `true`      | Run migrations automatically on startup   |

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

### Application

General application settings.

| Option              | Environment Variable | JSON Path               | Type   | Default                     | Description                                               |
|---------------------|----------------------|-------------------------|--------|-----------------------------|-----------------------------------------------------------|
| Name                | *(none)*             | `app.name`              | string | `attack-workbench-rest-api` | Application name                                          |
| Environment         | `NODE_ENV`           | `app.env`               | string | `development`               | Environment name (`development`, `production`, `test`)    |
| Version             | *(none)*             | `app.version`           | string | *(from package.json)*       | Application version                                       |
| ATT&CK Spec Version | *(none)*             | `app.attackSpecVersion` | string | *(from package.json)*       | ATT&CK specification version                              |

**Example:**

```bash
NODE_ENV=production
```

### Logging

Logging configuration using Winston.

| Option    | Environment Variable | JSON Path          | Type   | Default | Description         |
|-----------|----------------------|--------------------|--------|---------|---------------------|
| Log Level | `LOG_LEVEL`          | `logging.logLevel` | string | `info`  | Console log level   |

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

| Option               | Environment Variable           | JSON Path                        | Type   | Default                  | Description                               |
|----------------------|--------------------------------|----------------------------------|--------|--------------------------|-------------------------------------------|
| Secret               | `SESSION_SECRET`               | `session.secret`                 | string | *(generated at startup)* | Secret used to sign session cookies       |
| Mongo Session Secret | `MONGOSTORE_CRYPTO_SECRET`     | `session.mongoStoreCryptoSecret` | string | *(generated at startup)* | Secret to encrypt session data in MongoDB |

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

| Option    | Environment Variable | JSON Path             | Type | Default     | Description                      |
|-----------|----------------------|-----------------------|------|-------------|----------------------------------|
| Mechanism | `AUTHN_MECHANISM`    | `userAuthn.mechanism` | enum | `anonymous` | Authentication mechanism to use  |

**Mechanism Options:**

- `anonymous` - No authentication required (development only)
- `oidc` - OpenID Connect (recommended for production)

#### OIDC Configuration

Required when `mechanism` is set to `oidc`.

| Option          | Environment Variable         | JSON Path                       | Type   | Default                 | Description                 |
|-----------------|------------------------------|---------------------------------|--------|-------------------------|-----------------------------|
| Issuer URL      | `AUTHN_OIDC_ISSUER_URL`      | `userAuthn.oidc.issuerUrl`      | string | *(empty)*               | OIDC provider's issuer URL  |
| Client ID       | `AUTHN_OIDC_CLIENT_ID`       | `userAuthn.oidc.clientId`       | string | *(empty)*               | OIDC client identifier      |
| Client Secret   | `AUTHN_OIDC_CLIENT_SECRET`   | `userAuthn.oidc.clientSecret`   | string | *(empty)*               | OIDC client secret          |
| Redirect Origin | `AUTHN_OIDC_REDIRECT_ORIGIN` | `userAuthn.oidc.redirectOrigin` | string | `http://localhost:3000` | Base URL for redirect URI   |

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

| Option   | Environment Variable          | JSON Path                                    | Type    | Default   | Description                                    |
|----------|-------------------------------|----------------------------------------------|---------|-----------|------------------------------------------------|
| Enable   | `SERVICE_ACCOUNT_OIDC_ENABLE` | `serviceAuthn.oidcClientCredentials.enable`  | boolean | `false`   | Enable OIDC client credentials authentication  |
| JWKS URI | `JWKS_URI`                    | `serviceAuthn.oidcClientCredentials.jwksUri` | string  | *(empty)* | JWKS endpoint for IdP public keys              |
| Clients  | *(JSON only)*                 | `serviceAuthn.oidcClientCredentials.clients` | array   | `[]`      | Array of authorized OIDC clients               |

**Clients Array Schema:**

```json
{
  "clientId": "string",      // OIDC client ID
  "serviceRole": "enum"      // Service role (read-only, collection-manager, stix-export)
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

- [collection-manager-oidc-keycloak.json](../resources/sample-configurations/collection-manager-oidc-keycloak.json)
- [collection-manager-oidc-okta.json](../resources/sample-configurations/collection-manager-oidc-okta.json)

#### Challenge API Key

Token exchange authentication with challenge/response mechanism.

| Option               | Environment Variable                              | JSON Path                                     | Type    | Default                  | Description                           |
|----------------------|---------------------------------------------------|-----------------------------------------------|---------|--------------------------|---------------------------------------|
| Enable               | `WB_REST_SERVICE_ACCOUNT_CHALLENGE_APIKEY_ENABLE` | `serviceAuthn.challengeApikey.enable`         | boolean | `false`                  | Enable challenge API key authentication |
| Token Signing Secret | `WB_REST_TOKEN_SIGNING_SECRET`                    | `serviceAuthn.challengeApikey.secret`         | string  | *(generated at startup)* | Secret used to sign access tokens     |
| Token Timeout        | `WB_REST_TOKEN_TIMEOUT`                           | `serviceAuthn.challengeApikey.tokenTimeout`   | integer | `300`                    | Access token lifetime in seconds      |
| Service Accounts     | *(JSON only)*                                     | `serviceAuthn.challengeApikey.serviceAccounts`| array   | `[]`                     | Array of service accounts             |

**Service Accounts Array Schema:**

```json
{
  "name": "string",          // Service account name
  "apikey": "string",        // Shared secret (API key)
  "serviceRole": "enum"      // Service role
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

See sample: [test-service-challenge-apikey.json](../resources/sample-configurations/test-service-challenge-apikey.json)

#### Basic API Key

Simple API key authentication (no challenge).

| Option           | Environment Variable                           | JSON Path                                  | Type    | Default | Description                          |
|------------------|------------------------------------------------|--------------------------------------------|---------|---------|--------------------------------------|
| Enable           | `WB_REST_SERVICE_ACCOUNT_BASIC_APIKEY_ENABLE`  | `serviceAuthn.basicApikey.enable`          | boolean | `false` | Enable basic API key authentication  |
| Service Accounts | *(JSON only)*                                  | `serviceAuthn.basicApikey.serviceAccounts` | array   | `[]`    | Array of service accounts            |

**Service Accounts Array Schema:**

```json
{
  "name": "string",          // Service account name
  "apikey": "string",        // API key
  "serviceRole": "enum"      // Service role
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

See sample: [navigator-basic-apikey.json](../resources/sample-configurations/navigator-basic-apikey.json)

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

See sample: [multiple-apikey-services.json](../resources/sample-configurations/multiple-apikey-services.json)

### Scheduler

Background job scheduler configuration.

| Option         | Environment Variable       | JSON Path                        | Type    | Default | Description                          |
|----------------|----------------------------|----------------------------------|---------|---------|--------------------------------------|
| Enable         | `ENABLE_SCHEDULER`         | `scheduler.enableScheduler`      | boolean | `true`  | Enable background job scheduler      |
| Check Interval | `CHECK_WORKBENCH_INTERVAL` | `scheduler.checkWorkbenchInterval` | integer | `10`    | Scheduler check interval in seconds  |

**Scheduler Functions:**

- Checks for collection index updates
- Downloads collection bundles from remote URLs
- Processes subscription update policies

**Example:**

```bash
ENABLE_SCHEDULER=true
CHECK_WORKBENCH_INTERVAL=30
```

### Collection Indexes

Configuration for ATT&CK collection index subscriptions.

| Option           | Environment Variable | JSON Path                        | Type    | Default | Description                               |
|------------------|----------------------|----------------------------------|---------|---------|-------------------------------------------|
| Default Interval | `DEFAULT_INTERVAL`   | `collectionIndex.defaultInterval`| integer | `300`   | Default update check interval in seconds  |

**Notes:**

- Only applies to new collection indexes added after configuration change
- Does not affect existing collection indexes (they retain their configured interval)

### Configuration Files

Paths to additional configuration and data files.

| Option                            | Environment Variable                 | JSON Path                                           | Type   | Default                                          | Description                                      |
|-----------------------------------|--------------------------------------|-----------------------------------------------------|--------|--------------------------------------------------|--------------------------------------------------|
| JSON Config Path                  | `JSON_CONFIG_PATH`                   | `configurationFiles.jsonConfigFile`                 | string | *(empty)*                                        | Path to JSON configuration file                  |
| Allowed Values Path               | `ALLOWED_VALUES_PATH`                | `configurationFiles.allowedValues`                  | string | `./app/config/allowed-values.json`               | Path to allowed values configuration             |
| Static Marking Definitions Path   | `WB_REST_STATIC_MARKING_DEFS_PATH`   | `configurationFiles.staticMarkingDefinitionsPath`   | string | `./app/lib/default-static-marking-definitions/`  | Directory containing static marking definitions  |

**Allowed Values:**

The allowed values file defines valid enum values for STIX object properties (platforms, permissions, etc.).
See `app/config/allowed-values.json` for the schema.

**Static Marking Definitions:**

Directory containing JSON files with STIX marking definitions that are automatically loaded into the system on startup.

### ATT&CK Specific

ATT&CK-specific configuration values.

| Option                   | Environment Variable | JSON Path              | Type   | Default    | Description                                                     |
|--------------------------|----------------------|------------------------|--------|------------|-----------------------------------------------------------------|
| Attack Source Names      | *(JSON only)*        | `attackSourceNames`    | array  | See below  | Valid `source_name` values in ATT&CK `external_references`      |
| Domain to Kill Chain Map | *(JSON only)*        | `domainToKillChainMap` | object | See below  | Maps domain names to kill chain phase names                     |

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

## Additional Resources

- [Authentication Documentation](./authentication/README.md)
- [Sample Configurations](../resources/sample-configurations/)
- [Template Environment File](../template.env)
