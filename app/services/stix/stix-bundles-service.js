'use strict';

const uuid = require('uuid');
const config = require('../../config/config');
const { BaseService } = require('../meta-classes');
const linkById = require('../../lib/linkById');
const logger = require('../../lib/logger');
const { requiresAttackId } = require('../../lib/attack-id-generator');

// Import repositories
const analyticsRepository = require('../../repository/analytics-repository');
const attackObjectsRepository = require('../../repository/attack-objects-repository');
const matrixRepository = require('../../repository/matrix-repository');
const mitigationsRepository = require('../../repository/mitigations-repository');
const notesRepository = require('../../repository/notes-repository');
const relationshipsRepository = require('../../repository/relationships-repository');
const softwareRepository = require('../../repository/software-repository');
const tacticsRepository = require('../../repository/tactics-repository');
const techniquesRepository = require('../../repository/techniques-repository');
const dataComponentsRepository = require('../../repository/data-components-repository');
const dataSourcesRepository = require('../../repository/data-sources-repository');
const detectionStrategiesRepository = require('../../repository/detection-strategies-repository');

// Import services
const notesService = require('../system/notes-service');

/**
 * Service for generating STIX bundles from the ATT&CK database.
 *
 * CORE CONCEPTS (New ATT&CK Specification):
 *
 * This service makes an important distinction between "primary" and "secondary" objects
 * when generating STIX bundles:
 *
 * PRIMARY OBJECTS:
 * - Objects that directly belong to the requested domain (e.g., enterprise-attack, mobile-attack)
 * - Users can explicitly set/modify the x_mitre_domains field for these objects
 * - These are retrieved in the initial database query by domain
 * - Examples for enterprise-attack domain:
 *   * Techniques (attack-pattern) like "Process Injection"
 *   * Tactics (x-mitre-tactic) like "Persistence"
 *   * Mitigations (course-of-action) specific to enterprise
 *   * Software/Tools (malware/tool) used in enterprise attacks
 *   * Data Components (x-mitre-data-component) - NEW in current spec
 *   * Data Sources (x-mitre-data-source) - deprecated but still primary
 *   * Analytics (x-mitre-analytic) - NEW in current spec
 *
 * SECONDARY OBJECTS:
 * - Objects that are related to primary objects through relationships or references
 * - Cannot be directly assigned to domains by users
 * - Their domain membership is inferred from relationships to primary objects
 * - Need to be validated before inclusion in the bundle
 * - Examples:
 *   * Threat Groups (intrusion-set) that use techniques in the domain
 *   * Campaigns that deploy malware in the domain
 *   * Detection Strategies (x-mitre-detection-strategy) - NEW in current spec
 *     - Included if they detect a technique in the bundle, OR
 *     - Included if they reference an analytic (via x_mitre_analytic_refs) in the bundle
 *
 * EXAMPLE SCENARIO:
 * When requesting enterprise-attack domain bundle:
 * 1. Primary Objects (from initial query):
 *    - Technique T1055 "Process Injection"
 *    - Analytic ANA-001 "Process Injection Detection"
 *    - Data Component DC-001 "Process Creation"
 *
 * 2. Relationships and references discovered:
 *    - Group G0096 uses Technique T1055 (relationship)
 *    - Detection Strategy DS-001 detects Technique T1055 (relationship)
 *    - Detection Strategy DS-002 references Analytic ANA-001 (via x_mitre_analytic_refs)
 *
 * 3. Secondary Objects (need validation and domain inference):
 *    - Group G0096
 *    - Detection Strategy DS-001
 *    - Detection Strategy DS-002
 *
 * The complex relationship processing in this service handles:
 * 1. Primary → Primary relationships (simplest case)
 * 2. Primary → Secondary relationships (need to fetch/validate secondary)
 * 3. Secondary → Primary relationships (need to fetch/validate secondary)
 * 4. Special cases:
 *    - 'detects' relationships (for detection strategies)
 *    - 'attributed-to' relationships (for groups/campaigns)
 *    - x_mitre_analytic_refs (for detection strategies referencing analytics)
 */
class StixBundlesService extends BaseService {
  /**
   * Initializes the STIX Bundles Service with necessary repositories and caches.
   * Sets up caching mechanisms for attack objects, identities, and marking definitions
   * to optimize performance during bundle generation.
   */
  constructor() {
    super();
    this.repositories = {
      analytic: analyticsRepository,
      attackObject: attackObjectsRepository,
      matrix: matrixRepository,
      mitigation: mitigationsRepository,
      note: notesRepository,
      relationship: relationshipsRepository,
      software: softwareRepository,
      tactic: tacticsRepository,
      technique: techniquesRepository,
      dataComponent: dataComponentsRepository,
      dataSource: dataSourcesRepository,
      detectionStrategy: detectionStrategiesRepository,
    };
  }

  // ============================
  // Deprecated Pattern Filtering
  // ============================

  /**
   * Defines deprecated patterns that should be excluded from new spec bundles.
   * This centralized list makes it easy to manage which deprecated patterns
   * are filtered out of exports when using the new ATT&CK specification.
   *
   * Each entry defines criteria for filtering:
   * - type: The STIX object type (e.g., 'relationship')
   * - conditions: Object with properties that must match for exclusion
   *
   * DEPRECATED PATTERNS (ATT&CK v17+):
   * - SRO<x-mitre-data-component, detects, attack-pattern>
   *   Reason: Data components no longer detect techniques; detection strategies do
   */
  static DEPRECATED_PATTERNS = [
    {
      type: 'relationship',
      conditions: {
        relationship_type: 'detects',
        sourceTypePrefix: 'x-mitre-data-component--',
      },
      reason: 'Data components cannot detect techniques in v17+ (only detection strategies can)',
    },
  ];

  /**
   * Checks if a STIX object matches any deprecated pattern and should be excluded.
   * @param {Object} stixObject - The STIX object to check
   * @returns {boolean} True if the object matches a deprecated pattern
   */
  static isDeprecatedPattern(stixObject) {
    for (const pattern of StixBundlesService.DEPRECATED_PATTERNS) {
      if (stixObject.type !== pattern.type) {
        continue;
      }

      // Check all conditions for this pattern
      let matchesAllConditions = true;
      for (const [key, value] of Object.entries(pattern.conditions)) {
        if (key === 'sourceTypePrefix') {
          // Special handling for source_ref prefix matching
          if (!stixObject.source_ref?.startsWith(value)) {
            matchesAllConditions = false;
            break;
          }
        } else if (stixObject[key] !== value) {
          matchesAllConditions = false;
          break;
        }
      }

      if (matchesAllConditions) {
        return true;
      }
    }
    return false;
  }

  // ============================
  // Domain and Type Validation
  // ============================

  /**
   * Validates if an attack object belongs to the specified domain.
   * Only certain object types require domain validation.
   * @param {Object} attackObject - The attack object to validate
   * @param {string} domain - The domain to check against
   * @returns {boolean} True if object belongs to domain or doesn't require domain validation
   */
  static isCorrectDomain(attackObject, domain) {
    const domainCheckTypes = [
      'attack-pattern',
      'course-of-action',
      'malware',
      'tool',
      'x-mitre-tactic',
    ];

    return (
      !domainCheckTypes.includes(attackObject?.stix?.type) ||
      (attackObject?.stix?.x_mitre_domains && attackObject.stix.x_mitre_domains.includes(domain))
    );
  }

  /**
   * Checks if an attack object has a valid ATT&CK ID in its external references.
   * @param {Object} attackObject - The attack object to check
   * @returns {boolean} True if the object has a valid ATT&CK ID
   */
  static hasAttackId(attackObject) {
    if (attackObject) {
      const externalReferences = attackObject?.stix?.external_references;
      if (Array.isArray(externalReferences) && externalReferences.length > 0) {
        const mitreAttackReference = externalReferences.find((ref) =>
          config.attackSourceNames.includes(ref.source_name),
        );
        if (mitreAttackReference?.external_id) {
          return true;
        }
      }
    }
    return false;
  }

  // ============================
  // STIX Version Management
  // ============================

  /**
   * Removes empty array properties from a STIX object.
   * @param {Object} stixObject - The STIX object to clean
   */
  static removeEmptyArrays(stixObject) {
    for (const propertyName of Object.keys(stixObject)) {
      if (Array.isArray(stixObject[propertyName]) && stixObject[propertyName].length === 0) {
        delete stixObject[propertyName];
      }
    }
  }

  /**
   * Modifies a STIX object to conform to the specified STIX version (2.0 or 2.1).
   * Handles version-specific requirements for various object types.
   * @param {Object} stixObject - The STIX object to modify
   */
  static conformToStixVersion(stixObject, stixVersion) {
    if (stixVersion === '2.0') {
      // Remove STIX 2.1 specific properties
      delete stixObject.spec_version;

      // Handle malware and tool specific requirements
      if (stixObject.type === 'malware') {
        delete stixObject.is_family;
        stixObject.labels = ['malware'];
      }

      if (stixObject.type === 'tool') {
        stixObject.labels = ['tool'];
      }
    } else if (stixVersion === '2.1') {
      stixObject.spec_version = '2.1';
      if (stixObject.type != 'course-of-action') {
        delete stixObject.labels;
      }
    }

    this.removeEmptyArrays(stixObject);
  }

  // ============================
  // Relationship Management
  // ============================

  /**
   * Determines if a relationship is currently active (not deprecated or revoked).
   * @param {Object} relationship - The relationship object to check
   * @returns {boolean} True if the relationship is active
   */
  static relationshipIsActive(relationship) {
    return !relationship.stix.x_mitre_deprecated && !relationship.stix.revoked;
  }

  /**
   * Adds a relationship to the STIX bundle, if:
   * - It is active, as per relationshipIsActive()
   * - Its source_ref and target_ref exist in objectsMap
   * - It does not match any deprecated patterns
   *
   * @param {Object} relationship - The relationship object to add
   * @param {Object} bundle - The STIX bundle being built
   * @param {Map} objectsMap - Map tracking objects in the bundle
   */
  static addRelationshipToBundle(relationship, bundle, objectsMap) {
    // Filter out deprecated patterns (e.g., data component detects relationships)
    if (StixBundlesService.isDeprecatedPattern(relationship.stix)) {
      return;
    }

    if (
      StixBundlesService.relationshipIsActive(relationship) &&
      objectsMap.has(relationship.stix.source_ref) &&
      objectsMap.has(relationship.stix.target_ref)
    ) {
      bundle.objects.push(relationship.stix);
    }
  }

  /**
   * Adds an ATT&CK object to the STIX bundle
   * @param {Object} attackObject - The ATT&CK object to add
   * @param {Object} bundle - The STIX bundle being built
   * @param {Map} objectsMap - Map tracking objects in the bundle

   */
  addAttackObjectToBundle(attackObject, bundle, objectsMap) {
    if (!objectsMap.has(attackObject.stix.id)) {
      bundle.objects.push(attackObject.stix);
      objectsMap.set(attackObject.stix.id, true);
      const attackId = linkById.getAttackId(attackObject.stix);
      if (attackId) {
        this.attackObjectByAttackIdCache.set(attackId, attackObject);
      }
    }
  }

  /**
   * Processes a secondary object for inclusion in the bundle.
   * Validates the object and updates necessary data structures.
   * @param {Object} secondaryObject - The secondary object to process
   * @param {Object} options - Bundle generation options
   * @returns {Promise<boolean>} True if object was successfully processed
   */
  async processSecondaryObject(secondaryObject, options) {
    if (!StixBundlesService.secondaryObjectIsValid(secondaryObject, options)) {
      return false;
    }

    // Handle domains for groups and campaigns
    if (secondaryObject.stix.type === 'intrusion-set' || secondaryObject.stix.type === 'campaign') {
      if (secondaryObject.stix.x_mitre_domains) {
        this.domainCache.set(secondaryObject.stix.id, secondaryObject.stix.x_mitre_domains);
      }
      secondaryObject.stix.x_mitre_domains =
        await this.getDomainsForSecondaryObject(secondaryObject);
    }
    return true;
  }

  /**
   * Validates if a secondary object meets all inclusion criteria for the bundle.
   * @param {Object} secondaryObject - The object to validate
   * @param {Object} options - Bundle generation options
   * @returns {boolean} True if the object meets all inclusion criteria
   */
  static secondaryObjectIsValid(secondaryObject, options) {
    return (
      // Object must exist
      secondaryObject &&
      // Check if ATT&CK ID is required
      (options.includeMissingAttackId ||
        !requiresAttackId(secondaryObject?.stix?.type) ||
        StixBundlesService.hasAttackId(secondaryObject)) &&
      // Check deprecation status
      (options.includeDeprecated || !secondaryObject.stix.x_mitre_deprecated) &&
      // Check revocation status
      (options.includeRevoked || !secondaryObject.stix.revoked) &&
      // Check workflow state if specified
      (options.state === undefined || secondaryObject.workspace.workflow.state === options.state) &&
      // Verify domain for certain object types
      StixBundlesService.isCorrectDomain(secondaryObject, options.domain)
    );
  }

  /**
   * Determines the domains associated with a secondary object based on its relationships.
   * @param {Object} attackObject - The secondary object to process
   * @returns {Promise<Array<string>>} Array of domain names
   */
  async getDomainsForSecondaryObject(attackObject) {
    const relationships = this.allRelationships.filter(
      (relationship) => relationship.stix.source_ref == attackObject.stix.id,
    );

    const domainMap = new Map();
    for (const relationship of relationships) {
      const targetObject = await this.getAttackObject(relationship.stix.target_ref);
      // domainCache is used to accurately reflect the STIX bundle post-refactoring in project Orion.
      // The additional domains that would otherwise be added are likely correct, but that will
      // be handled in a separate data cleanup effort not coinciding with the imminent v17 ATT&CK release.
      if (this.domainCache.has(targetObject?.stix.id)) {
        for (const domain of this.domainCache.get(targetObject.stix.id)) {
          domainMap.set(domain, true);
        }
      } else {
        if (targetObject?.stix.x_mitre_domains) {
          for (const domain of targetObject.stix.x_mitre_domains) {
            domainMap.set(domain, true);
          }
        }
      }
    }

    return [...domainMap.keys()];
  }

  // ============================
  // Collection Object Management
  // ============================

  /**
   * Add an x-mitre-collection object to the bundle, based on the objects inside.
   * @param {Object} bundle - The bundle to update
   * @param {Object} options - Bundle generation options
   */
  static addCollectionObject(bundle, options) {
    const domain_info = {
      'enterprise-attack': {
        name: 'Enterprise ATT&CK',
        creation_date: '2018-01-17T12:56:55.080Z',
        description:
          'ATT&CK for Enterprise provides a knowledge base of real-world adversary behavior targeting traditional enterprise networks. ATT&CK for Enterprise covers the following platforms: Windows, macOS, Linux, PRE, Office 365, Google Workspace, IaaS, Network, and Containers.',
        collection_id: 'x-mitre-collection--1f5f1533-f617-4ca8-9ab4-6a02367fa019',
      },
      'mobile-attack': {
        name: 'Mobile ATT&CK',
        creation_date: '2018-01-17T12:56:55.080Z',
        description:
          "ATT&CK for Mobile is a matrix of adversary behavior against mobile devices (smartphones and tablets running the Android or iOS/iPadOS operating systems). ATT&CK for Mobile builds upon NIST's Mobile Threat Catalogue and also contains a separate matrix of network-based effects, which are techniques that an adversary can employ without access to the mobile device itself.",
        collection_id: 'x-mitre-collection--dac0d2d7-8653-445c-9bff-82f934c1e858',
      },
      'ics-attack': {
        name: 'ICS ATT&CK',
        creation_date: '2020-10-27T14:49:39.188Z',
        description:
          'The ATT&CK for Industrial Control Systems (ICS) knowledge base categorizes the unique set of tactics, techniques, and procedures (TTPs) used by threat actors in the ICS technology domain. ATT&CK for ICS outlines the portions of an ICS attack that are out of scope of Enterprise and reflects the various phases of an adversary’s attack life cycle and the assets and systems they are known to target.',
        collection_id: 'x-mitre-collection--90c00720-636b-4485-b342-8751d232bf09',
      },
    };

    const collectionObject = {
      type: 'x-mitre-collection',
      id: domain_info[options.domain].collection_id,
      spec_version: options.spec_version,
      x_mitre_attack_spec_version: options.collectionAttackSpecVersion,
      name: domain_info[options.domain].name,
      x_mitre_version: options.collectionObjectVersion,
      description: domain_info[options.domain].description,
      created_by_ref: '',
      created: domain_info[options.domain].creation_date,
      modified: options.collectionObjectModified,
      x_mitre_contents: [],
      object_marking_refs: [],
    };

    for (const bundleObject of bundle.objects) {
      if (bundleObject.type === 'marking-definition') {
        collectionObject.object_marking_refs.push(bundleObject.id);
      } else {
        collectionObject.x_mitre_contents.push({
          object_ref: bundleObject.id,
          object_modified: bundleObject.modified,
        });
        // TODO: Make this not specific to MITRE
        if (bundleObject.type === 'identity' && bundleObject.name === 'The MITRE Corporation') {
          collectionObject.created_by_ref = bundleObject.id;
        }
      }
    }

    if (options.stixVersion == '2.1') {
      collectionObject.spec_version = '2.1';
    }

    // Sort x_mitre_contents by id
    collectionObject.x_mitre_contents.sort((x, y) => x.object_ref.localeCompare(y.object_ref));

    bundle.objects.unshift(collectionObject);
  }

  // ============================
  // Main Export Method
  // ============================

  /**
   * Main method for exporting a STIX bundle with specified options.
   * Orchestrates the entire bundle generation process including:
   * - Retrieving primary objects from specified domain
   * - Processing relationships between objects
   * - Adding secondary objects and their relationships
   * - Handling data components and data sources
   * - Processing notes if requested
   * - Conforming objects to specified STIX version
   * - Adding an x-mitre-collection object, if requested
   *
   * @param {Object} options - Bundle generation options
   * @param {string} options.domain - The domain to generate bundle for (e.g., 'enterprise-attack')
   * @param {string} options.stixVersion - Target STIX version ('2.0' or '2.1')
   * @param {boolean} options.includeRevoked - Whether to include revoked objects
   * @param {boolean} options.includeDeprecated - Whether to include deprecated objects
   * @param {boolean} options.includeMissingAttackId - Whether to include objects without ATT&CK IDs
   * @param {boolean} options.includeNotes - Whether to include associated notes
   * @param {boolean} options.includeCollectionObject - Whether to create an x-mitre-collection object
   * @param {boolean} options.collectionObjectVersion - x_mitre_version of the collection object
   * @param {boolean} options.collectionAttackSpecVersion - x_mitre_attack_spec_version of the collection object
   * @param {boolean} options.collectionObjectModified - Modified timestamp of the collection object
   * @param {boolean} [options.includeDataSources=false] - Whether to include deprecated data sources
   * @param {string} [options.state] - Workflow state filter
   * @returns {Promise<Object>} The generated STIX bundle
   */
  async exportBundle(options) {
    // Initialize caches for efficient object lookup
    this.attackObjectCache = new Map(); // Maps STIX IDs to attack objects
    this.identityCache = new Map(); // Maps identity STIX IDs to identity objects
    this.markingDefinitionsCache = new Map(); // Maps marking definition STIX IDs to marking objects
    this.attackObjectByAttackIdCache = new Map(); // Maps attack IDs to attack objects
    this.domainCache = new Map(); // Stores original x-mitre-domains if we change them at runtime

    // Initialize bundle
    const bundle = {
      type: 'bundle',
      id: `bundle--${uuid.v4()}`,
      objects: [],
    };

    // STIX version handling:
    // - STIX 2.0: Bundle must have spec_version property
    // - STIX 2.1: Bundle must not have spec_version property
    if (options.stixVersion === '2.0') {
      bundle.spec_version = '2.0';
    }

    // Retrieve primary objects
    const [
      domainMitigations,
      domainSoftware,
      domainTactics,
      domainTechniques,
      domainMatrices,
      domainAnalytics,
      domainDataComponents,
      domainDataSources,
    ] = await Promise.all([
      this.repositories.mitigation.retrieveAllByDomain(options.domain, options),
      this.repositories.software.retrieveAllByDomain(options.domain, options),
      this.repositories.tactic.retrieveAllByDomain(options.domain, options),
      this.repositories.technique.retrieveAllByDomain(options.domain, options),
      this.repositories.matrix.retrieveAllByDomain(options.domain, options),
      this.repositories.analytic.retrieveAllByDomain(options.domain, options),
      this.repositories.dataComponent.retrieveAllByDomain(options.domain, options),
      this.repositories.dataSource.retrieveAllByDomain(options.domain, options),
    ]);

    // Filter out analytics that don't have a URL, since they're not yet linked to a detection strategy
    const filteredDomainAnalytics = domainAnalytics.filter((a) => {
      const externalReferences = a?.stix?.external_references;
      return (
        Array.isArray(externalReferences) &&
        externalReferences.length > 0 &&
        externalReferences[0].url
      );
    });

    let primaryObjects = [
      ...domainMatrices,
      ...domainMitigations,
      ...domainSoftware,
      ...domainTactics,
      ...domainTechniques,
      ...filteredDomainAnalytics,
      ...domainDataComponents,
      ...(options.includeDataSources === true ? domainDataSources : []),
    ];

    if (primaryObjects.length === 0) {
      return bundle;
    }

    if (!options.includeMissingAttackId) {
      primaryObjects = primaryObjects.filter((o) => StixBundlesService.hasAttackId(o));
    }

    // Put the primary objects in the bundle
    // Also create a map of the objects added to the bundle (use the id as the key, since relationships only reference the id)
    const objectsMap = new Map();
    for (const primaryObject of primaryObjects) {
      this.addAttackObjectToBundle(primaryObject, bundle, objectsMap);
    }

    // Since we're querying all relationships, save them for later to prevent future database queries.
    this.allRelationships = await this.repositories.relationship.retrieveAllForBundle(options);

    // Filter relationships that have a source_ref or target_ref that points at a primary object
    const primaryObjectRelationships = this.allRelationships.filter(
      (relationship) =>
        objectsMap.has(relationship.stix.source_ref) ||
        objectsMap.has(relationship.stix.target_ref),
    );

    // Get the secondary objects (additional objects pointed to by a relationship)
    await this.addSecondaryObjects(primaryObjectRelationships, objectsMap, bundle, options);

    await this.processSecondaryRelationships(bundle, objectsMap, options);

    // Add all valid relationships to the bundle
    for (const relationship of this.allRelationships) {
      StixBundlesService.addRelationshipToBundle(relationship, bundle, objectsMap);
    }

    // Add notes if requested
    if (options.includeNotes) {
      await notesService.addNotes(bundle.objects);
    }

    // Convert LinkById tags to markdown citations
    await this.convertLinkByIdTags(bundle.objects, this.attackObjectByAttackIdCache);

    // Process identities and marking definitions
    await this.processIdentitiesAndMarkings(bundle);

    // Conform to STIX version
    for (const stixObject of bundle.objects) {
      StixBundlesService.conformToStixVersion(stixObject, options.stixVersion);
    }

    if (options.includeCollectionObject) {
      StixBundlesService.addCollectionObject(bundle, options);
    }
    return bundle;
  }

  /**
   * Add secondary objects to the bundle - those objects which have a relationship
   * to a primary object but did not have the proper domain in the database.
   *
   * Note: 'detects' relationships are skipped here and handled separately in
   * processSecondaryRelationships() to support the new ATT&CK spec where only
   * detection strategies (not data components) can detect techniques.
   *
   * @param {Array} primaryObjectRelationships - The relationships to process
   * @param {Map} objectsMap - Map of objects currently in the bundle
   * @param {Object} bundle - The STIX bundle being built
   * @param {Object} options - Bundle generation options
   * @returns {Promise<void>}
   */
  async addSecondaryObjects(primaryObjectRelationships, objectsMap, bundle, options) {
    for (const relationship of primaryObjectRelationships) {
      // Skip 'detects' relationships - they require special handling
      //
      // CONTEXT: The ATT&CK specification changed how detection works:
      // - OLD (pre-v17): Data components could detect techniques via 'detects' relationships
      // - NEW (v17+): Only detection strategies can detect techniques via 'detects' relationships
      //
      // WHY WE SKIP HERE:
      // 1. Data components are now PRIMARY objects (retrieved by domain), not secondary
      // 2. If we processed 'detects' relationships here, we would incorrectly add data
      //    components as secondary objects based on deprecated relationships
      // 3. Detection strategies ARE secondary objects, but they need special domain
      //    inference logic (they get the domain of the technique they detect)
      //
      // WHERE THEY'RE HANDLED:
      // 'detects' relationships are processed in processSecondaryRelationships() where:
      // - We verify the source is a detection strategy (not a data component)
      // - We set the detection strategy's x_mitre_domains to match the target technique
      // - Deprecated 'detects' from data components are silently ignored
      if (relationship.stix.relationship_type === 'detects') {
        continue;
      }

      if (!objectsMap.has(relationship.stix.source_ref)) {
        const secondaryObject = await this.getAttackObject(relationship.stix.source_ref);

        // Only process if the secondary object meets our inclusion criteria
        if (await this.processSecondaryObject(secondaryObject, options)) {
          this.addAttackObjectToBundle(secondaryObject, bundle, objectsMap);
        }
      } else if (!objectsMap.has(relationship.stix.target_ref)) {
        const secondaryObject = await this.getAttackObject(relationship.stix.target_ref);

        // Only process if the secondary object meets our inclusion criteria
        if (await this.processSecondaryObject(secondaryObject, options)) {
          this.addAttackObjectToBundle(secondaryObject, bundle, objectsMap);
        }
      }
    }
  }

  /**
   * Processes all identities and marking definitions referenced in the bundle.
   * This ensures that all necessary context objects are included.
   *
   * Steps:
   * 1. Collect all identity references (created_by_ref)
   * 2. Collect all marking definition references (object_marking_refs)
   * 3. Retrieve objects from cache or database
   * 4. Add valid objects to bundle
   * 5. Log warnings for missing references
   *
   * @param {Object} bundle - The STIX bundle being built
   * @returns {Promise<void>}
   */
  async processIdentitiesAndMarkings(bundle) {
    // Map referenced identities and marking definitions
    const identitiesMap = new Map();
    const markingDefinitionsMap = new Map();

    for (const bundleObject of bundle.objects) {
      if (bundleObject.created_by_ref) {
        identitiesMap.set(bundleObject.created_by_ref, true);
      }

      if (bundleObject.object_marking_refs) {
        for (const markingRef of bundleObject.object_marking_refs) {
          markingDefinitionsMap.set(markingRef, true);
        }
      }
    }

    // Process identities
    for (const stixId of identitiesMap.keys()) {
      if (this.identityCache.has(stixId)) {
        bundle.objects.push(this.identityCache.get(stixId));
        continue;
      }

      const identity = await this.getAttackObject(stixId);
      if (identity) {
        bundle.objects.push(identity.stix);
        this.identityCache.set(stixId, identity.stix);
      } else {
        logger.warn(`Referenced identity not found: ${stixId}`);
      }
    }

    // Process marking definitions
    for (const stixId of markingDefinitionsMap.keys()) {
      if (this.markingDefinitionsCache.has(stixId)) {
        bundle.objects.push(this.markingDefinitionsCache.get(stixId));
        continue;
      }

      const markingDefinition = await this.getAttackObject(stixId);
      if (markingDefinition) {
        bundle.objects.push(markingDefinition.stix);
        this.markingDefinitionsCache.set(stixId, markingDefinition.stix);
      }
    }
  }

  /**
   * Processes relationships between secondary objects and handles special cases that need separate processing:
   * - Groups referenced by campaigns through 'attributed-to' relationships
   * - Detection strategies that detect techniques in the bundle
   * - Detection strategies referenced by analytics in the bundle
   * - Secondary objects that were revoked by other secondary objects
   *
   * @param {Object} bundle - The STIX bundle being built
   * @param {Map} objectsMap - Map tracking objects currently in bundle
   * @param {Object} options - Bundle generation options
   * @param {string} options.domain - The domain being processed
   * @returns {Promise<void>}
   */
  async processSecondaryRelationships(bundle, objectsMap, options) {
    for (const relationship of this.allRelationships) {
      // Add groups referenced by campaigns through 'attributed-to' relationships
      if (
        relationship.stix.relationship_type === 'attributed-to' &&
        objectsMap.has(relationship.stix.source_ref) &&
        !objectsMap.has(relationship.stix.target_ref)
      ) {
        const groupObject = await this.getAttackObject(relationship.stix.target_ref);
        if (
          groupObject.stix.type === 'intrusion-set' &&
          StixBundlesService.secondaryObjectIsValid(groupObject, options)
        ) {
          if (groupObject.stix.x_mitre_domains) {
            this.domainCache.set(groupObject.stix.id, groupObject.stix.x_mitre_domains);
          }
          groupObject.stix.x_mitre_domains = [options.domain];
          this.addAttackObjectToBundle(groupObject, bundle, objectsMap);
        }
      }

      // Add detection strategies that detect techniques in the bundle
      if (
        relationship.stix.relationship_type === 'detects' &&
        objectsMap.has(relationship.stix.target_ref) &&
        !objectsMap.has(relationship.stix.source_ref)
      ) {
        const detectionStrategy = await this.getAttackObject(relationship.stix.source_ref);
        if (
          detectionStrategy.stix.type === 'x-mitre-detection-strategy' &&
          StixBundlesService.secondaryObjectIsValid(detectionStrategy, options)
        ) {
          if (detectionStrategy.stix.x_mitre_domains) {
            this.domainCache.set(detectionStrategy.stix.id, detectionStrategy.stix.x_mitre_domains);
          }
          // Set x_mitre_domains on each exported detection strategy
          detectionStrategy.stix.x_mitre_domains = [options.domain];
          this.addAttackObjectToBundle(detectionStrategy, bundle, objectsMap);
        }
      }

      // Add secondary objects that were revoked by other secondary objects
      if (
        relationship.stix.relationship_type === 'revoked-by' &&
        !objectsMap.has(relationship.stix.source_ref) &&
        objectsMap.has(relationship.stix.target_ref)
      ) {
        const revokedObject = await this.getAttackObject(relationship.stix.source_ref);
        if (StixBundlesService.secondaryObjectIsValid(revokedObject, options)) {
          if (
            revokedObject.stix.type === 'intrusion-set' ||
            revokedObject.stix.type === 'campaign'
          ) {
            if (revokedObject.stix.x_mitre_domains) {
              this.domainCache.set(revokedObject.stix.id, revokedObject.stix.x_mitre_domains);
            }
            revokedObject.stix.x_mitre_domains = [options.domain];
          }
          this.addAttackObjectToBundle(revokedObject, bundle, objectsMap);
        }
      }
    }

    // Add detection strategies referenced by analytics in the bundle
    // This is a key requirement of the new ATT&CK spec: detection strategies should be
    // included if they reference an analytic that is in the domain
    const analyticsInBundle = bundle.objects.filter((obj) => obj.type === 'x-mitre-analytic');

    if (analyticsInBundle.length > 0) {
      // Collect all analytic IDs in the bundle
      const analyticIds = analyticsInBundle.map((analytic) => analytic.id);

      // Single batch query to find all detection strategies that reference any of these analytics
      // This replaces the N+1 query pattern that was causing timeouts
      const detectionStrategyDocs = await this.repositories.detectionStrategy.findByAnalyticRefs(
        analyticIds,
        options,
      );

      for (const detectionStrategyDoc of detectionStrategyDocs) {
        if (
          !objectsMap.has(detectionStrategyDoc.stix.id) &&
          StixBundlesService.secondaryObjectIsValid(detectionStrategyDoc, options)
        ) {
          if (detectionStrategyDoc.stix.x_mitre_domains) {
            this.domainCache.set(
              detectionStrategyDoc.stix.id,
              detectionStrategyDoc.stix.x_mitre_domains,
            );
          }
          // Set x_mitre_domains on each exported detection strategy
          detectionStrategyDoc.stix.x_mitre_domains = [options.domain];
          this.addAttackObjectToBundle(detectionStrategyDoc, bundle, objectsMap);
        }
      }
    }
  }

  // ============================
  // Repository Access Methods (+Cache Management)
  // ============================

  /**
   * Retrieves an attack object by its STIX ID, using cache when possible.
   * Implements a caching strategy to minimize database queries.
   *
   * Process:
   * 1. Check cache using STIX ID
   * 2. If not found, query database
   * 3. If found in database, cache for future use
   * 4. Handle errors gracefully
   *
   * @param {string} stixId - The STIX ID of the object to retrieve
   * @returns {Promise<Object|null>} The attack object or null if not found/error
   */
  async getAttackObject(stixId) {
    try {
      // First check cache
      const cacheKey = stixId;
      if (this.attackObjectCache.has(cacheKey)) {
        return this.attackObjectCache.get(cacheKey);
      }

      // Use the existing repository method that exactly matches the original logic
      const attackObject = await this.repositories.attackObject.retrieveLatestByStixId(stixId);

      if (attackObject) {
        this.attackObjectCache.set(cacheKey, attackObject);
      }

      return attackObject;
    } catch (err) {
      logger.error(`Error retrieving attack object ${stixId}:`, err);
      return null;
    }
  }

  /**
   * Converts LinkById tags to markdown citations
   * @param {Array<Object>} bundleObjects - Objects in the bundle
   * @param {Map} attackObjectByAttackIdCache - Map of attack objects
   */
  async convertLinkByIdTags(bundleObjects, attackObjectByAttackIdCache) {
    const getAttackObjectFromMap = async function (attackId) {
      return (
        attackObjectByAttackIdCache.get(attackId) ||
        (await linkById.getAttackObjectFromDatabase(attackId))
      );
    };

    for (const bundleObject of bundleObjects) {
      await linkById.convertLinkByIdTags(bundleObject, getAttackObjectFromMap);
    }
  }
}

module.exports = new StixBundlesService();
