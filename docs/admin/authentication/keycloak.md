# Keycloak OIDC Configuration Guide

> [!WARNING]
> This guide is in draft mode. Any feedback is appreciated!

This guide provides step-by-step instructions for configuring Keycloak as the OIDC identity provider for the ATT&CK Workbench REST API.

## Prerequisites

- Keycloak server installed and accessible
- Administrator access to Keycloak Admin Console
- ATT&CK Workbench REST API installed

## Overview

This guide focuses on configuring Keycloak as your OIDC provider. After completing Keycloak setup:

- Proceed to [REST API Configuration](./configuration.md) to configure the Workbench REST API
- Then follow [Testing & Verification](./testing-verification.md) to confirm everything works

This guide covers only the Keycloak-specific configuration steps.

---

## Step 1: Create a Realm (Optional)

You can use an existing realm or create a new one for the Workbench.

1. **Log into Keycloak Admin Console** as an administrator

2. **Create a new realm** (or skip to use an existing one):
   - Hover over the realm name in the top-left corner
   - Click **Add Realm** (or **Create Realm** in newer versions)
   - **Name**: `workbench-realm` (or your preferred name)
   - Click **Create**

## Step 2: Create OIDC Client

1. **Navigate to Clients**:
   - In your realm, go to **Clients**
   - Click **Create** (or **Create client**)

2. **General Settings**:
   - **Client type**: `OpenID Connect`
   - **Client ID**: `attack-workbench-rest-api` (or your preferred ID)
   - **Name**: `ATT&CK Workbench REST API` (optional, for display)
   - **Description**: `OIDC client for ATT&CK Workbench` (optional)
   - Click **Next** or **Save**

3. **Capability Config** (if prompted):
   - **Client authentication**: `ON` (required - this makes it a confidential client)
   - **Authorization**: `OFF`
   - **Authentication flow**:
     - ✓ **Standard flow** (required - this enables the authorization code flow)
     - ✗ Direct access grants (not needed)
     - ✗ Implicit flow (not recommended)
   - Click **Next** or **Save**

4. **Settings Tab**:
   - **Client authentication**: `ON`
   - **Root URL**: Leave empty or set to your Workbench URL
   - **Valid Redirect URIs**: Add your callback URL(s):
     - For single environment: `https://workbench.example.com/api/authn/oidc/callback`
     - For multiple environments, add each separately:

       ```text
       http://localhost:3000/api/authn/oidc/callback
       https://workbench.example.com/api/authn/oidc/callback
       ```

   - **Valid post logout redirect URIs**: `+` (allows any valid redirect URI)
   - **Web origins**: `+` (allows CORS for valid redirect URIs) or specify explicitly:

     ```text
     http://localhost:3000
     https://workbench.example.com
     ```

   - Click **Save**

5. **Get Client Credentials**:
   - Go to the **Credentials** tab
   - Copy the **Client Secret**
   - Note: The Client ID is what you set in step 2

## Step 3: Configure Client Scopes

The default scopes should work, but verify they're configured:

1. **Navigate to Client Scopes** (in your realm)

2. **Verify these scopes exist**:
   - `openid` (required)
   - `email` (required)
   - `profile` (required)

3. **Check the client's scopes**:
   - Go back to your client
   - Go to **Client Scopes** tab
   - Verify `email` and `profile` are in **Assigned Default Client Scopes**
   - `openid` is automatically included

## Step 4: Create Users

1. **Navigate to Users**:
   - In your realm, go to **Users**
   - Click **Add user** (or **Create new user**)

2. **User Details**:
   - **Username**: `admin@example.com` (or your preferred username)
   - **Email**: `admin@example.com` (required)
   - **Email verified**: `ON` (recommended)
   - **First name**: `Admin`
   - **Last name**: `User`
   - Click **Create**

3. **Set Password**:
   - Go to the **Credentials** tab
   - Click **Set password**
   - Enter a password
   - **Temporary**: `OFF` (if you don't want to force password reset)
   - Click **Save**

4. **Repeat** for additional users (editor, visitor, etc.)

## Step 5: Get Issuer URL

The issuer URL format for Keycloak is:

```text
https://<your-keycloak-domain>/realms/<realm-name>
```

For example:

- If your Keycloak is at: `https://keycloak.example.com`
- And your realm is: `workbench-realm`
- Then your issuer URL is: `https://keycloak.example.com/realms/workbench-realm`

You can verify this by navigating to:

```text
https://keycloak.example.com/realms/workbench-realm/.well-known/openid-configuration
```

This should return the OpenID Connect discovery document.

---

## Next Steps

You've completed the Keycloak configuration. Now proceed with:

1. **[Configure the REST API](./configuration.md)** - Set up the Workbench REST API to use Keycloak

   You'll need these values from the steps above:
   - **Issuer URL**: `https://<your-keycloak-domain>/realms/<realm-name>` (from Step 5)
   - **Client ID**: From Step 2
   - **Client Secret**: From Step 2

2. **[Test & Verify](./testing-verification.md)** - Confirm authentication is working correctly

---

## Automated Configuration Script

For development/testing environments, the REST API repository includes a configuration script:

```bash
node ./scripts/configureKeycloak.js
```

This script:

- Creates a test realm (`test-oidc-realm`)
- Creates a client (`attack-workbench-rest-api`)
- Creates test users with passwords
- Creates corresponding user accounts in Workbench

**Note**: This is intended for development only. Do not use in production.

## Troubleshooting

### Keycloak Issuer URL Format

**Issue**: Discovery fails with Keycloak.

**Solution**: Verify the issuer URL format is correct:

```text
https://<your-keycloak-domain>/realms/<realm-name>
```

Test the discovery endpoint manually:

```bash
curl https://keycloak.example.com/realms/workbench-realm/.well-known/openid-configuration
```

Important notes:

- Ensure the realm name is spelled correctly (case-sensitive)
- No trailing slash after the realm name
- The realm must exist and be active in Keycloak

### Keycloak Client Authentication

**Issue**: "Unauthorized client" error during authentication.

**Solution**: Verify client configuration in Keycloak:

1. Go to your client's **Settings** tab
2. Ensure "Client authentication" is **ON** (makes it a confidential client)
3. Verify you're using the correct Client Secret from the **Credentials** tab
4. Ensure "Standard flow" is enabled in the client settings

### Keycloak Scope Configuration

**Issue**: Missing user information after authentication.

**Solution**: Ensure scopes are properly assigned:

1. Go to your client → **Client Scopes** tab
2. Verify `email` and `profile` are in **Assigned Default Client Scopes**
3. `openid` scope is automatically included
4. Check that Keycloak users have email addresses configured
5. Verify "Email verified" is ON for users (or configure client to not require it)

### Keycloak Redirect URI Support

**Issue**: "Invalid redirect URI" error.

**Solution**: Keycloak supports wildcard patterns:

1. Check the client's "Valid Redirect URIs" setting
2. You can use wildcards like `http://localhost:*` for development
3. For production, use exact URIs for better security

## Advanced Configuration

### Service Account Authentication

Keycloak supports OIDC Client Credentials flow for service-to-service authentication.

1. **Enable service account** in your client:
   - Go to **Settings** tab
   - Enable **Service accounts roles**
   - Save

2. **Configure in REST API**:

   ```bash
   # In .env file
   SERVICE_ACCOUNT_OIDC_ENABLE=true
   JWKS_URI=https://keycloak.example.com/realms/workbench-realm/protocol/openid-connect/certs
   ```

3. **Add to JSON config** file:

   ```json
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

See [sample configuration](../../resources/sample-configurations/collection-manager-oidc-keycloak.json) for reference.

### Custom Claims and Mappers

Keycloak supports protocol mappers to add custom claims:

1. In your client, go to **Client scopes** tab
2. Select a scope or create a dedicated scope
3. Click **Add mapper** → **By configuration**
4. Choose mapper type (User Attribute, User Property, etc.)
5. Configure the mapper to add claims to the ID token

### Group/Role Mapping

To map Keycloak roles to Workbench permissions:

1. Create roles in Keycloak
2. Assign roles to users
3. Create a mapper to include roles in the token
4. Modify Workbench code to read and apply roles (requires custom development)

## Additional Resources

- [Keycloak Documentation](https://www.keycloak.org/documentation)
- [ATT&CK Workbench Authentication Documentation](./README.md)
