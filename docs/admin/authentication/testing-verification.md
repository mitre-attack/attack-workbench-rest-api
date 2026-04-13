# Testing & Verification

This guide provides steps to verify your OIDC authentication configuration is working correctly with the ATT&CK Workbench REST API.

## Prerequisites

Before testing, ensure you have:

1. Completed OIDC provider configuration (Authentik, Okta, Keycloak, etc.)
2. Configured the REST API with OIDC settings
3. Restarted the REST API
4. Created at least one user in your OIDC provider

## Verification Steps

### Step 1: Check REST API Logs

When the REST API starts, it should log information about the authentication configuration.

**View logs:**

```bash
# If using Docker Compose
docker compose logs rest-api

# If running directly
# Check your console output or log files
```

### Step 2: Test Configuration Endpoint

The REST API exposes an endpoint that returns the configured authentication mechanism.

**Test the endpoint:**

```bash
curl http://localhost:3000/api/config/authn
```

**Expected response:**

```json
{
  "mechanisms": [{"authnType":"oidc"}]
}
```

**If you see a different response:**

- `{"mechanisms":[{"authnType":"anonymous"}]}` - OIDC is not enabled; check your configuration
- Error or timeout - REST API is not running or not accessible

### Step 3: Test Authentication Flow

Now test the complete authentication flow from the frontend.

1. **Navigate to the Workbench frontend** in your browser:
   - If running locally: <http://localhost:4200>
   - If deployed: Your Workbench URL (e.g., <https://workbench.example.com>)

2. **Click "Log In"** (or navigate to the login page)

3. **Observe the redirect**:
   - You should be automatically redirected to your OIDC provider's login page
   - The URL should match your provider's domain (not the Workbench domain)

4. **Log in with credentials**:
   - Enter the username and password for a user in your OIDC provider
   - Complete any MFA/2FA prompts if configured

5. **Observe the callback**:
   - After successful authentication, you should be redirected back to the Workbench
   - The URL should temporarily show `/api/authn/oidc/callback` before redirecting to the main page

6. **Verify authenticated state**:
   - You should now be logged into the Workbench
   - Your username should appear in the navigation bar
   - You should have access based on your user's role

### Step 4: Test Logout

Test the logout functionality:

1. **Click your username** in the navigation bar
2. **Select "Logout"**
3. **Verify:**
   - You are logged out of the Workbench
   - Attempting to access protected pages redirects you to login
   - Note: You may still be logged into your OIDC provider (single logout varies by provider)

## Common Issues and Solutions

### Issue: "Users authenticated but have no permissions"

**Symptoms:**

- Users can log in successfully
- Users cannot view or edit any content
- Error messages about insufficient permissions

**Cause:** User accounts exist in OIDC provider but not in the Workbench database.

**Solutions:**

1. **Create user accounts in Workbench:**
   - OIDC only handles authentication, not authorization
   - You must create corresponding user accounts in the Workbench database
   - See the [User Management documentation](./README.md#user-management) for details

2. **Verify username matching:**
   - The username in Workbench must match the OIDC claim (usually `preferred_username` or `email`)
   - Check the REST API logs to see what username is being extracted from the OIDC token

## Debugging Tips

### Test with curl

You can test the OIDC endpoints directly:

```bash
# Test the auth initiation endpoint
curl -v http://localhost:3000/api/authn/oidc/login

# This should return a redirect (302) to your OIDC provider
```

## Next Steps

Once authentication is working correctly:

1. **Set up user accounts** - Create users in the Workbench database with appropriate roles
2. **Configure authorization** - Set up role-based access control
3. **Review security settings** - Ensure production-ready security configuration
4. **Set up monitoring** - Monitor authentication failures and session issues

## Additional Resources

- [Authentication Overview](./README.md)
- [REST API Configuration](./configuration.md)
- Provider-specific guides:
  - [Authentik Configuration](./authentik.md)
  - [Okta Configuration](./okta.md)
  - [Keycloak Configuration](./keycloak.md)
