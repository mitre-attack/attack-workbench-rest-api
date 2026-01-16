'use strict';

const EventEmitter = require('events');
const logger = require('./logger');

/**
 * Event bus for decoupling service interactions
 * Enables reactive, event-driven architecture for handling cross-document updates
 * Built on Node.js EventEmitter
 */
class EventBus extends EventEmitter {
  constructor() {
    super();

    // Increase max listeners since we may have multiple services subscribing to common events
    this.setMaxListeners(50);

    // Event log for debugging
    this.eventLog = [];
    this.maxLogSize = 1000;

    // Track original on() for logging
    this._originalOn = super.on.bind(this);
    this._originalEmit = super.emit.bind(this);
  }

  /**
   * Override on() to add logging
   * @param {string} eventName - Name of the event to listen for
   * @param {Function} listener - Function to handle the event
   * @returns {EventBus} this
   */
  on(eventName, listener) {
    const listenerName = listener.name || 'anonymous';
    logger.debug(`EventBus: Registered listener '${listenerName}' for '${eventName}'`);
    return this._originalOn(eventName, listener);
  }

  /**
   * Override emit() to add logging and handle async listeners
   * @param {string} eventName - Name of the event to emit
   * @param {object} payload - Data to pass to event handlers
   * @returns {Promise<void>}
   */
  async emit(eventName, payload) {
    const timestamp = new Date().toISOString();

    // Log the event
    this.logEvent({ eventName, payload, timestamp });

    logger.debug(`EventBus: Emitting '${eventName}'`);

    const listeners = this.listeners(eventName);
    if (listeners.length === 0) {
      logger.debug(`EventBus: No listeners for '${eventName}'`);
      return;
    }

    // Execute all listeners in parallel with Promise.allSettled
    const results = await Promise.allSettled(
      listeners.map(async (listener) => {
        try {
          const listenerName = listener.name || 'anonymous';
          logger.debug(`EventBus: Executing listener '${listenerName}' for '${eventName}'`);
          await listener(payload);
          logger.debug(`EventBus: Listener '${listenerName}' completed successfully`);
        } catch (error) {
          const listenerName = listener.name || 'anonymous';
          logger.error(`EventBus: Listener '${listenerName}' failed for '${eventName}':`, error);
          throw error;
        }
      }),
    );

    // Log any failures
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      logger.warn(
        `EventBus: ${failures.length}/${listeners.length} listeners failed for '${eventName}'`,
      );
    }
  }

  /**
   * Log an event for debugging and auditing
   * @param {object} event - Event details
   */
  logEvent(event) {
    this.eventLog.push(event);

    // Limit log size
    if (this.eventLog.length > this.maxLogSize) {
      this.eventLog.shift();
    }
  }

  /**
   * Get recent events for debugging
   * @param {number} limit - Number of recent events to return
   * @returns {Array} Recent events
   */
  getRecentEvents(limit = 50) {
    return this.eventLog.slice(-limit);
  }

  /**
   * Clear all listeners (useful for testing)
   */
  clear() {
    this.removeAllListeners();
    logger.debug('EventBus: Cleared all listeners');
  }
}

// Export singleton instance
module.exports = new EventBus();
