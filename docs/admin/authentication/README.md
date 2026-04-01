# Authentication Configuration Guide

This directory contains comprehensive guides for configuring user authentication with the ATT&CK Workbench REST API using OpenID Connect (OIDC).

## Overview

The ATT&CK Workbench REST API supports two user authentication mechanisms:

- **Anonymous**: No authentication required (default, suitable for local development)
- **OIDC**: OpenID Connect authentication with an external identity provider (recommended for production)

This documentation focuses on OIDC configuration with popular identity providers.

## Supported Identity Providers

The REST API is compatible with any OIDC-compliant identity provider. We provide detailed setup guides for:

- [**Authentik**](authentik.md) - Open-source identity provider
- [**Keycloak**](keycloak.md) - Open-source identity and access management
- [**Okta**](okta.md) - Enterprise identity and access management service

## Quick Start

### Basic OIDC Configuration

All OIDC providers require the following environment variables in your `.env` file:

```bash
# Enable OIDC authentication
AUTHN_MECHANISM=oidc

# OIDC provider settings
AUTHN_OIDC_ISSUER_URL=<your-issuer-url>
AUTHN_OIDC_CLIENT_ID=<your-client-id>
AUTHN_OIDC_CLIENT_SECRET=<your-client-secret>
AUTHN_OIDC_REDIRECT_ORIGIN=<your-workbench-url>
```

### Required OIDC Scopes

The REST API requires these OIDC scopes:

- `openid` (required)
- `email` (required)
- `profile` (required)

### Required Claims

The REST API expects these claims in the ID token:

- `email` - User's email address (used as unique identifier)
- `preferred_username` - Username
- `name` - User's display name

## Multiple Environments

If you're running multiple instances (e.g., local development and production), each instance needs its own `AUTHN_OIDC_REDIRECT_ORIGIN` value, but can share the same Client ID and Secret.

**Example:**

- **Local**: `AUTHN_OIDC_REDIRECT_ORIGIN=http://localhost:3000`
- **Production**: `AUTHN_OIDC_REDIRECT_ORIGIN=https://workbench.example.com`

In your OIDC provider, configure **all** redirect URIs:

- `http://localhost:3000/api/authn/oidc/callback`
- `https://workbench.example.com/api/authn/oidc/callback`

## Service Authentication

For service-to-service communication, the REST API supports three methods:

1. **API Key Challenge Authentication**: Services obtain a JWT using a challenge-response protocol
2. **API Key Basic Authentication**: Services authenticate using HTTP Basic Authentication
3. **OIDC Client Credentials Flow**: Services obtain a JWT from an OIDC provider

## User Management

After configuring OIDC, users who log in will be authenticated but will not have any permissions until you create a user account for them in the Workbench.

### User Roles

- `admin` - Full access to all features
- `editor` - Can create and edit objects
- `visitor` - Read-only access
- `team_lead` - Editor permissions with team management features

### Creating User Accounts

1. Have the user log in once (they will see "User not registered" message)
2. Create a user account via the REST API or frontend
3. Assign appropriate role
4. User logs in again and will have assigned permissions

See [User Management](../../legacy/user-management.md) for detailed instructions.

## Troubleshooting

### Common Issues

#### "Invalid redirect URI" error

- Verify the redirect URI in your OIDC provider exactly matches: `<REDIRECT_ORIGIN>/api/authn/oidc/callback`
- Check that the protocol (http/https) matches

#### "Invalid issuer" error

- Ensure `AUTHN_OIDC_ISSUER_URL` is correct and accessible from the REST API server
- Verify the issuer URL includes the correct path (some providers require specific paths)

#### User authenticated but has no permissions

- Create a user account in the Workbench database
- Verify the email in the user account matches the email claim from the OIDC provider

#### Claims missing from token

- Check that your OIDC provider is configured to include `email`, `preferred_username`, and `name` in the ID token
- Verify the scopes include `openid`, `email`, and `profile`

## Additional Resources

- [Authentication Technical Details](../../legacy/authentication.md)
- [User Management Guide](../../legacy/user-management.md)
