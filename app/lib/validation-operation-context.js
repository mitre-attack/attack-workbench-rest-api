'use strict';

// Shared operation state has no service or persistence dependencies.
module.exports = new (require('async_hooks').AsyncLocalStorage)();
