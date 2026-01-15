'use strict';

const convict = require('convict');
const crypto = require('crypto');
const packageJson = require('../../package.json');

// Generate the default session secret
// This runs synchronously, but only once at startup
// Using the default session secret will limit the session cookies to one run of the server
//   - Restarting the server will force the users to login again
//   - Sessions cannot be shared across server instances
// Setting the SESSION_SECRET environment variable will override this generated value
function generateSecret() {
  const stringBase = 'base64';
  const byteLength = 48;
  const buffer = crypto.randomBytes(byteLength);
  const secret = buffer.toString(stringBase);

  return secret;
}

const defaultSessionSecret = generateSecret();
const defaultTokenSigningSecret = generateSecret();

const userAuthnMechanismValues = ['anonymous', 'oidc'];
convict.addFormat(enumFormat('user-authn-mechanism', userAuthnMechanismValues, true));

const serviceRoleValues = ['read-only', 'collection-manager', 'stix-export'];
convict.addFormat(enumFormat('service-role', serviceRoleValues, true));

// Creates a new convict format for a list of enumerated values
function enumFormat(name, values, coerceLower) {
  return {
    name,
    validate: function (val) {
      if (!values.includes(val)) {
        throw new Error(`Invalid ${name} value`);
      }
    },
    coerce: function (val) {
      if (coerceLower) {
        return val.toLowerCase();
      } else {
        return val;
      }
    },
  };
}

function arrayFormat(name) {
  return {
    name,
    validate: function (entries, schema) {
      if (!Array.isArray(entries)) {
        throw new Error('Property must be of type Array');
      }

      for (const entry of entries) {
        convict(schema.children).load(entry).validate();
      }
    },
  };
}
convict.addFormat(arrayFormat('oidc-client'));
convict.addFormat(arrayFormat('service-account'));

/**
 * Validates an array of strings representing domains or FQDNs.
 * Allows the wildcard character `*` to indicate all origins.
 * Supports the value `disable` to explicitly disable CORS.
 * Allows localhost and local network IPs for development environments.
 *
 * A valid origin must be one of:
 * - Special values: '*' or 'disable'
 * - localhost (with optional port)
 * - Local network IP (with optional port)
 * - Valid FQDN (with optional port) that:
 *   - Contains only alphanumeric characters, hyphens, and dots
 *   - Has at least one dot separating the domain levels
 *   - Ends with a valid top-level domain (e.g., `.com`, `.org`)
 *
 * @param {string[]} values - Array of origins to validate
 * @throws {Error} If any origin in the list is invalid
 */
convict.addFormat({
  name: 'domains',
  validate: function (val) {
    const values = Array.isArray(val) ? val : val.split(',').map((v) => v.trim());

    // Handle special cases
    if (values.length === 1 && (values[0] === '*' || values[0] === 'disable')) {
      return;
    }

    const patterns = {
      // Matches standard hostnames per RFC 952/1123
      hostname:
        /^(?:https?:\/\/)?([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}(?::\d{1,5})?$/,

      // Matches 'localhost'
      localhost: /^(?:https?:\/\/)?localhost(?::\d{1,5})?$/,

      // Matches private network IPv4 addresses
      privateIPv4:
        /^(?:https?:\/\/)?((?:127\.|10\.|172\.(?:1[6-9]|2[0-9]|3[0-1])|192\.168\.)[0-9.]+)(?::\d{1,5})?$/,

      // IPv6 localhost
      ipv6: /^(?:https?:\/\/)?\[::1\](?::\d{1,5})?$/,
    };

    for (const origin of values) {
      if (!origin) {
        throw new Error('Empty domain is not allowed');
      }

      // Check localhost and IPv6 first
      if (patterns.localhost.test(origin) || patterns.ipv6.test(origin)) {
        continue;
      }

      // Then check private network IPs
      if (patterns.privateIPv4.test(origin)) {
        const octets = origin.split('.').map(Number);
        if (octets.some((octet) => octet > 255)) {
          throw new Error('Invalid IP address format');
        }
        continue;
      }

      // Finally check hostname
      if (!patterns.hostname.test(origin)) {
        throw new Error('Invalid domain format');
      }
    }
  },
  coerce: function (value) {
    if (Array.isArray(value)) {
      return value;
    }
    return value.split(',').map((v) => v.trim());
  },
});

function loadConfig() {
  const config = convict({
    server: {
      port: {
        doc: 'Port the HTTP server should listen on',
        format: 'int',
        default: 3000,
        env: 'PORT',
      },
      corsAllowedOrigins: {
        doc: 'Comma-separated list of origins allowed to access the REST API endpoints. Use * to allow any origin.',
        format: 'domains',
        default: '*',
        env: 'CORS_ALLOWED_ORIGINS',
      },
    },
    app: {
      name: {
        default: 'attack-workbench-rest-api',
      },
      env: {
        default: 'development',
        env: 'NODE_ENV',
      },
      version: {
        default: packageJson.version,
      },
      attackSpecVersion: {
        default: packageJson.attackSpecVersion,
      },
    },
    database: {
      url: {
        doc: 'URL of the MongoDB server',
        default: '',
        env: 'DATABASE_URL',
      },
      migration: {
        enable: {
          doc: 'Enable automatic database migration when starting the server',
          format: Boolean,
          default: true,
          env: 'WB_REST_DATABASE_MIGRATION_ENABLE',
        },
      },
    },
    logging: {
      logLevel: {
        doc: 'Level of logging messages to write to console (error, warn, http, info, verbose, debug)',
        default: 'info',
        env: 'LOG_LEVEL',
      },
    },
    openApi: {
      specPath: {
        default: './app/api/definitions/openapi.yml',
      },
    },
    validateRequests: {
      withAttackDataModel: {
        doc: 'Enable validation of POST and PUT request bodies using the ATT&CK Data Model',
        format: Boolean,
        default: false,
        env: 'VALIDATE_WITH_ADM_SCHEMAS',
      },
      withOpenApi: {
        doc: 'Enable validation of POST and PUT request bodies using the legacy OpenAPI YAML-based validation schemas',
        format: Boolean,
        default: true,
        env: 'VALIDATE_WITH_LEGACY_SCHEMAS',
      },
    },
    collectionIndex: {
      defaultInterval: {
        doc: 'How often collection indexes should check for updates (in seconds). Only applies to new indexes added to the REST API, does not affect existing collection indexes',
        default: 300,
        env: 'DEFAULT_INTERVAL',
      },
    },
    configurationFiles: {
      allowedValues: {
        doc: 'Location of the allowed values configuration file',
        default: './app/config/allowed-values.json',
        env: 'ALLOWED_VALUES_PATH',
      },
      jsonConfigFile: {
        doc: 'Location of a JSON file containing configuration values',
        default: '',
        env: 'JSON_CONFIG_PATH',
      },
      staticMarkingDefinitionsPath: {
        doc: 'Location of a directory containing one or more JSON files with the static marking definitions to load into the system',
        default: './app/lib/default-static-marking-definitions/',
        env: 'WB_REST_STATIC_MARKING_DEFS_PATH',
      },
    },
    scheduler: {
      syncCollectionIndexesCron: {
        doc: 'Sets the interval in seconds for starting the scheduler.',
        default: '* * * * *', // every minute
        env: 'SYNC_COLLECTION_INDEXES_CRON',
      },
      checkWipAttackIdsCron: {
        doc: 'Cron pattern for checking WIP objects with ATT&CK IDs (e.g., "0 * * * *" for hourly).',
        default: '0 * * * *', // every hour
        env: 'CHECK_WIP_ATTACK_IDS_CRON',
      },
      enableScheduler: {
        format: Boolean,
        default: true,
        env: 'ENABLE_SCHEDULER',
      },
    },
    session: {
      secret: {
        doc: 'Secret used to sign the session ID cookie',
        default: defaultSessionSecret,
        env: 'SESSION_SECRET',
      },
    },
    userAuthn: {
      mechanism: {
        doc: 'Authentication mechanism to use for user log in',
        format: 'user-authn-mechanism',
        default: 'anonymous',
        env: 'AUTHN_MECHANISM',
      },
      oidc: {
        issuerUrl: {
          doc: 'OIDC Issuer URL',
          format: String,
          default: '',
          env: 'AUTHN_OIDC_ISSUER_URL',
        },
        clientId: {
          doc: 'OIDC Client ID',
          format: String,
          default: '',
          env: 'AUTHN_OIDC_CLIENT_ID',
        },
        clientSecret: {
          doc: 'OIDC Client Secret',
          format: String,
          default: '',
          env: 'AUTHN_OIDC_CLIENT_SECRET',
        },
        redirectOrigin: {
          doc: 'Origin (protocol and host) to use in building the OIDC redirect URI',
          format: String,
          default: 'http://localhost:3000',
          env: 'AUTHN_OIDC_REDIRECT_ORIGIN',
        },
      },
    },
    serviceAuthn: {
      oidcClientCredentials: {
        enable: {
          doc: 'Enable OIDC Client Credentials Flow for service accounts',
          format: Boolean,
          default: false,
          env: 'SERVICE_ACCOUNT_OIDC_ENABLE',
        },
        jwksUri: {
          doc: 'JWKS URI for obtaining the public key from the OIDC identity provider',
          format: String,
          default: '',
          env: 'JWKS_URI',
        },
        clients: {
          doc: 'Services (OIDC clients) that may access the REST API',
          format: 'oidc-client',
          default: [],
          children: {
            clientId: {
              doc: 'clientId for the service',
              format: String,
              default: null,
            },
            serviceRole: {
              doc: 'The role determines which endpoints the service is permitted to access',
              format: 'service-role',
              default: 'read-only',
            },
          },
        },
      },
      challengeApikey: {
        enable: {
          doc: 'Enable apikey authentication for service accounts (challenge)',
          format: Boolean,
          default: false,
          env: 'WB_REST_SERVICE_ACCOUNT_CHALLENGE_APIKEY_ENABLE',
        },
        secret: {
          doc: 'Secret used to sign the tokens issued to service accounts',
          default: defaultTokenSigningSecret,
          env: 'WB_REST_TOKEN_SIGNING_SECRET',
        },
        tokenTimeout: {
          doc: 'Access token timeout in seconds',
          format: 'int',
          default: 300,
          env: 'WB_REST_TOKEN_TIMEOUT',
        },
        serviceAccounts: {
          doc: 'Services accounts that may access the REST API (with challenge)',
          format: 'service-account',
          default: [],
          children: {
            name: {
              doc: 'Name of the service account',
              format: String,
              default: null,
            },
            apikey: {
              doc: 'apikey of the service account (shared secret)',
              format: String,
              default: null,
            },
            serviceRole: {
              doc: 'The role determines which endpoints the service is permitted to access',
              format: 'service-role',
              default: 'read-only',
            },
          },
        },
      },
      basicApikey: {
        enable: {
          doc: 'Enable apikey authentication for service accounts (no challenge)',
          format: Boolean,
          default: false,
          env: 'WB_REST_SERVICE_ACCOUNT_BASIC_APIKEY_ENABLE',
        },
        serviceAccounts: {
          doc: 'Services accounts that may access the REST API using basic apikey',
          format: 'service-account',
          default: [],
          children: {
            name: {
              doc: 'Name of the service account',
              format: String,
              default: null,
            },
            apikey: {
              doc: 'apikey of the service account (shared secret)',
              format: String,
              default: null,
            },
            serviceRole: {
              doc: 'The role determines which endpoints the service is permitted to access',
              format: 'service-role',
              default: 'read-only',
            },
          },
        },
      },
    },
    attackSourceNames: {
      doc: 'Valid source_name values used in MITRE ATT&CK external_references',
      default: ['mitre-attack', 'mitre-mobile-attack', 'mobile-attack', 'mitre-ics-attack'],
    },
    domainToKillChainMap: {
      doc: 'Map the built-in domain names to the corresponding kill-chain-phase names',
      default: {
        'enterprise-attack': 'mitre-attack',
        'mobile-attack': 'mitre-mobile-attack',
        'ics-attack': 'mitre-ics-attack',
      },
    },
  });

  // Load configuration values from a JSON file if the JSON_CONFIG_PATH environment variable is set
  if (config.get('configurationFiles.jsonConfigFile')) {
    config.loadFile(config.get('configurationFiles.jsonConfigFile'));
  }

  config.validate({ allowed: 'strict' });

  return config.getProperties();
}

// Load the configuration and extract the configuration properties to simplify access
const configurationObject = loadConfig();

// Add a function to reload the configuration properties
configurationObject.reloadConfig = function () {
  const newConfigProperties = loadConfig();
  Object.assign(configurationObject, newConfigProperties);
};

module.exports = configurationObject;
