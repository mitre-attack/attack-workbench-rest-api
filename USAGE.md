# ATT&CK Workbench REST API Usage Guide

This guide provides comprehensive instructions for installing, configuring, and administering the ATT&CK Workbench REST API service.

## Table of Contents

- [ATT\&CK Workbench REST API Usage Guide](#attck-workbench-rest-api-usage-guide)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Installation Methods](#installation-methods)
    - [Docker Installation](#docker-installation)
      - [Using Docker Compose (Recommended)](#using-docker-compose-recommended)
      - [Standalone Docker Deployment](#standalone-docker-deployment)
    - [Manual Installation](#manual-installation)
      - [Requirements](#requirements)
      - [Installation Steps](#installation-steps)
  - [Configuration](#configuration)
    - [Environment Variables](#environment-variables)
    - [Configuration File](#configuration-file)
  - [Authentication](#authentication)
  - [User Management](#user-management)
    - [User Roles and Permissions](#user-roles-and-permissions)
    - [User Account Status](#user-account-status)
    - [User Management Endpoints](#user-management-endpoints)
  - [API Documentation](#api-documentation)
  - [Management and Administration](#management-and-administration)
    - [Health Checks](#health-checks)
    - [Logging](#logging)
    - [Backup and Restore](#backup-and-restore)
  - [Troubleshooting](#troubleshooting)

## Overview

The ATT&CK Workbench REST API provides services for storing, querying, and editing ATT&CK objects. It is built on Node.js and Express.js, and uses MongoDB for data persistence.

This component is part of the larger ATT&CK Workbench application, which includes:
- [ATT&CK Workbench Frontend](https://github.com/mitre-attack/attack-workbench-frontend)
- [ATT&CK Workbench REST API](https://github.com/mitre-attack/attack-workbench-rest-api) (this component)

## Installation Methods

### Docker Installation

The recommended deployment method is using Docker. The REST API is published as a Docker image to the GitHub Container Registry.

#### Using Docker Compose (Recommended)

The simplest way to deploy the entire ATT&CK Workbench application is using Docker Compose.
Instructions are available in the [Workbench Deployment Guide](https://github.com/mitre-attack/attack-workbench-deployment).

#### Standalone Docker Deployment

To run only the REST API in a Docker container:

1. **Create a Docker network** (if not already created):

   ```shell
   docker network create attack-workbench-network
   ```

2. **Run MongoDB container**:

   ```shell
   docker run --name attack-workbench-mongodb -d \
     --network attack-workbench-network \
     mongo:latest
   ```

3. **Run REST API container**:

   ```shell
   docker run -p 3000:3000 -d \
     --name attack-workbench-rest-api \
     --env DATABASE_URL=mongodb://attack-workbench-mongodb/attack-workspace \
     --network attack-workbench-network \
     ghcr.io/center-for-threat-informed-defense/attack-workbench-rest-api:latest
   ```

For more advanced configurations, you can use a configuration file:

```shell
docker run -p 3000:3000 -d \
  --name attack-workbench-rest-api \
  --env JSON_CONFIG_PATH=/usr/src/app/settings/config.json \
  --volume /path/to/your/config:/usr/src/app/settings \
  --network attack-workbench-network \
  ghcr.io/center-for-threat-informed-defense/attack-workbench-rest-api:latest
```

More infomation about configuration options is in the [configuration file documentation](./docs/admin/configuration.md).

### Manual Installation

#### Requirements

- [Node.js](https://nodejs.org) version `22.x` or greater
- [MongoDB](https://www.mongodb.com/) version `8.x` or greater

#### Installation Steps

1. **Clone the repository**:

   ```shell
   git clone https://github.com/mitre-attack/attack-workbench-rest-api.git
   cd attack-workbench-rest-api
   ```

2. **Install dependencies**:

   ```shell
   npm install
   ```

3. **Configure the application** using environment variables or a configuration file (see [Configuration](#configuration)).

4. **Start the application**:

   ```shell
   node ./bin/www
   ```

## Configuration

The REST API can be configured using environment variables, a configuration file, or a combination of both. Configuration file values take precedence over environment variables.

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| **PORT** | No | `3000` | Port the HTTP server should listen on |
| **CORS_ALLOWED_ORIGINS** | No | `*` | Configures CORS policy. Accepts a comma-separated list of allowed domains. (`*` allows all domains; `disable` disables CORS entirely.) |
| **NODE_ENV** | No | `development` | Environment that the app is running in |
| **DATABASE_URL** | Yes | none | URL of the MongoDB server |
| **AUTHN_MECHANISM** | No | `anonymous` | Mechanism to use for authenticating users |
| **DEFAULT_INTERVAL** | No | `300` | How often collection indexes should check for updates (in seconds) |
| **JSON_CONFIG_PATH** | No | `` | Location of a JSON file containing configuration values |
| **LOG_LEVEL** | No | `info` | Level of messages to be written to the log (error, warn, http, info, verbose, debug) |
| **WB_REST_STATIC_MARKING_DEFS_PATH** | No | `./app/lib/default-static-marking-definitions/` | Path to a directory containing static marking definitions |

A typical value for DATABASE_URL when running locally is `mongodb://localhost/attack-workspace`.

### Configuration File

If the `JSON_CONFIG_PATH` environment variable is set, the app will read configuration settings from a JSON file at that location.

| Property | Type | Corresponding Environment Variable |
|----------|------|-----------------------------------|
| **server.port** | int | PORT |
| **server.corsAllowedOrigins** | string/array | CORS_ALLOWED_ORIGINS |
| **app.env** | string | NODE_ENV |
| **database.url** | string | DATABASE_URL |
| **collectionIndex.defaultInterval** | int | DEFAULT_INTERVAL |
| **logging.logLevel** | string | LOG_LEVEL |

Example configuration file:

```json
{
  "server": {
    "port": 4000,
    "corsAllowedOrigins": ["https://example.com", "https://workbench.example.com"]
  },
  "database": {
    "url": "mongodb://localhost/attack-workspace"
  },
  "logging": {
    "logLevel": "debug"
  }
}
```

## Authentication

The REST API has several authentication options.
Read all about them in the [authentication docs](./docs/admin/authentication/README.md).

## User Management

The REST API includes a user management system when using OIDC authentication.

### User Roles and Permissions

The system supports these roles:

| Role      | Description                                                       |
|-----------|-------------------------------------------------------------------|
| `none`    | No access to the system (for pending/inactive users)              |
| `visitor` | Read-only access to ATT&CK objects                                |
| `editor`  | Read and write access to ATT&CK objects                           |
| `admin`   | Full access to all system capabilities, including user management |

### User Account Status

| Status     | Description                             |
|------------|-----------------------------------------|
| `pending`  | User has registered but awaits approval |
| `active`   | User is registered and approved         |
| `inactive` | User is no longer active                |

### User Management Endpoints

| Endpoint                      | Method | Description       | Authorization                 |
|-------------------------------|--------|-------------------|-------------------------------|
| `/api/user-accounts`          | GET    | List all users    | Admin only                    |
| `/api/user-accounts/:id`      | GET    | Get user by ID    | Admin or self                 |
| `/api/user-accounts/register` | POST   | Register new user | Logged in, unregistered users |
| `/api/user-accounts/:id`      | PUT    | Update user       | Admin only                    |

## API Documentation

When running in development mode (`NODE_ENV=development`), the REST API provides interactive documentation via Swagger UI at the `/api-docs` endpoint.

For a local deployment, this is typically available at `http://localhost:3000/api-docs`.

## Management and Administration

### Health Checks

The REST API provides a health check endpoint at `/api/health` that returns the status of the application and its connections.

### Logging

Logging can be configured using the `LOG_LEVEL` environment variable or the `logging.logLevel` configuration property. Available log levels are:

- `error`: Only errors are logged
- `warn`: Errors and warnings are logged
- `http`: HTTP requests, errors, and warnings are logged
- `info`: General information plus the above (default)
- `verbose`: More detailed information
- `debug`: Debug-level information

### Backup and Restore

The REST API stores all data in MongoDB. To backup and restore:

1. **Backup**: Use MongoDB's standard backup tools (e.g., `mongodump`)
2. **Restore**: Use MongoDB's standard restore tools (e.g., `mongorestore`)

## Troubleshooting

Common issues and their solutions:

1. **Connection to MongoDB fails**:
   - Verify MongoDB is running
   - Check the `DATABASE_URL` environment variable
   - Ensure network connectivity between the REST API and MongoDB

2. **OIDC authentication fails**:
   - Verify the OIDC configuration variables
   - Check that the redirect URL is correctly registered with your OIDC provider
   - Ensure the client ID and secret are correct

3. **CORS issues**:
   - Configure the `CORS_ALLOWED_ORIGINS` to include your frontend application's domain
   - For development, you can set it to `*` to allow all origins

4. **Permission denied errors**:
   - Check the user's role and status
   - Ensure the user account has the necessary permissions for the operation
