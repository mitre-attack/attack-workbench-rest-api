'use strict';

const service = require('../services/validation-reports-service');
const authz = require('../lib/authz-middleware');
exports.retrieve = async (req, res, next) => {
  let claims;
  try {
    claims = await service.claims(req.params.reportId);
  } catch (err) {
    return next(err);
  }
  if (!claims) return res.status(404).send({ message: 'Validation report is unavailable.' });
  const principal = service.principal(req.user);
  const isAdmin = !req.user.service && req.user.role === authz.userRoles.admin;
  if (!isAdmin && (!principal || JSON.stringify(principal) !== JSON.stringify(claims.owner)))
    return res.status(403).send({ message: 'You cannot access this validation report.' });
  authz.requireRole(claims.authorization.userRoles, claims.authorization.serviceRoles)(
    req,
    res,
    async () => {
      try {
        const result = await service.retrieve(req.params.reportId, req.query, claims);
        return res.status(result.status).json(result.body);
      } catch (err) {
        next(err);
      }
    },
  );
};
