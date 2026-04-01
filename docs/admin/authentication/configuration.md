# REST API OIDC Configuration

This guide describes how to configure the ATT&CK Workbench REST API to use an OpenID Connect (OIDC) identity provider for authentication.

## Prerequisites

Before configuring the REST API, ensure you have:

1. Completed the OIDC provider setup (Authentik, Okta, Keycloak, or other provider)
2. Obtained the following values from your identity provider:
   - **Issuer URL**: The OIDC issuer/discovery endpoint
   - **Client ID**: The application/client identifier
   - **Client Secret**: The confidential client secret
3. Determined your **Redirect Origin**: The base URL where users access your Workbench instance

## Configuration Steps

### Step 1: Edit Environment Configuration

Edit the `.env` file in your REST API installation directory and add the following OIDC settings:

```bash
# Enable OIDC authentication
AUTHN_MECHANISM=oidc

# OIDC Provider settings
AUTHN_OIDC_ISSUER_URL=<your-issuer-url>
AUTHN_OIDC_CLIENT_ID=<your-client-id>
AUTHN_OIDC_CLIENT_SECRET=<your-client-secret>
AUTHN_OIDC_REDIRECT_ORIGIN=<your-workbench-url>
```

#### Configuration Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `AUTHN_MECHANISM` | Authentication method to use | `oidc` |
| `AUTHN_OIDC_ISSUER_URL` | OIDC discovery endpoint from your provider | `https://auth.example.com/realms/workbench` |
| `AUTHN_OIDC_CLIENT_ID` | Client ID from your OIDC application | `attack-workbench-rest-api` |
| `AUTHN_OIDC_CLIENT_SECRET` | Client secret from your OIDC application | `your-secret-value` |
| `AUTHN_OIDC_REDIRECT_ORIGIN` | Base URL where users access Workbench | `https://workbench.example.com` |

**Important Notes:**

- The callback URL is automatically constructed as: `{AUTHN_OIDC_REDIRECT_ORIGIN}/api/authn/oidc/callback`
- Ensure this callback URL matches exactly what you configured in your OIDC provider
- The issuer URL format varies by provider - see your provider's specific guide

### Step 2: Multiple Environment Configuration

When deploying to multiple environments (development, staging, production), each instance needs its own `.env` file with environment-specific values.

**Local Development** (`.env`):

```bash
AUTHN_MECHANISM=oidc
AUTHN_OIDC_ISSUER_URL=https://auth.example.com/realms/workbench
AUTHN_OIDC_CLIENT_ID=attack-workbench-rest-api
AUTHN_OIDC_CLIENT_SECRET=your-client-secret
AUTHN_OIDC_REDIRECT_ORIGIN=http://localhost:3000
```

**Production** (`.env`):

```bash
AUTHN_MECHANISM=oidc
AUTHN_OIDC_ISSUER_URL=https://auth.example.com/realms/workbench
AUTHN_OIDC_CLIENT_ID=attack-workbench-rest-api
AUTHN_OIDC_CLIENT_SECRET=your-client-secret
AUTHN_OIDC_REDIRECT_ORIGIN=https://workbench.example.com
```

**Best Practices:**

- Use the same Client ID and Secret across environments (configure multiple redirect URIs in your provider)
- Use environment variables or secrets management for Client Secret in production
- Never commit the `.env` file to version control
- Keep a `.env.template` file with dummy values for documentation

### Step 3: Restart the REST API

After updating the configuration, restart the REST API to load the new settings:

```bash
# If using Docker Compose
docker compose restart rest-api

# If running directly with npm
npm start
```

### Step 4: Verify Configuration Load

Check the REST API logs during startup to confirm the configuration was loaded successfully:

```bash
# If using Docker Compose
docker compose logs rest-api

# If running directly
# Check your console output or log files
```

Look for messages indicating:

- OIDC authentication enabled
- Connection to the issuer successful
- Discovery endpoint loaded

## Configuration File Alternative

Instead of environment variables, you can use a JSON configuration file. This is useful for:

- Managing multiple configuration sections in one place
- Version controlling your configuration (without secrets)
- Configuring complex structures like service accounts

**Using JSON Configuration:**

1. Create a `config.json` file:

   ```json
   {
     "userAuthn": {
       "mechanism": "oidc",
       "oidc": {
         "issuerUrl": "https://auth.example.com/realms/workbench",
         "clientId": "attack-workbench-rest-api",
         "clientSecret": "your-client-secret",
         "redirectOrigin": "https://workbench.example.com"
       }
     }
   }
   ```

2. Reference it via environment variable:

   ```bash
   JSON_CONFIG_PATH=/path/to/config.json
   ```

**Configuration Precedence:**

When both environment variables and JSON configuration are used:

1. Environment variables are loaded first
2. JSON configuration file (if specified) overrides environment variables

For complete configuration documentation, including all available options and advanced scenarios,
see the [REST API Configuration Guide](../configuration.md).

## Next Steps

After configuring the REST API, proceed to [Testing & Verification](./testing-verification.md) to confirm your authentication setup is working correctly.

## Troubleshooting

### Configuration not loading

**Symptoms**: REST API still shows anonymous authentication

**Solutions**:

1. Verify the `.env` file is in the correct directory (REST API root)
2. Check for typos in variable names (they are case-sensitive)
3. Ensure there are no spaces around the `=` sign
4. Restart the REST API after making changes

### Invalid configuration values

**Symptoms**: Errors during REST API startup

**Solutions**:

1. Verify the issuer URL is correct and accessible from the REST API server
2. Check that Client ID and Secret match your OIDC provider configuration
3. Ensure the redirect origin URL is correct (no trailing slash)

## Additional Resources

- [Authentication Overview](./README.md)
- [Testing & Verification Guide](./testing-verification.md)
- Provider-specific guides:
  - [Authentik Configuration](./authentik.md)
  - [Okta Configuration](./okta.md)
  - [Keycloak Configuration](./keycloak.md)
