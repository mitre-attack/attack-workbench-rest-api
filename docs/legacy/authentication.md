# Authentication

This document describes the authentication design for the ATT&CK Workbench REST API.
Please refer to [doc ref goes here] for instructions on configuring authentication, and [doc ref goes here] for instructions on managing users.

The ATT&CK Workbench REST API can be configured to use one of the implemented user authentication mechanisms.
The currently implemented user authentication mechanisms are:

- Anonymous
- OpenID Connect (OIDC)

The default authentication mechanism is _anonymous_.
This simplifies deployment of the application for users who are running the ATT&CK Workbench locally.
However, anonymous authentication does not provide attribution of changes to individual users and is not recommended for enterprise deployments.

The REST API also implements an API key authentication mechanism to support access by the ATT&CK Workbench Collection Manager and other services.

The REST API uses the passport module for authentication which will facilitate the addition of other authentication mechanisms in the future.

## User Authentication

### User Authentication Endpoints

#### General Endpoints

##### Get Config

```
GET /api/config/authn
```

Retrieves information describing the available user authentication mechanisms.
This is intended to be used by the client to determine which authentication mechanisms are available to be used and does not require the user to be logged in.

Authentication Config Object:

| Property       | Type       | Description                                                                     |
| -------------- | ---------- | ------------------------------------------------------------------------------- |
| **mechanisms** | [ string ] | Configured user authentication mechanisms (allowed values: `oidc`, `anonymous`) |

Note: The current release of the ATT&CK Workbench REST API only allows one user authentication mechanism to be configured at a time.
Multiple simultaneous mechanisms may be supported in a future release.

##### Get Session

```
GET /api/session
```

Retrieves the current user session object for a logged in user. If the user is not logged in returns `401 Not authorized`.

User Session Object:

| Property          | Type    | Description                                     |
| ----------------- | ------- | ----------------------------------------------- |
| **strategy**      | string  | authentication strategy used                    |
| **userAccountId** | string  | STIX identity assigned to this user             |
| **email**         | string  | email address                                   |
| **status**        | string  | allowed values: `pending`, `active`, `inactive` |
| **role**          | string  | allowed values: `visitor`, `editor`, `admin`    |
| **displayName**   | string  | full name of the user                           |
| **name**          | object  | username in the authentication system           |
| **registered**    | boolean | has the user been added to the database?        |

A user who is in the process of registering and has logged in but has not been added to the database

#### Anonymous Endpoints

Anonymous authentication is primarily intended to be used when the ATT&CK Workbench is deployed on a machine for local use by a single user.
It does not provide any authentication or authorization of access to the system, and does not provide attribution of changes to individual users.

##### Log In

```
GET /api/authn/anonymous/login
```

Logs the user into the REST API. Does not require credentials.

##### Log Out

```
GET /api/authn/anonymous/logout
```

Logs the user out of the REST API.

#### OpenID Connect Endpoints

OIDC authentication is intended for use in an organizational setting and can be tied into the organization's single-sign on configuration.

##### Configuring OIDC for Multiple Environments

When deploying multiple instances of the REST API (e.g., local development, staging, and production), each instance requires its own `AUTHN_OIDC_REDIRECT_ORIGIN` configured to match the URL where that instance is accessible.

For example:

- **Local instance**: `AUTHN_OIDC_REDIRECT_ORIGIN=http://localhost:3000`
- **Production instance**: `AUTHN_OIDC_REDIRECT_ORIGIN=https://workbench.example.com`

All instances can share the same OIDC Client ID and Client Secret, but you must configure **all redirect URIs** in your OIDC Identity Provider:

- `http://localhost:3000/api/authn/oidc/callback`
- `https://workbench.example.com/api/authn/oidc/callback`

**Example with Authentik:**

1. In Authentik, navigate to **Applications** → **Providers** → your provider
2. Edit the **Redirect URIs/Origins** field
3. Add each environment's callback URI on a separate line

This allows the same OIDC provider configuration to work with multiple deployed instances.

##### Log In

```
GET /api/authn/oidc/login?destination=<url>
```

Initiates the OIDC login sequence.

⚠️ Sending a request to this endpoint will result in a redirect to the OIDC Identity Provider.
Therefore, the call to this endpoint must be a standard HTTP request (not an XHR type request).

The `destination` query string parameter provides a URL that the client will be redirected to after a successful login.

##### OIDC Callback

```
GET /api/authn/oidc/callback
```

This endpoint handles the redirect from the OIDC Identity Provider after the user authenticates with that server.
The full URL of this endpoint on the deployed server is part of the OIDC Identity Provider configuration.

This endpoint will respond with a redirect to the `destination` provided in the initial log in request.
In most cases this will be the start page of the client application which should verify the login by requesting the current user session object.

##### Log Out

```
GET /api/authn/oidc/logout
```

Logs the user out of the REST API. Note that this only logs the user out of the ATT&CK Workbench REST API.
It does not log the user out of the OIDC Identity Provider.

### User Authentication Workflow

1. The client starts by calling `GET /api/session`

   - If logged in, will receive the user session object
   - If not logged in, will receive 401 Not Authorized

2. To log in, the client will first call `GET /api/config/authn` to get the authentication config object

3. After getting the authentication config object

   - If the supported authentication is anonymous, call `GET /api/authn/anonymous/login`
   - If the supported authentication is oidc, navigate to `GET /api/authn/oidc/login`

4. After logging in, call `GET /api/session` to get the user session object

![User Authentication Sequence](images/user-authentication-sequence.png)

![Anonymoust Login Sequence](images/anonymous-login-sequence.png)

![OIDC Login Sequence](images/oidc-login-sequence.png)

### Authenticating REST API Calls

A successful log in will result in the creation of a persistent login session on the server.
The user's browser will receive a session cookie with the generated login Session ID.
This cookie must be provided on all REST API calls in order to authenticate the user.
This will generally be handled automatically by the browser.

## Service Authentication

The REST API supports three methods of authenticating services: API Key Challenge Authentication, API Key Basic Authentication, and OIDC Client Credentials Flow.
Both API key challenge authentication and OIDC Client Credentials Flow enable the service to provide an access token in requests in order to access resources, but differ in how the access token is obtained.

### API Key Challenge Authentication

API Key Challenge authentication works by configuring both the REST API and the service with a secret value (API key) that is used to authenticate the service to the REST API.

Note: Rather than allow a service to use its API key directly in requests to the REST API, with this method a service is required to use the api key to obtain an access token in the form of a JSON Web Token (JWT).
The JWT must then be provided in subsequent requests.
The use of a JWT allows for a login session to expire, forcing the service to periodically obtain a new token.

The service obtains the access token through a challenge-response protocol:

1. The service starts by sending a request to the REST API challenge endpoint. It will receive a nonce (a base-64 encoded string generated using the Node crypto module) in the response.
2. The service must then create a SHA256 hash of the nonce using its configured API key.
3. The service then sends the hash to the REST API token endpoint. It will receive a JWT in the response.
4. The service must include the JWT in requests when accessing resource endpoints.

#### Request Challenge Endpoint

```
GET /api/authn/service/apikey-challenge?serviceName=MyServiceName
```

Requests a challenge string from the REST API. The request must include the service name as a query parameter.
The response will include the challenge that can be used when requesting an access token.

Sample response:

```json
{
  "challenge": "PH2ev0gz+DEUVMbB9d8jT8uowru5Qp495yAHqASi1axVxywVZ4/GxTnuPlpfayJ+"
}
```

#### Request Token endpoint

```
GET /api/authn/service/apikey-token?serviceName=MyServiceName
Authorization: Apikey 1092d306081afd94d405b15887312373066bc96c222b04a03cfef436a0b0ecaa
```

Requests the access token (JWT) that the service will use to authenticate with the REST API when making requests for resources.
The request must include the service name as a query parameter and a hash of the challenge in the `Authorization` header using the `Apikey` authentication scheme.
The hash must be a SHA256 hash of the challenge using the shared api key value.
The response will include the JWT.

Sample response:

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZXJ2aWNlTmFtZSI6ImFwaWtleS10ZXN0LXNlcnZpY2UiLCJleHAiOjE2Mzk2MDQ5NDEsImlhdCI6MTYzOTYwNDY0MX0.QHPTHMzceeONvMdPpr2h6tCBwrpkpGydOV6i0DUhNMw"
}
```

### API Key Basic Authentication

API Key Basic authentication works by configuring both the REST API and the service with a secret value (API key) that is used to authenticate the service to the REST API.
This value, along with the configured service name, must be provided with each request in the form of a HTTP Basic Authorization header.
The service name and API key are used as the userid and password.

This method is more vulnerable than other methods but is simpler to implement in a client service. If this method is used, the following configuration steps are recommended:

- Because the API key is passed in each request, the server should be configured with HTTPS.
- Services that are configured to use this method should be configured with a role that allows access to a limited set of endpoints.

### OIDC Client Credentials Flow Authentication

As an alternative to the API key authentication method, the REST API supports authenticating using the OIDC Client Credentials Flow.
This method has the advantage of not needing to maintain a shared secret in both the REST API and the service.
Instead, the service must be configured as a client with the OIDC Identity Provider and have Client Credentials Flow enabled.
When running, the service must obtain an access token from the OIDC Identity Provider using `grant_type=client_credentials`.
The token must be in the form of a JWT.
Once the service obtains the access token, it must be included in all requests to the REST API to access resources.
The method of obtaining the token is dependent on the OIDC vendor, but generally requires calling an OIDC Identity Provider endpoint with the service's `clientId` and `clientSecret`.

Note that this authentication method requires that the REST API is also configured as a client with the OIDC Identity Provider and that the two clients are linked appropriately.
The method of linking the two clients is vendor specific. For example, using the Keycloak OIDC server, both clients must be in the same realm.
This may differ for other vendors.

### Authenticating REST API Calls

#### API Key Challenge and OIDC Client Credentials Flow Authentication

When using the API Key Challenge or OIDC Client Credentials Flow authentication method, the access token (JWT) must be provided on all REST API calls in order to authenticate the service.
The JWT must be provided using the `Authorization` header with the `Bearer` authentication scheme:

Sample request

```
GET /api/techniques
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZXJ2aWNlTmFtZSI6ImFwaWtleS10ZXN0LXNlcnZpY2UiLCJleHAiOjE2Mzk2MDQ5NDEsImlhdCI6MTYzOTYwNDY0MX0.QHPTHMzceeONvMdPpr2h6tCBwrpkpGydOV6i0DUhNMw
```

#### API Key Basic Authentication

When using the API Key Basic authentication method, the API Key must be provided on all REST API calls in order to authenticate the service.
The API Key must be provided using the `Authorization` header with the `Basic` authentication scheme. The service name and API key must be base-64 encoded.

Sample request

```
GET /api/stix-bundles?domain=mobile-attack
Authorization: Basic YXBpa2V5LXRlc3Qtc2VydmljZTp4eXp6eQ==
```
