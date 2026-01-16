'use strict';

const notesService = require('../services/system/notes-service');
const logger = require('../lib/logger');
const {
  DuplicateIdError,
  InvalidQueryStringParameterError,
  BadlyFormattedParameterError,
} = require('../exceptions');

exports.retrieveAll = async function (req, res) {
  const options = {
    offset: req.query.offset || 0,
    limit: req.query.limit || 0,
    state: req.query.state,
    includeRevoked: req.query.includeRevoked,
    includeDeprecated: req.query.includeDeprecated,
    search: req.query.search,
    includePagination: req.query.includePagination,
    lastUpdatedBy: req.query.lastUpdatedBy,
  };

  try {
    const results = await notesService.retrieveAll(options);
    if (options.includePagination) {
      logger.debug(
        `Success: Retrieved ${results.data.length} of ${results.pagination.total} total note(s)`,
      );
    } else {
      logger.debug(`Success: Retrieved ${results.length} note(s)`);
    }
    return res.status(200).send(results);
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to get notes. Server error.');
  }
};

exports.retrieveById = async function (req, res) {
  const options = {
    versions: req.query.versions || 'latest',
  };

  try {
    const notes = await notesService.retrieveById(req.params.stixId, options);
    if (notes.length === 0) {
      return res.status(404).send('Note not found.');
    } else {
      logger.debug(`Success: Retrieved ${notes.length} note(s) with id ${req.params.stixId}`);
      return res.status(200).send(notes);
    }
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Badly formatted stix id: ' + req.params.stixId);
      return res.status(400).send('Stix id is badly formatted.');
    } else if (err instanceof InvalidQueryStringParameterError) {
      logger.warn('Invalid query string: versions=' + req.query.versions);
      return res.status(400).send('Query string parameter versions is invalid.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to get notes. Server error.');
    }
  }
};

exports.retrieveVersionById = async function (req, res) {
  try {
    const note = await notesService.retrieveVersionById(req.params.stixId, req.params.modified);
    if (!note) {
      return res.status(404).send('Note not found.');
    } else {
      logger.debug(`Success: Retrieved note with id ${note.id}`);
      return res.status(200).send(note);
    }
  } catch (err) {
    if (err instanceof BadlyFormattedParameterError) {
      logger.warn('Badly formatted stix id: ' + req.params.stixId);
      return res.status(400).send('Stix id is badly formatted.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to get note. Server error.');
    }
  }
};

exports.create = async function (req, res) {
  // Get the data from the request
  const noteData = req.body;
  const options = {
    import: false,
    userAccountId: req.user?.userAccountId,
  };

  // Create the note
  try {
    const note = await notesService.create(noteData, options);
    logger.debug('Success: Created note with id ' + note.stix.id);
    return res.status(201).send(note);
  } catch (err) {
    if (err instanceof DuplicateIdError) {
      logger.warn('Duplicate stix.id and stix.modified');
      return res
        .status(409)
        .send('Unable to create note. Duplicate stix.id and stix.modified properties.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to create note. Server error.');
    }
  }
};

exports.updateVersion = async function (req, res) {
  // Get the data from the request
  const noteData = req.body;

  // Create the note
  try {
    const note = await notesService.updateVersion(req.params.stixId, req.params.modified, noteData);
    if (!note) {
      return res.status(404).send('Note not found.');
    } else {
      logger.debug('Success: Updated note with id ' + note.stix.id);
      return res.status(200).send(note);
    }
  } catch (err) {
    logger.error('Failed with error: ' + err);
    return res.status(500).send('Unable to update note. Server error.');
  }
};

exports.deleteById = async function (req, res) {
  try {
    const results = await notesService.deleteById(req.params.stixId);
    if (results.deletedCount === 0) {
      return res.status(404).send('Note not found.');
    } else {
      logger.debug(`Success: Deleted note with id ${req.params.stixId}`);
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete note failed. ' + err);
    return res.status(500).send('Unable to delete note. Server error.');
  }
};

exports.deleteVersionById = async function (req, res) {
  try {
    const note = await notesService.deleteVersionById(req.params.stixId, req.params.modified);
    if (!note) {
      return res.status(404).send('Note not found.');
    } else {
      logger.debug(
        `Success: Deleted note with id ${note.stix.id} and modified ${note.stix.modified}`,
      );
      return res.status(204).end();
    }
  } catch (err) {
    logger.error('Delete note version failed. ' + err);
    return res.status(500).send('Unable to delete note. Server error.');
  }
};
