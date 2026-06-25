# Okta OIDC Configuration Guide

> [!WARNING]
> This guide is in draft mode. Any feedback is appreciated!

This guide provides step-by-step instructions for configuring Okta as the OIDC identity provider for the ATT&CK Workbench REST API.

## Prerequisites

- Okta account (free Developer account or enterprise)
- Administrator access to Okta Admin Console
- ATT&CK Workbench REST API installed

## Overview

This guide focuses on configuring Okta as your OIDC provider. After completing Okta setup:

- Proceed to [REST API Configuration](./configuration.md) to configure the Workbench REST API
- Then follow [Testing & Verification](./testing-verification.md) to confirm everything works

This guide covers only the Okta-specific configuration steps.

---

## Step 1: Create OIDC Application in Okta

1. **Log into Okta Admin Console**:
   - Navigate to your Okta domain (e.g., `https://dev-12345.okta.com/admin`)
   - Sign in as an administrator

2. **Navigate to Applications**:
   - In the Admin Console, go to **Applications** → **Applications**
   - Click **Create App Integration**

3. **Select Sign-in Method**:
   - **Sign-in method**: `OIDC - OpenID Connect`
   - **Application type**: `Web Application`
   - Click **Next**

4. **Configure General Settings**:
   - **App integration name**: `ATT&CK Workbench REST API`
   - **Logo** (optional): Upload a logo if desired
   - Click **Next** or continue to Grant type

## Step 2: Configure Application Settings

1. **Grant Type**:
   - ✓ **Authorization Code** (required)
   - ✗ Refresh Token (optional, not required)
   - ✗ Implicit (not recommended)

2. **Sign-in redirect URIs**: Add your callback URL(s):
   - For single environment:

     ```text
     https://workbench.example.com/api/authn/oidc/callback
     ```

   - For multiple environments, add each separately:

     ```text
     http://localhost:3000/api/authn/oidc/callback
     https://workbench.example.com/api/authn/oidc/callback
     ```

3. **Sign-out redirect URIs** (optional):
   - Add your application's base URLs:

     ```text
     http://localhost:3000
     https://workbench.example.com
     ```

4. **Controlled access** (Assignments):
   - **Allow everyone in your organization to access**: For initial setup/testing
   - **Limit access to selected groups**: For production (recommended)
   - Select the appropriate option for your needs

5. **Click Save**

## Step 3: Get Client Credentials

After saving, you'll be taken to the application details page:

1. **Note the following values**:
   - **Client ID**: Found under "Client Credentials"
   - **Client Secret**: Click to reveal and copy
   - **Okta domain**: Your Okta domain (e.g., `dev-12345.okta.com`)

2. **Determine your Issuer URL**:
   - For Okta Developer accounts: `https://<your-okta-domain>/oauth2/default`
   - For custom authorization servers: `https://<your-okta-domain>/oauth2/<authServerId>`
   - For org authorization server: `https://<your-okta-domain>`

   **To find your issuer URL**:
   - Go to **Security** → **API** in the Okta Admin Console
   - Find your authorization server (typically "default" for developer accounts)
   - Copy the **Issuer URI**

## Step 4: Configure OpenID Connect Scopes

1. **Navigate to your Authorization Server**:
   - Go to **Security** → **API**
   - Click on your authorization server (e.g., "default")

2. **Verify Scopes**:
   - Go to the **Scopes** tab
   - Ensure these scopes exist and are enabled:
     - `openid` (required)
     - `email` (required)
     - `profile` (required)

3. **Configure Claims** (verify defaults):
   - Go to the **Claims** tab
   - Verify these claims are configured for ID Token:
     - `sub` (subject - default)
     - `email` (from user.email)
     - `preferred_username` (from user.login or user.email)
     - `name` (from user.displayName or concatenated firstName/lastName)

   If missing, add them:
   - Click **Add Claim**
   - **Name**: `email`
   - **Include in token type**: `ID Token`, `Always`
   - **Value type**: `Expression`
   - **Value**: `user.email`
   - Save

## Step 5: Create or Assign Users

### Option A: Create New Users

1. **Navigate to Users**:
   - Go to **Directory** → **People**
   - Click **Add Person**

2. **Fill in User Details**:
   - **First name**: `Admin`
   - **Last name**: `User`
   - **Username**: `admin@example.com`
   - **Primary email**: `admin@example.com`
   - **Password**: Choose how to set:
     - Set by admin
     - Set by user (email activation)
   - Click **Save**

3. **Assign to Application**:
   - On the user's profile, go to **Applications** tab
   - Click **Assign Applications**
   - Find "ATT&CK Workbench REST API"
   - Click **Assign** → **Save and Go Back**

### Option B: Assign Existing Users

1. **From the Application**:
   - Go to **Applications** → **Applications**
   - Click on "ATT&CK Workbench REST API"
   - Go to **Assignments** tab
   - Click **Assign** → **Assign to People** or **Assign to Groups**
   - Select users/groups and click **Assign**

---

## Next Steps

You've completed the Okta configuration. Now proceed with:

1. **[Configure the REST API](./configuration.md)** - Set up the Workbench REST API to use Okta

   You'll need these values from the steps above:
   - **Issuer URL**: From Step 3 (e.g., `https://dev-12345.okta.com/oauth2/default`)
   - **Client ID**: From Step 3
   - **Client Secret**: From Step 3

2. **[Test & Verify](./testing-verification.md)** - Confirm authentication is working correctly

---

## Troubleshooting

### Okta Issuer URL Format

**Issue**: Discovery fails with Okta.

**Solution**: Verify the issuer URL format is correct for your Okta setup:

- **With authorization server**: `https://<domain>/oauth2/<authServerId>`
- **Default auth server**: `https://<domain>/oauth2/default`
- **Org auth server**: `https://<domain>`

Test the discovery endpoint manually:

```bash
curl https://dev-12345.okta.com/oauth2/default/.well-known/openid-configuration
```

### Okta User Assignment

**Issue**: Error "User is not assigned to the client application" during authentication.

**Solution**: Okta requires explicit user/group assignment to applications:

1. Go to your application in Okta Admin Console
2. Go to **Assignments** tab
3. Assign the user or their group to the application

### Okta Claims Configuration

**Issue**: Missing user information after authentication.

**Solution**: Ensure claims are properly configured in Okta:

1. Go to **Security** → **API** → your authorization server → **Claims** tab
2. Verify claims for `email`, `preferred_username`, and `name` exist
3. Ensure claims are configured to be included in ID Token (not just Access Token)
4. Check that Okta users have email addresses configured in their profiles

### Okta Redirect URI Restrictions

**Issue**: "Invalid redirect URI" error.

**Solution**: Okta requires exact URI matches (no wildcards):

1. In Okta application settings, check "Sign-in redirect URIs"
2. URIs must be exact matches - no wildcard patterns allowed
3. Add each environment's callback URL separately

## Advanced Configuration

### Service Account Authentication

Okta supports Client Credentials flow for service-to-service authentication.

1. **Create a Machine-to-Machine application**:
   - In Okta, create a new app integration
   - Choose **API Services** application type
   - Note the Client ID and Client Secret

2. **Configure in REST API**:

   ```bash
   # In .env file
   SERVICE_ACCOUNT_OIDC_ENABLE=true
   JWKS_URI=https://dev-12345.okta.com/oauth2/default/v1/keys
   ```

3. **Add to JSON config** file:

   ```json
   {
     "serviceAuthn": {
       "oidcClientCredentials": {
         "enable": true,
         "clients": [
           {
             "clientId": "0oa3xb9oz3QLY1avc5d7",
             "serviceRole": "collection-manager"
           }
         ]
       }
     }
   }
   ```

See [sample configuration](../../resources/sample-configurations/collection-manager-oidc-okta.json) for reference.

### Custom Authorization Server

For production deployments, consider creating a custom authorization server:

1. Go to **Security** → **API**
2. Click **Add Authorization Server**
3. Configure your custom authorization server
4. Use the custom server's Issuer URI in your configuration

Benefits:

- Isolated from default server
- Custom claims and scopes
- Better control over token lifetimes
- Separate audience values

### Group-Based Access Control

To restrict access based on Okta groups:

1. **Create groups** in Okta (**Directory** → **Groups**)
2. **Assign users** to groups
3. **Configure application assignment**:
   - Assign groups to your application instead of individual users
4. **Add group claim** to tokens (optional):
   - Go to your authorization server → **Claims**
   - Add a `groups` claim to include group memberships in tokens
5. **Custom logic** in Workbench to read and apply groups (requires code modification)

### Multi-Factor Authentication (MFA)

Okta supports comprehensive MFA options:

1. **Configure Sign-On Policy**:
   - In your application, go to **Sign On** tab
   - Edit or create a sign-on policy
   - Add a rule that requires MFA
2. **No changes needed** in Workbench
3. Users will be prompted for MFA during Okta login

## Additional Resources

- [Okta Developer Documentation](https://developer.okta.com/)
- [Okta OpenID Connect](https://developer.okta.com/docs/concepts/oauth-openid/)
- [ATT&CK Workbench Authentication Documentation](./README.md)
