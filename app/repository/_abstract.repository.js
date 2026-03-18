/* eslint-disable no-unused-vars */
// Note there is a bug in eslint where single line comment will not work ^
'use strict';

const { NotImplementedError } = require('../exceptions');

class AbstractRepository {
  /**
   * @description Retrieves documents based on the provided options.
   * @param {*} options Options object containing various filters and parameters for the search.
   * @returns {Array} Array of aggregated documents.
   */
  async retrieveAll(options) {
    throw new NotImplementedError(this.constructor.name, 'retrieveAll');
  }

  /**
   * @description Retrieves a document by its stixId.
   * @param {*} stixId The unique identifier for the document.
   * @returns {Object} The retrieved document.
   */
  async retrieveOneByStixId(stixId) {
    throw new NotImplementedError(this.constructor.name, 'retrieveOneById');
  }

  /**
   * @description Retrieves all documents by a specific stixId.
   * @param {*} stixId The unique identifier for the documents.
   * @returns {Array} Array of aggregated documents.
   */
  async retrieveAllByStixId(stixId) {
    throw new NotImplementedError(this.constructor.name, 'retrieveAllById');
  }

  /**
   * @description Retrieves the latest document by its stixId.
   * @param {*} stixId The unique identifier for the document.
   * @returns {Object} The retrieved document.
   */
  async retrieveLatestByStixIdLean(stixId) {
    throw new NotImplementedError(this.constructor.name, 'retrieveLatestByStixId');
  }

  /**
   * @description Retrieves a document by its stixId and modification date.
   * @param {*} stixId The unique identifier for the document.
   * @param {*} modified The modification date for the document.
   * @returns {Object} The retrieved document.
   */
  async retrieveOneByVersion(stixId, modified) {
    throw new NotImplementedError(this.constructor.name, 'retrieveOneByVersion');
  }

  /**
   * @description Saves the provided data.
   * @param {*} data The data to be saved.
   * @returns {Object} The saved document.
   */
  async save(data) {
    throw new NotImplementedError(this.constructor.name, 'save');
  }

  /**
   * @description Updates and saves the provided document.
   * @param {*} document The document to be updated.
   * @param {*} data The data for updating the document.
   * @returns {Object} The updated and saved document.
   */
  static async updateAndSave(document, data) {
    throw new NotImplementedError(this.constructor.name, 'updateAndSave');
  }

  /**
   * @description Retrieves and removes a document by its stixId and modification date.
   * @param {*} stixId The unique identifier for the document.
   * @param {*} modified The modification date for the document.
   * @returns {Object} The removed document.
   */
  async findOneAndDelete(stixId, modified) {
    throw new NotImplementedError(this.constructor.name, 'findOneAndDelete');
  }

  /**
   * @description Deletes many documents by a specific stixId.
   * @param {*} stixId The unique identifier for the documents.
   */
  async deleteMany(stixId) {
    throw new NotImplementedError(this.constructor.name, 'deleteMany');
  }
}

module.exports = AbstractRepository;
