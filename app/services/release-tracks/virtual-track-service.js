'use strict';

const CreationCause = require('../../lib/release-tracks/snapshot-creation-causes');

// =============================================================================
// Virtual Track Service
//
// Manages virtual release track operations: composition configuration and
// snapshot creation via resolution of component tracks.
//
// Virtual tracks aggregate content from multiple standard tracks by:
//   1. Resolving each component track to its selected standard snapshot
//   2. Planning draft preview members or collecting published members
//   3. Applying per-component filters (object_types and domains)
//   4. Deduplicating across all components
//   5. Persisting the result as a new draft snapshot
//
// See docs/COLLECTIONS_V2/04_VIRTUAL_TRACKS.md for full specification.
// =============================================================================

const snapshotService = require('./snapshot-service');
const primaryRevisionService = require('./primary-revision-service');
const dynamicRepo = require('../../repository/release-tracks/release-track-dynamic.repository');
const registryRepo = require('../../repository/release-tracks/release-track-registry.repository');
const deduplicationStrategies = require('../../lib/release-tracks/deduplication-strategies');
const objectResolver = require('../../lib/release-tracks/object-resolver');
const EventBus = require('../../lib/event-bus');
const Events = require('../../lib/event-constants');
const logger = require('../../lib/logger');
const {
  BadRequestError,
  DuplicateIdError,
  TrackNotFoundError,
  NoTaggedSnapshotsError,
  InvalidComponentTypeError,
  ReleaseConflictError,
  NotFoundError,
} = require('../../exceptions');

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Validate that the snapshot belongs to a virtual track.
 * @param {Object} snapshot
 * @throws {BadRequestError}
 */
function assertVirtualTrack(snapshot) {
  if (snapshot.type !== 'virtual') {
    throw new BadRequestError({
      message: 'This operation is only available for virtual release tracks',
      details: `Track ${snapshot.id} is a ${snapshot.type} track`,
    });
  }
}

/**
 * Validate that all component tracks exist, are standard tracks, and have
 * no duplicate track_ids or priority values.
 *
 * @param {Array<Object>} componentTracks - The composition.component_tracks array
 * @returns {Promise<Map<string, Object>>} Map of track_id → registry entry
 */
async function validateComponentTracks(componentTracks) {
  if (!componentTracks || componentTracks.length === 0) {
    throw new BadRequestError({
      message: 'Composition must include at least one component track',
    });
  }

  const invalidPriority = componentTracks.find(
    (component) => !Number.isInteger(component.priority) || component.priority < 0,
  );
  if (invalidPriority) {
    throw new BadRequestError({
      message: 'Invalid component priority',
      details: 'Each component track must have a non-negative integer priority',
    });
  }

  // Check for duplicate track_ids
  const trackIds = componentTracks.map((c) => c.track_id);
  const uniqueTrackIds = new Set(trackIds);
  if (uniqueTrackIds.size !== trackIds.length) {
    throw new BadRequestError({
      message: 'Duplicate track_id values found in component_tracks',
      details: 'Each component track must reference a unique track',
    });
  }

  // Check for duplicate priorities
  const priorities = componentTracks.map((c) => c.priority);
  const uniquePriorities = new Set(priorities);
  if (uniquePriorities.size !== priorities.length) {
    throw new BadRequestError({
      message: 'Duplicate priority values found in component_tracks',
      details: 'Each component track must have a unique priority value',
    });
  }

  // Validate each component exists and is a standard track
  const registryMap = new Map();
  for (const component of componentTracks) {
    const registry = await registryRepo.findByTrackId(component.track_id);
    if (!registry) {
      throw new TrackNotFoundError(component.track_id);
    }
    if (registry.type !== 'standard') {
      throw new InvalidComponentTypeError(component.track_id);
    }
    registryMap.set(component.track_id, registry);
  }

  return registryMap;
}

/**
 * Validate component identities and types without resolving their snapshots.
 * Used before initial virtual-track persistence as well as by virtual
 * operations that replace or materialize composition.
 *
 * @param {Object} composition
 * @returns {Promise<Map<string, Object>>}
 */
exports.validateComposition = async function validateComposition(composition) {
  return validateComponentTracks(composition.component_tracks);
};

/**
 * Resolve a component track to a snapshot based on its resolution strategy.
 *
 * @param {Object} component - A component_tracks entry
 * @returns {Promise<Object>} The resolved snapshot document
 * @throws {NoTaggedSnapshotsError} If no suitable tagged snapshot is found
 */
async function resolveComponentSnapshot(component) {
  let snapshot;

  switch (component.resolution_strategy) {
    case 'latest_tagged':
      snapshot = await dynamicRepo.getLatestTaggedSnapshot(component.track_id);
      break;

    case 'latest_preview':
      snapshot = await dynamicRepo.getLatestSnapshot(component.track_id);
      break;

    case 'specific_version':
      snapshot = await dynamicRepo.getSnapshotByVersion(component.track_id, component.version);
      break;

    case 'specific_snapshot':
      snapshot = await dynamicRepo.getSnapshotByModified(component.track_id, component.snapshot);
      break;

    case 'latest_draft':
      throw new BadRequestError({
        message: `Component track '${component.track_id}' uses retired strategy latest_draft`,
        details: 'Update composition to explicitly choose latest_preview or latest_tagged',
      });

    default:
      throw new BadRequestError({
        message: `Unknown resolution strategy: ${component.resolution_strategy}`,
      });
  }

  if (!snapshot) {
    throw new NoTaggedSnapshotsError(component.track_id);
  }

  // Explicit snapshot selection remains tagged-only.
  if (component.resolution_strategy !== 'latest_preview' && snapshot.version == null) {
    throw new NoTaggedSnapshotsError(component.track_id);
  }

  return snapshot;
}

/**
 * Normalize public domain filter names to their STIX x_mitre_domains values.
 *
 * @param {string} domain
 * @returns {string}
 */
function normalizeDomain(domain) {
  return domain.endsWith('-attack') ? domain : `${domain}-attack`;
}

/**
 * Read explicit domains, with the established matrix fallback used by the
 * legacy bundle exporter. Primary matrices identify their domain through the
 * ATT&CK external reference rather than x_mitre_domains.
 *
 * @param {Object} stixObject
 * @returns {Array<string>}
 */
function getObjectDomains(stixObject) {
  if (Array.isArray(stixObject.x_mitre_domains)) {
    return stixObject.x_mitre_domains;
  }
  if (stixObject.type === 'x-mitre-matrix') {
    return (stixObject.external_references || [])
      .map((reference) => reference.external_id)
      .filter((externalId) => typeof externalId === 'string' && externalId.endsWith('-attack'));
  }
  return [];
}

/**
 * Apply object type and domain filters to a list of member entries.
 * Filters by extracting the STIX type prefix from the object_ref
 * (e.g., "attack-pattern" from "attack-pattern--uuid").
 *
 * @param {Array<Object>} members - Member entries with object_ref
 * @param {Object} [filters] - { object_types?: string[], domains?: string[] }
 * @param {Map<string, Array<string>>} domainsByVersion - Exact revision key → domains
 * @returns {Array<Object>} Filtered members
 */
function applyFilters(members, filters, domainsByVersion) {
  if (!filters) return members;

  let filtered = members;

  if (filters.object_types && filters.object_types.length > 0) {
    const allowedTypes = new Set(filters.object_types);
    filtered = filtered.filter((m) => {
      const stixType = m.object_ref.split('--')[0];
      return allowedTypes.has(stixType);
    });
  }

  if (filters.domains && filters.domains.length > 0) {
    const allowedDomains = new Set(filters.domains.map(normalizeDomain));
    filtered = filtered.filter((member) => {
      const key = `${member.object_ref}::${new Date(member.object_modified).getTime()}`;
      const objectDomains = domainsByVersion.get(key) || [];
      return objectDomains.some((domain) => allowedDomains.has(normalizeDomain(domain)));
    });
  }

  return filtered;
}

/**
 * Hydrate domains for the exact pinned revisions needed by domain filters.
 *
 * @param {Array<Object>} componentTracks
 * @param {Array<Object>} resolutions
 * @returns {Promise<Map<string, Array<string>>>}
 */
async function hydrateDomains(componentTracks, resolutions) {
  const entries = [];
  const seen = new Set();

  for (let i = 0; i < componentTracks.length; i++) {
    if (!componentTracks[i].filters?.domains?.length) continue;

    for (const member of resolutions[i].members || []) {
      const key = `${member.object_ref}::${new Date(member.object_modified).getTime()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(member);
    }
  }

  if (entries.length === 0) return new Map();

  const results = await EventBus.emit(Events.ATTACK_OBJECT_REVISIONS_REQUESTED, { entries });
  const documents = results?.[0];
  if (!documents) {
    throw new Error('Unable to hydrate ATT&CK object revisions for virtual domain filtering');
  }

  return new Map(
    documents.map((document) => [
      `${document.stix.id}::${new Date(document.stix.modified).getTime()}`,
      getObjectDomains(document.stix),
    ]),
  );
}

/**
 * Lock every component member to an exact revision before filtering and
 * deduplication. Current snapshots already store Date-valued pins; resolving
 * missing or `latest` values is a defensive compatibility boundary for legacy
 * component data. The virtual snapshot itself never persists a moving ref.
 *
 * @param {Array<Object>} resolutions
 * @param {Map<string, Promise<Date>>} latestByObjectRef
 * @returns {Promise<Array<Object>>}
 */
async function lockComponentMemberRevisions(resolutions, latestByObjectRef) {
  const resolveLatest = (objectRef) => {
    if (!latestByObjectRef.has(objectRef)) {
      latestByObjectRef.set(objectRef, objectResolver.resolveLatestModified(objectRef));
    }
    return latestByObjectRef.get(objectRef);
  };

  return Promise.all(
    resolutions.map(async (snapshot) => ({
      ...snapshot,
      members: await Promise.all(
        (snapshot.members || []).map(async (member) => {
          const unresolved = member.object_modified == null || member.object_modified === 'latest';
          const objectModified = unresolved
            ? await resolveLatest(member.object_ref)
            : new Date(member.object_modified);

          if (Number.isNaN(objectModified.getTime())) {
            throw new BadRequestError({
              message: 'Component snapshot contains an invalid member revision',
              details:
                `Component ${snapshot.id} member ${member.object_ref} must identify ` +
                'an exact object_modified revision',
            });
          }

          return {
            ...member,
            object_modified: objectModified,
          };
        }),
      ),
    })),
  );
}

/**
 * Resolve the current virtual composition into concrete member revisions.
 *
 * @param {Object} snapshot - The current virtual track snapshot
 * @param {Map<string, Object>} registryMap - track_id → registry entry
 * @returns {Promise<Object>} Resolution result with members, quarantined, and metadata
 */
async function resolveComposition(snapshot, registryMap) {
  const composition = snapshot.composition;
  const componentTracks = composition.component_tracks || [];
  const strategy =
    (composition.deduplication && composition.deduplication.strategy) || 'prioritize_latest_object';

  const now = new Date();
  const componentSnapshotsMeta = [];
  const allAnnotatedMembers = [];

  // Resolve each component track in parallel
  const resolvedComponentSnapshots = await Promise.all(
    componentTracks.map((component) => resolveComponentSnapshot(component)),
  );
  const latestByObjectRef = new Map();
  const resolutions = await lockComponentMemberRevisions(
    resolvedComponentSnapshots,
    latestByObjectRef,
  );
  const { planPreviewMembers } = require('./versioning-service');
  for (let i = 0; i < componentTracks.length; i++) {
    if (
      componentTracks[i].resolution_strategy !== 'latest_preview' ||
      resolutions[i].version != null
    ) {
      continue;
    }
    try {
      resolutions[i].members = await planPreviewMembers(resolutions[i], latestByObjectRef);
    } catch (err) {
      if (!(err instanceof ReleaseConflictError)) throw err;
      throw new ReleaseConflictError(
        `Component track '${componentTracks[i].track_id}' cannot preview staged membership: ${err.message}`,
        { track_id: componentTracks[i].track_id, conflicts: err.conflicts },
      );
    }
  }
  const domainsByVersion = await hydrateDomains(componentTracks, resolutions);

  for (let i = 0; i < componentTracks.length; i++) {
    const component = componentTracks[i];
    const resolvedSnapshot = resolutions[i];
    const registry = registryMap.get(component.track_id);

    // Extract members from the resolved snapshot
    const sourceMembers = resolvedSnapshot.members || [];
    const totalObjectsInSource = sourceMembers.length;

    // Apply filters
    const filteredMembers = applyFilters(sourceMembers, component.filters, domainsByVersion);
    const objectsAfterFilter = filteredMembers.length;

    // Annotate each member with source metadata for deduplication
    for (const member of filteredMembers) {
      allAnnotatedMembers.push({
        object_ref: member.object_ref,
        object_modified: member.object_modified,
        _source_track_id: component.track_id,
        _source_track_name: registry.name,
        _source_snapshot_modified: resolvedSnapshot.modified,
        _source_snapshot_version: resolvedSnapshot.version,
        _source_priority: component.priority,
      });
    }

    // Build component resolution metadata
    componentSnapshotsMeta.push({
      track_id: component.track_id,
      track_name: registry.name,
      track_type: registry.type,
      resolved_snapshot_id: resolvedSnapshot.modified,
      resolved_version: resolvedSnapshot.version ?? null,
      strategy_used: component.resolution_strategy,
      filters_applied: component.filters || undefined,
      total_objects_in_source: totalObjectsInSource,
      objects_after_filter: objectsAfterFilter,
      objects_contributed: 0, // Updated after deduplication
    });
  }

  // Deduplicate across all components
  const { members, quarantined, contributions, report } = deduplicationStrategies.deduplicate(
    allAnnotatedMembers,
    strategy,
  );

  // Each surviving member is explicitly attributed to one source component
  // by deduplication, including exact revisions supplied by multiple tracks.
  const survivorSources = new Map();
  for (const contribution of contributions) {
    const count = survivorSources.get(contribution.source_track_id) || 0;
    survivorSources.set(contribution.source_track_id, count + 1);
  }

  for (const meta of componentSnapshotsMeta) {
    meta.objects_contributed = survivorSources.get(meta.track_id) || 0;
  }

  // Build composition_resolution
  const compositionResolution = {
    resolved_at: now,
    component_snapshots: componentSnapshotsMeta,
    deduplication: report,
    summary: {
      total_objects: members.length,
      quarantined_objects: quarantined.length,
    },
  };

  return { members, quarantined, compositionResolution };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Update the composition rules for a virtual track.
 *
 * Validates all component tracks exist and are standard tracks, then clones
 * the latest snapshot with the updated composition.
 *
 * @param {string} trackId
 * @param {Object} composition - The new composition configuration
 * @param {string} [userId] - Invoking snapshot creator
 * @param {Object} [options]
 * @param {Object} [options.scheduledMaterialization]
 * @returns {Promise<Object>} The new snapshot
 */
exports.updateComposition = async function updateComposition(
  trackId,
  composition,
  userId,
  options = {},
) {
  return require('./versioning-service').withReleaseLock(trackId, async (lease) => {
    const existing = await require('./draft-cleanup-service').findScheduledResult(
      trackId,
      options.scheduledMaterialization,
    );
    if (existing) return existing;
    const source = await snapshotService.getLatestSnapshot(trackId);
    assertVirtualTrack(source);

    // Validate all component tracks
    await validateComponentTracks(composition.component_tracks);

    const snapshot = await snapshotService.cloneSnapshot(
      trackId,
      source,
      {
        composition,
        members: [],
        quarantine: [],
        composition_resolution: null,
        scheduled_materialization: options.scheduledMaterialization,
      },
      { creationCause: CreationCause.CompositionUpdated, userAccountId: userId, lease },
    );

    logger.verbose(
      `VirtualTrackService: Updated composition for track "${trackId}" ` +
        `(${composition.component_tracks.length} component track(s))`,
    );
    return snapshot;
  });
};

/**
 * Replace the persisted materialization schedule for a virtual track.
 * The registry is authoritative so schedule changes do not create or mutate a
 * content snapshot. The scheduler reconciliation task observes the new value.
 *
 * @param {string} trackId
 * @param {Object} schedule
 * @returns {Promise<{snapshot_schedule: Object}>}
 */
exports.updateSchedule = async function updateSchedule(trackId, schedule) {
  const registry = await registryRepo.findByTrackId(trackId);
  if (!registry) {
    throw new TrackNotFoundError(trackId);
  }
  if (registry.type !== 'virtual') {
    throw new BadRequestError({
      message: 'This operation is only available for virtual release tracks',
      details: `Track ${trackId} is a ${registry.type} track`,
    });
  }

  const updated = await registryRepo.setSnapshotSchedule(trackId, schedule);
  logger.verbose(
    `VirtualTrackService: Updated snapshot schedule for track "${trackId}" to ${schedule.mode}`,
  );
  return { snapshot_schedule: updated.snapshot_schedule };
};

/**
 * Create a new virtual snapshot by resolving the composition rules.
 *
 * For each component track:
 *   1. Resolve the selected standard snapshot via the configured strategy
 *   2. Plan preview membership for drafts, then filter the resolved members
 * Then deduplicate across all components and persist a new draft snapshot.
 *
 * @param {string} trackId
 * @param {Object} [options] - { description?, userAccountId? }
 * @returns {Promise<Object>} The new snapshot with composition_resolution metadata
 */
exports.createVirtualSnapshot = async function createVirtualSnapshot(trackId, options = {}) {
  return require('./versioning-service').withReleaseLock(trackId, async (lease) => {
    const scheduledFor = options.scheduledMaterialization?.scheduled_for;
    const existing = await require('./draft-cleanup-service').findScheduledResult(
      trackId,
      options.scheduledMaterialization,
    );
    if (existing) return existing;

    const source = await snapshotService.getLatestSnapshot(trackId);
    assertVirtualTrack(source);

    const composition = source.composition;
    if (
      !composition ||
      !composition.component_tracks ||
      composition.component_tracks.length === 0
    ) {
      throw new BadRequestError({
        message: 'Cannot create virtual snapshot: no component tracks configured',
        details: 'Update the composition before creating a snapshot',
      });
    }

    // Hold component release locks from resolution through persistence. Rollback
    // cannot pass its dependency scan while a new dependent is being created.
    // Sorted acquisition and fail-fast conflicts also release partial lock sets.
    const componentIds = [
      ...new Set(composition.component_tracks.map((entry) => entry.track_id)),
    ].sort();
    const { withReleaseLock } = require('./versioning-service');
    const componentLeases = [];
    async function withComponentLocks(index) {
      if (index === componentIds.length) return materialize();
      return withReleaseLock(componentIds[index], (componentLease) => {
        componentLeases.push(componentLease);
        return withComponentLocks(index + 1);
      });
    }
    return withComponentLocks(0);

    async function materialize() {
      // Validate component tracks
      const registryMap = await validateComponentTracks(composition.component_tracks);

      // Resolve composition
      const { members, quarantined, compositionResolution } = await resolveComposition(
        source,
        registryMap,
      );
      await primaryRevisionService.assertStoredEntries([...members, ...quarantined]);
      const materializationLease = {
        async assertOwned() {
          await lease.assertOwned();
          for (const componentLease of componentLeases) await componentLease.assertOwned();
        },
      };

      // Build overrides for the new snapshot
      const overrides = {
        members,
        quarantine: quarantined,
        composition_resolution: compositionResolution,
        scheduled_materialization: options.scheduledMaterialization,
        snapshot_description: options.description,
      };

      let snapshot;
      try {
        snapshot = await snapshotService.cloneSnapshot(trackId, source, overrides, {
          lease: materializationLease,
          creationCause: options.scheduledMaterialization
            ? CreationCause.ScheduledSnapshot
            : CreationCause.ManualSnapshot,
          userAccountId:
            options.userAccountId || (options.scheduledMaterialization ? 'system' : undefined),
        });
      } catch (err) {
        if (!scheduledFor || !(err instanceof DuplicateIdError)) throw err;

        const existing = await dynamicRepo.getSnapshotByScheduledMaterialization(
          trackId,
          scheduledFor,
        );
        if (!existing) throw err;
        snapshot = existing;
      }

      logger.verbose(
        `VirtualTrackService: Created virtual snapshot for track "${trackId}" ` +
          `(${members.length} members, ${quarantined.length} quarantined)`,
      );
      return snapshot;
    }
  });
};

/**
 * Resolve one quarantined object by selecting its exact revision.
 *
 * The latest virtual snapshot is cloned into a new draft. The selected
 * revision becomes the sole member entry for its object_ref, and every
 * quarantined alternative for that object_ref is removed. The original
 * composition_resolution remains unchanged as materialization provenance.
 *
 * @param {string} trackId
 * @param {Object} selection - { object_ref, object_modified }
 * @returns {Promise<Object>} The new draft snapshot
 */
exports.promoteQuarantinedObject = async function promoteQuarantinedObject(
  trackId,
  selection,
  userId,
) {
  return require('./versioning-service').withReleaseLock(trackId, async (lease) => {
    const source = await snapshotService.getLatestSnapshot(trackId);
    assertVirtualTrack(source);

    const selectedTime = new Date(selection.object_modified).getTime();
    const selected = (source.quarantine || []).find(
      (entry) =>
        entry.object_ref === selection.object_ref &&
        new Date(entry.object_modified).getTime() === selectedTime,
    );

    if (!selected) {
      throw new NotFoundError({
        details:
          `Revision '${selection.object_modified}' of '${selection.object_ref}' ` +
          `was not found in the latest snapshot's quarantine tier`,
      });
    }

    const members = (source.members || [])
      .filter((entry) => entry.object_ref !== selected.object_ref)
      .concat({
        object_ref: selected.object_ref,
        object_modified: selected.object_modified,
      });
    const quarantine = (source.quarantine || []).filter(
      (entry) => entry.object_ref !== selected.object_ref,
    );
    await primaryRevisionService.assertStoredEntries([...members, ...quarantine]);

    const snapshot = await snapshotService.cloneSnapshot(
      trackId,
      source,
      {
        members,
        quarantine,
      },
      { creationCause: CreationCause.QuarantinePromoted, userAccountId: userId, lease },
    );

    logger.verbose(
      `VirtualTrackService: Promoted quarantined revision "${selected.object_ref}" ` +
        `at ${new Date(selected.object_modified).toISOString()} in track "${trackId}"`,
    );
    return snapshot;
  });
};
