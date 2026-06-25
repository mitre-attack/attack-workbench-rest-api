# Authentik OIDC Configuration Guide

> [!NOTE]
> **This guide is confirmed to be working as of November 10, 2025.**

This guide provides step-by-step instructions for configuring Authentik as the OIDC identity provider for the ATT&CK Workbench REST API.

## Prerequisites

- Authentik server installed and accessible
- Administrator access to Authentik
- ATT&CK Workbench REST API installed

## Overview

This guide focuses on configuring Authentik as your OIDC provider. After completing Authentik setup:

- Proceed to [REST API Configuration](./configuration.md) to configure the Workbench REST API
- Then follow [Testing & Verification](./testing-verification.md) to confirm everything works

This guide covers only the Authentik-specific configuration steps.

---

## Step 1: Create OAuth2/OpenID Provider

1. **Log into Authentik** as an administrator

2. **Navigate to Providers**:
   - Go to **Applications** → **Providers**
   - Click **Create**

3. **Select Provider Type**:
   - Choose **OAuth2/OpenID Provider**

4. **Configure the Provider**:
   - **Name**: `ATT&CK Workbench` (or your preferred name)
   - **Authentication flow**: `default-authentication-flow` (or your custom flow)
   - **Authorization flow**: `default-provider-authorization-explicit-consent` (recommended) or `default-provider-authorization-implicit-consent`
   - **Client type**: `Confidential` (required)
   - **Client ID**: Auto-generated (you'll need this later)
   - **Client Secret**: Auto-generated (you'll need this later)
   - **Redirect URIs/Origins (RegEx)**: Add your callback URL(s):
     - For single environment: `https://workbench.example.com/api/authn/oidc/callback`
     - For multiple environments, add each on a separate line:

       ```text
       http://localhost:3000/api/authn/oidc/callback
       https://workbench.example.com/api/authn/oidc/callback
       ```

   - **Signing Key**: `authentik Self-signed Certificate` (or your custom key)

5. **Advanced Settings** (expand if needed):
   - **Scopes**: Ensure these are included (usually default):
     - `openid`
     - `email`
     - `profile`
   - **Subject mode**: `Based on the User's hashed ID` (default is fine)
   - **Include claims in id_token**: `true` (recommended)

6. **Save** the provider

7. **Note the credentials** (you'll need these for REST API configuration):
   - Go back to the provider you just created
   - Copy the **Client ID**
   - Copy the **Client Secret** (click "Copy" button)

## Step 2: Create Application

1. **Navigate to Applications**:
   - Go to **Applications** → **Applications**
   - Click **Create**

2. **Configure the Application**:
   - **Name**: `ATT&CK Workbench`
   - **Slug**: `attack-workbench` (or your preference)
   - **Provider**: Select the provider you created in Step 1
   - **Policy engine mode**: `any` (or configure based on your needs)
   - **UI settings** (optional): Add icon, description, launch URL

3. **Save** the application

## Step 3: Note the Issuer URL

The issuer URL format for Authentik is:

```text
https://<your-authentik-domain>/application/o/<application-slug>/
```

For example:

- If your Authentik is at: `https://authentik.example.com`
- And your application slug is: `attack-workbench`
- Then your issuer URL is: `https://authentik.example.com/application/o/attack-workbench/`

**Note the trailing slash** - it's required!

**Save this issuer URL** - you'll need it for REST API configuration.

---

## Next Steps

You've completed the Authentik configuration. Now proceed with:

1. **[Configure the REST API](./configuration.md)** - Set up the Workbench REST API to use Authentik

   You'll need these values from the steps above:
   - **Issuer URL**: `https://<your-authentik-domain>/application/o/<application-slug>/` (from Step 3)
   - **Client ID**: From Step 1
   - **Client Secret**: From Step 1

2. **[Test & Verify](./testing-verification.md)** - Confirm authentication is working correctly

---

## Troubleshooting

### Authentik Issuer URL Format

**Issue**: Discovery fails with Authentik.

**Solution**: Verify the issuer URL format is correct:

```text
https://<your-authentik-domain>/application/o/<application-slug>/
```

**Important notes:**

- The trailing slash is **required**
- The application slug must match exactly (case-sensitive)
- Verify by accessing: `https://<issuer-url>/.well-known/openid-configuration`

### Authentik Scope Configuration

**Issue**: Missing user information after authentication.

**Solution**: In Authentik provider settings, ensure:

- **Scopes** include: `openid`, `email`, `profile`
- "Include claims in id_token" is enabled in Advanced Settings
- Users have email addresses configured in Authentik

## Advanced Configuration

### Custom User Attributes

Authentik supports custom user attributes. To use them with Workbench:

1. Create a custom property mapping in Authentik
2. Add it to your provider's scope mappings
3. The claims will be available in the OIDC token

### MFA / 2FA

Authentik supports Multi-Factor Authentication:

1. Configure MFA in Authentik authentication flow
2. No changes needed in Workbench REST API
3. Users will be prompted for MFA during Authentik login

### Single Logout

Currently, logging out of Workbench only logs the user out of the REST API session, not from Authentik. Users remain logged into Authentik and can re-authenticate without entering credentials.

To implement full logout, you would need to:

1. Redirect to Authentik's end session endpoint after logout
2. This requires custom frontend modifications

## Additional Resources

- [Authentik Documentation](https://docs.goauthentik.io/)
- [ATT&CK Workbench Authentication Documentation](./README.md)
