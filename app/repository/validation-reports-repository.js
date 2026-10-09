'use strict';

const reports = require('../models/validation-report-model');
const applications = require('../models/validation-report-application-model');
exports.model = reports;
exports.applicationsModel = applications;
exports.save = async (report, rows) => {
  await reports.create({ ...report, state: 'building' });
  try {
    for (let offset = 0; offset < rows.length; offset += 500) {
      await applications.insertMany(
        rows.slice(offset, offset + 500).map((row, index) => ({
          ...row,
          reportId: report._id,
          ordinal: offset + index,
          expiresAt: report.expiresAt,
        })),
      );
    }
    await reports.updateOne({ _id: report._id }, { $set: { state: report.state } });
  } catch (err) {
    await Promise.allSettled([
      reports.deleteOne({ _id: report._id }),
      applications.deleteMany({ reportId: report._id }),
    ]);
    throw err;
  }
};
exports.retrieve = (id) => reports.findById(id).lean().exec();
exports.query = (id, filters) => ({
  reportId: id,
  ...(filters.statuses.length ? { retirementStatus: { $in: filters.statuses } } : {}),
  ...(filters.ruleIds.length ? { ruleId: { $in: filters.ruleIds } } : {}),
});
exports.summary = (id, filters) =>
  applications.aggregate([
    { $match: exports.query(id, filters) },
    {
      $group: {
        _id: { ruleId: '$ruleId', ruleName: '$ruleName', retirementStatus: '$retirementStatus' },
        count: { $sum: 1 },
      },
    },
  ]);
exports.revisionCount = async (id, filters) => {
  const result = await applications.aggregate([
    { $match: exports.query(id, filters) },
    { $group: { _id: { id: '$object_ref', modified: '$object_modified' } } },
    { $count: 'count' },
  ]);
  return result[0]?.count || 0;
};
exports.page = (id, filters, offset, limit) =>
  applications
    .find(exports.query(id, filters))
    .sort({ ordinal: 1 })
    .skip(offset)
    .limit(limit)
    .select('-_id -reportId -ordinal -expiresAt')
    .lean()
    .exec();

// Reports and cursors survive API restarts without depending on random session defaults.
exports.loadKey = async () => {
  const model = require('../models/validation-report-key-model');
  let value;
  try {
    value = await model
      .findOneAndUpdate(
        { _id: 'report-key' },
        { $setOnInsert: { secret: require('crypto').randomBytes(32).toString('hex') } },
        { upsert: true, new: true },
      )
      .lean()
      .exec();
  } catch (err) {
    if (err.code !== 11000) throw err;
    value = await model.findById('report-key').lean().exec();
    if (!value) throw err;
  }
  return Buffer.from(value.secret, 'hex');
};
