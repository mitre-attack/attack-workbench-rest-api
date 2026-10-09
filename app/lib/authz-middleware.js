'use strict';

const config = require('../config/config');
const logger = require('../lib/logger');

const userRoles = {
  admin: 'admin',
  editor: 'editor',
  visitor: 'visitor',
  teamLead: 'team_lead',
};
exports.userRoles = userRoles;
exports.admin = [userRoles.admin];
exports.teamLeadOrHigher = [userRoles.admin, userRoles.teamLead];
exports.editorOrHigher = [userRoles.admin, userRoles.editor, userRoles.teamLead];
exports.visitorOrHigher = [
  userRoles.admin,
  userRoles.editor,
  userRoles.visitor,
  userRoles.teamLead,
];

const serviceRoles = {
  readOnly: 'read-only',
  collectionManager: 'collection-manager',
  stixExport: 'stix-export',
};
exports.serviceRoles = serviceRoles;
exports.readOnlyService = [serviceRoles.readOnly];

/**
 * This middleware function verifies that a request is authorized.
 */
exports.requireRole = function (allowedUserRoles, allowedServiceRoles) {
  return function (req, res, next) {
    const authorized = () => {
      req.validationReportAuthorization = {
        userRoles: allowedUserRoles || [],
        serviceRoles: allowedServiceRoles || [],
      };
      return next();
    };
    if (!req.user) {
      return res.status(401).send('Not authorized');
    }

    if (req.user.service) {
      if (req.user.serviceName) {
        // apikey service
        let serviceConfig;
        if (req.user.strategy === 'bearer') {
          serviceConfig = config.serviceAuthn.challengeApikey.serviceAccounts.find(
            (s) => s.name === req.user.serviceName,
          );
        } else if (req.user.strategy === 'basic') {
          serviceConfig = config.serviceAuthn.basicApikey.serviceAccounts.find(
            (s) => s.name === req.user.serviceName,
          );
        }

        if (
          serviceConfig &&
          allowedServiceRoles &&
          allowedServiceRoles.includes(serviceConfig.serviceRole)
        ) {
          return authorized();
        } else {
          logger.verbose(`Service not authorized. Service name is ${req.user.serviceName}`);
          return res.status(401).send('Not authorized');
        }
      } else if (req.user.clientId) {
        // client credentials service
        const serviceConfig = config.serviceAuthn.oidcClientCredentials.clients.find(
          (c) => c.clientId === req.user.clientId,
        );
        if (
          serviceConfig &&
          allowedServiceRoles &&
          allowedServiceRoles.includes(serviceConfig.serviceRole)
        ) {
          return authorized();
        } else {
          logger.verbose(`Service not authorized. Client Id is ${req.user.clientId}`);
          return res.status(401).send('Not authorized');
        }
      } else {
        logger.verbose('Service not authorized. Missing serviceName and clientId');
        return res.status(401).send('Not authorized');
      }
    } else if (allowedUserRoles && allowedUserRoles.includes(req.user.role)) {
      return authorized();
    } else {
      logger.verbose(`User not authorized. User role is ${req.user.role}`);
      return res.status(401).send('Not authorized');
    }
  };
};
