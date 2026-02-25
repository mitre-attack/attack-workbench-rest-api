'use strict';

// =============================================================================
// Virtual Track Service
//
// Manages virtual release track operations: composition configuration and
// snapshot creation via resolution of component tracks.
//
// Virtual tracks aggregate content from multiple standard tracks by:
//   1. Resolving each component track to a specific tagged snapshot
//   2. Collecting members from each resolved snapshot
//   3. Applying per-component filters (object_types)
//   4. Deduplicating across all components
//   5. Persisting the result as a new draft snapshot
//
// See docs/COLLECTIONS_V2/04_VIRTUAL_TRACKS.md for full specification.
// =============================================================================

const snapshotService = require('./snapshot-service');
const dynamicRepo = require('../../repository/release-tracks/release-track-dynamic.repository');
const registryRepo = require('../../repository/release-tracks/release-track-registry.repository');
const deduplicationStrategies = require('../../lib/release-tracks/deduplication-strategies');
const logger = require('../../lib/logger');
const {
  BadRequestError,
  TrackNotFoundError,
  NoTaggedSnapshotsError,
  InvalidComponentTypeError,
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
    if (registry.type === 'virtual') {
      throw new InvalidComponentTypeError(component.track_id);
    }
    registryMap.set(component.track_id, registry);
  }

  return registryMap;
}

/**
 * Resolve a component track to a specific tagged snapshot based on its
 * resolution strategy.
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

    case 'specific_version':
      snapshot = await dynamicRepo.getSnapshotByVersion(component.track_id, component.version);
      break;

    case 'specific_snapshot':
      snapshot = await dynamicRepo.getSnapshotByModified(component.track_id, component.snapshot);
      break;

    default:
      throw new BadRequestError({
        message: `Unknown resolution strategy: ${component.resolution_strategy}`,
      });
  }

  if (!snapshot) {
    throw new NoTaggedSnapshotsError(component.track_id);
  }

  // For specific_snapshot strategy, the snapshot may be a draft — validate it's tagged
  if (snapshot.version == null) {
    throw new NoTaggedSnapshotsError(component.track_id);
  }

  return snapshot;
}

/**
 * Apply object_types filter to a list of member entries.
 * Filters by extracting the STIX type prefix from the object_ref
 * (e.g., "attack-pattern" from "attack-pattern--uuid").
 *
 * @param {Array<Object>} members - Member entries with object_ref
 * @param {Object} [filters] - { object_types?: string[], domains?: string[] }
 * @returns {Array<Object>} Filtered members
 */
function applyFilters(members, filters) {
  if (!filters) return members;

  let filtered = members;

  if (filters.object_types && filters.object_types.length > 0) {
    const allowedTypes = new Set(filters.object_types);
    filtered = filtered.filter((m) => {
      const stixType = m.object_ref.split('--')[0];
      return allowedTypes.has(stixType);
    });
  }

  // Note: domains filtering requires fetching full STIX objects, which is
  // deferred to Phase 6 (export-service). For now, domains filter is a no-op
  // logged as a warning.
  if (filters.domains && filters.domains.length > 0) {
    logger.warn(
      'VirtualTrackService: domains filter is not yet implemented (requires Phase 6 export infrastructure)',
    );
  }

  return filtered;
}

/**
 * Core composition resolution logic shared by createVirtualSnapshot and
 * previewVirtualSnapshot.
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
  const resolutions = await Promise.all(
    componentTracks.map((component) => resolveComponentSnapshot(component)),
  );

  for (let i = 0; i < componentTracks.length; i++) {
    const component = componentTracks[i];
    const resolvedSnapshot = resolutions[i];
    const registry = registryMap.get(component.track_id);

    // Extract members from the resolved snapshot
    const sourceMembers = resolvedSnapshot.members || [];
    const totalObjectsInSource = sourceMembers.length;

    // Apply filters
    const filteredMembers = applyFilters(sourceMembers, component.filters);
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
      resolved_version: resolvedSnapshot.version,
      strategy_used: component.resolution_strategy,
      filters_applied: component.filters || undefined,
      total_objects_in_source: totalObjectsInSource,
      objects_after_filter: objectsAfterFilter,
      objects_contributed: 0, // Updated after deduplication
    });
  }

  // Deduplicate across all components
  const { members, quarantined, report } = deduplicationStrategies.deduplicate(
    allAnnotatedMembers,
    strategy,
  );

  // Update objects_contributed per component by counting how many of each
  // component's members survived deduplication
  const survivorSources = new Map();
  for (const annotated of allAnnotatedMembers) {
    // Check if this specific entry survived deduplication
    const survived = members.some(
      (m) =>
        m.object_ref === annotated.object_ref &&
        new Date(m.object_modified).getTime() === new Date(annotated.object_modified).getTime(),
    );
    if (survived) {
      const count = survivorSources.get(annotated._source_track_id) || 0;
      survivorSources.set(annotated._source_track_id, count + 1);
    }
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
 * @param {string} [userId]
 * @returns {Promise<Object>} The new snapshot
 */
// eslint-disable-next-line no-unused-vars
exports.updateComposition = async function updateComposition(trackId, composition, userId) {
  const source = await snapshotService.getLatestSnapshot(trackId);
  assertVirtualTrack(source);

  // Validate all component tracks
  await validateComponentTracks(composition.component_tracks);

  const snapshot = await snapshotService.cloneSnapshot(trackId, source, { composition });

  logger.verbose(
    `VirtualTrackService: Updated composition for track "${trackId}" ` +
      `(${composition.component_tracks.length} component track(s))`,
  );
  return snapshot;
};

/**
 * Create a new virtual snapshot by resolving the composition rules.
 *
 * For each component track:
 *   1. Resolve to a tagged snapshot via the configured strategy
 *   2. Extract and filter members
 * Then deduplicate across all components and persist a new draft snapshot.
 *
 * @param {string} trackId
 * @param {Object} [options] - { description?, userAccountId? }
 * @returns {Promise<Object>} The new snapshot with composition_resolution metadata
 */
exports.createVirtualSnapshot = async function createVirtualSnapshot(trackId, options = {}) {
  const source = await snapshotService.getLatestSnapshot(trackId);
  assertVirtualTrack(source);

  const composition = source.composition;
  if (!composition || !composition.component_tracks || composition.component_tracks.length === 0) {
    throw new BadRequestError({
      message: 'Cannot create virtual snapshot: no component tracks configured',
      details: 'Update the composition before creating a snapshot',
    });
  }

  // Validate component tracks
  const registryMap = await validateComponentTracks(composition.component_tracks);

  // Resolve composition
  const { members, quarantined, compositionResolution } = await resolveComposition(
    source,
    registryMap,
  );

  // Build overrides for the new snapshot
  const overrides = {
    members,
    quarantine: quarantined,
    composition_resolution: compositionResolution,
  };

  if (options.description !== undefined) {
    overrides.description = options.description;
  }

  const snapshot = await snapshotService.cloneSnapshot(trackId, source, overrides);

  logger.verbose(
    `VirtualTrackService: Created virtual snapshot for track "${trackId}" ` +
      `(${members.length} members, ${quarantined.length} quarantined)`,
  );
  return snapshot;
};

/**
 * Preview what a virtual snapshot would contain without persisting.
 *
 * Runs the same resolution and deduplication logic as createVirtualSnapshot
 * but returns the results without saving a new snapshot.
 *
 * @param {string} trackId
 * @returns {Promise<Object>} Preview object with resolution details
 */
exports.previewVirtualSnapshot = async function previewVirtualSnapshot(trackId) {
  const source = await snapshotService.getLatestSnapshot(trackId);
  assertVirtualTrack(source);

  const composition = source.composition;
  if (!composition || !composition.component_tracks || composition.component_tracks.length === 0) {
    throw new BadRequestError({
      message: 'Cannot preview virtual snapshot: no component tracks configured',
      details: 'Update the composition before previewing a snapshot',
    });
  }

  // Validate component tracks
  const registryMap = await validateComponentTracks(composition.component_tracks);

  // Resolve composition (same logic, but we don't persist)
  const { members, quarantined, compositionResolution } = await resolveComposition(
    source,
    registryMap,
  );

  // Build comparison to the latest tagged version (if any)
  const existingMembers = source.members || [];
  const existingMemberRefs = new Set(existingMembers.map((m) => m.object_ref));
  const newMemberRefs = new Set(members.map((m) => m.object_ref));

  const newObjects = members.filter((m) => !existingMemberRefs.has(m.object_ref));
  const removedObjects = existingMembers.filter((m) => !newMemberRefs.has(m.object_ref));
  const updatedObjects = members.filter((m) => {
    const existing = existingMembers.find((e) => e.object_ref === m.object_ref);
    if (!existing) return false;
    return new Date(m.object_modified).getTime() !== new Date(existing.object_modified).getTime();
  });

  return {
    track_id: trackId,
    preview: true,
    composition_resolution: compositionResolution,
    members_count: members.length,
    quarantined_count: quarantined.length,
    comparison_to_current: {
      current_members_count: existingMembers.length,
      new_objects: newObjects.length,
      updated_objects: updatedObjects.length,
      removed_objects: removedObjects.length,
    },
  };
};
