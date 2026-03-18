'use strict';

const campaignsRepository = require('../../repository/campaigns-repository');
const { BaseService } = require('../meta-classes');
const { Campaign: CampaignType } = require('../../lib/types');

class CampaignService extends BaseService {}

module.exports = new CampaignService(CampaignType, campaignsRepository);
