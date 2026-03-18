// Tell config to read from a config file
process.env.JSON_CONFIG_PATH = './app/tests/config/test-config.json';

const { expect } = require('expect');

const config = require('../../config/config');
const markingDefinitionsService = require('../../services/stix/marking-definitions-service');
const database = require('../../lib/database-in-memory');
const databaseConfiguration = require('../../lib/database-configuration');

describe('App Configuration', function () {
  before(async function () {
    // Establish the database connection
    // Use an in-memory database that we spin up for the test
    await database.initializeConnection();

    // Check for a valid database configuration
    await databaseConfiguration.checkSystemConfiguration();
  });

  it('The config values should be set by the config file', function (done) {
    // Defaults, not set by config file
    expect(config.app.env).toBe('development');
    expect(config.server.port).toBe(3000);

    // Set by config file
    expect(config.app.name).toBe('test-config');
    expect(config.collectionIndex.defaultInterval).toBe(100);
    expect(config.configurationFiles.staticMarkingDefinitionsPath).toBe(
      './app/tests/config/test-static-marking-definitions',
    );

    done();
  });

  describe('CORS Configuration', function () {
    it('should accept wildcard origin', function () {
      expect(() => config.reloadConfig()).not.toThrow();
      expect(config.server.corsAllowedOrigins).toStrictEqual(['*']);
    });

    it('should accept disable option', function () {
      process.env.CORS_ALLOWED_ORIGINS = 'disable';
      expect(() => config.reloadConfig()).not.toThrow();
      expect(config.server.corsAllowedOrigins).toStrictEqual(['disable']);
      delete process.env.CORS_ALLOWED_ORIGINS;
    });

    it('should accept valid single domain', function () {
      process.env.CORS_ALLOWED_ORIGINS = 'example.com';
      expect(() => config.reloadConfig()).not.toThrow();
      expect(config.server.corsAllowedOrigins).toEqual(['example.com']);
      delete process.env.CORS_ALLOWED_ORIGINS;
    });

    it('should accept valid multiple domains', function () {
      process.env.CORS_ALLOWED_ORIGINS = 'example.com,api.example.com,sub.example.co.uk';
      expect(() => config.reloadConfig()).not.toThrow();
      expect(config.server.corsAllowedOrigins).toEqual([
        'example.com',
        'api.example.com',
        'sub.example.co.uk',
      ]);
      delete process.env.CORS_ALLOWED_ORIGINS;
    });

    it('should accept domains with http or https protocol', function () {
      for (const validOrigin of ['http://example.com', 'https://example.com']) {
        process.env.CORS_ALLOWED_ORIGINS = validOrigin;
        expect(() => config.reloadConfig()).not.toThrow();
        delete process.env.CORS_ALLOWED_ORIGINS;
      }
    });

    it('should reject domains with erroneous protocol', function () {
      for (const invalidOrigin of [
        'ftp://example.com',
        'ssh://example.com',
        'foobar://example.com',
      ]) {
        process.env.CORS_ALLOWED_ORIGINS = invalidOrigin;
        expect(() => config.reloadConfig()).toThrow();
        delete process.env.CORS_ALLOWED_ORIGINS;
      }
    });

    it('should reject domains with underscores', function () {
      process.env.CORS_ALLOWED_ORIGINS = 'invalid_domain.com';
      expect(() => config.reloadConfig()).toThrow('Invalid domain format');
      delete process.env.CORS_ALLOWED_ORIGINS;
    });

    it('should reject non-localhost domains without TLD', function () {
      process.env.CORS_ALLOWED_ORIGINS = 'myserver';
      expect(() => config.reloadConfig()).toThrow('Invalid domain format');
      delete process.env.CORS_ALLOWED_ORIGINS;
    });

    it('should reject empty domains in list', function () {
      process.env.CORS_ALLOWED_ORIGINS = 'example.com,,other.com';
      expect(() => config.reloadConfig()).toThrow('Empty domain is not allowed');
      delete process.env.CORS_ALLOWED_ORIGINS;
    });

    it('should handle domains with multiple subdomains', function () {
      process.env.CORS_ALLOWED_ORIGINS = 'a.b.c.example.com';
      expect(() => config.reloadConfig()).not.toThrow();
      expect(config.server.corsAllowedOrigins).toEqual(['a.b.c.example.com']);
      delete process.env.CORS_ALLOWED_ORIGINS;
    });

    it('should reject domains with invalid characters', function () {
      process.env.CORS_ALLOWED_ORIGINS = 'example%.com';
      expect(() => config.reloadConfig()).toThrow('Invalid domain format');
      delete process.env.CORS_ALLOWED_ORIGINS;
    });

    it('should handle domains with hyphens correctly', function () {
      const validDomains = ['my-domain.com', 'sub.my-domain.com', 'my-domain-name.org'].join(',');
      process.env.CORS_ALLOWED_ORIGINS = validDomains;
      expect(() => config.reloadConfig()).not.toThrow();
      expect(config.server.corsAllowedOrigins).toEqual(validDomains.split(','));
      delete process.env.CORS_ALLOWED_ORIGINS;
    });

    it('should reject domains with leading/trailing hyphens', function () {
      const invalidDomains = ['-example.com', 'example-.com', 'sub.-example.com'];

      for (const domain of invalidDomains) {
        process.env.CORS_ALLOWED_ORIGINS = domain;
        expect(() => config.reloadConfig()).toThrow('Invalid domain format');
      }
      delete process.env.CORS_ALLOWED_ORIGINS;
    });

    // Development Environment Support
    it('should accept localhost', function () {
      process.env.CORS_ALLOWED_ORIGINS = 'localhost';
      expect(() => config.reloadConfig()).not.toThrow();
      expect(config.server.corsAllowedOrigins).toEqual(['localhost']);
      delete process.env.CORS_ALLOWED_ORIGINS;
    });

    it('should accept local network IPs', function () {
      const validIPs = ['172.17.0.1', '192.168.1.100', '10.0.0.1'].join(',');

      process.env.CORS_ALLOWED_ORIGINS = validIPs;
      expect(() => config.reloadConfig()).not.toThrow();
      expect(config.server.corsAllowedOrigins).toEqual(validIPs.split(','));
      delete process.env.CORS_ALLOWED_ORIGINS;
    });

    it('should accept IPv6 localhost', function () {
      process.env.CORS_ALLOWED_ORIGINS = '[::1]';
      expect(() => config.reloadConfig()).not.toThrow();
      expect(config.server.corsAllowedOrigins).toEqual(['[::1]']);
      delete process.env.CORS_ALLOWED_ORIGINS;
    });

    it('should reject invalid IP addresses', function () {
      const invalidIPs = ['256.256.256.256', '172.300.0.1', '172.32.0.1', '172.15.0.1'];

      for (const ip of invalidIPs) {
        process.env.CORS_ALLOWED_ORIGINS = ip;
        expect(() => config.reloadConfig()).toThrow(/Invalid (IP address format|domain format)/);
      }
      delete process.env.CORS_ALLOWED_ORIGINS;
    });

    // Mixed Environments
    it('should accept mix of localhost and domains', function () {
      process.env.CORS_ALLOWED_ORIGINS = 'localhost,api.example.com';
      expect(() => config.reloadConfig()).not.toThrow();
      expect(config.server.corsAllowedOrigins).toEqual(['localhost', 'api.example.com']);
      delete process.env.CORS_ALLOWED_ORIGINS;
    });

    it('should accept mix of IPs and domains', function () {
      process.env.CORS_ALLOWED_ORIGINS = '192.168.1.100,api.example.com';
      expect(() => config.reloadConfig()).not.toThrow();
      expect(config.server.corsAllowedOrigins).toEqual(['192.168.1.100', 'api.example.com']);
      delete process.env.CORS_ALLOWED_ORIGINS;
    });
  });

  it('The static marking definitions should be created', async function () {
    const options = {};
    const markingDefinitions = await markingDefinitionsService.retrieveAll(options);
    // We expect to get two marking definitions
    expect(markingDefinitions).toBeDefined();
    expect(Array.isArray(markingDefinitions)).toBe(true);
    expect(markingDefinitions.length).toBe(2);
  });

  after(async function () {
    await database.closeConnection();
  });
});
