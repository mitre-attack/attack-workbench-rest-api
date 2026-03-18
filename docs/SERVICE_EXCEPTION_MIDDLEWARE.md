# Service Exception Middleware

The global error handler now includes middleware for catching well-defined service-layer exceptions. This eliminates the need for duplicate error handling logic in controllers.

## How It Works

The `serviceExceptions` middleware in [app/lib/error-handler.js](app/lib/error-handler.js) automatically catches all custom exceptions from [app/exceptions/index.js](app/exceptions/index.js) and maps them to appropriate HTTP status codes:

- **400 Bad Request**: User input errors (MissingParameterError, BadlyFormattedParameterError, InvalidQueryStringParameterError, ImmutablePropertyError, InvalidPostOperationError, InvalidTypeError, PropertyNotAllowedError, CannotUpdateStaticObjectError, BadRequestError)
- **404 Not Found**: Resource not found errors (NotFoundError, SystemConfigurationNotFound, OrganizationIdentityNotFoundError, AnonymousUserAccountNotFoundError, DefaultMarkingDefinitionsNotFoundError)
- **409 Conflict**: Duplicate resource errors (DuplicateIdError, DuplicateEmailError, DuplicateNameError)
- **500 Internal Server Error**: Service failures (IdentityServiceError, TechniquesServiceError, TacticsServiceError, GenericServiceError, DatabaseError)
- **501 Not Implemented**: Unimplemented functionality (NotImplementedError)
- **502 Bad Gateway**: External service connection errors (HostNotFoundError, ConnectionRefusedError)
- **503 Service Unavailable**: Configuration or HTTP errors (HTTPError, OrganizationIdentityNotSetError, AnonymousUserAccountNotSetError)

## Migration Guide

### Before (with manual exception handling)

```javascript
const {
  DuplicateIdError,
  BadlyFormattedParameterError,
  InvalidQueryStringParameterError,
  ImmutablePropertyError,
} = require('../exceptions');

exports.create = async function (req, res) {
  const analyticData = req.body;
  const options = {
    import: false,
    userAccountId: req.user?.userAccountId,
  };

  try {
    const analytic = await analyticsService.create(analyticData, options);
    logger.debug('Success: Created analytic with id ' + analytic.stix.id);
    return res.status(201).send(analytic);
  } catch (err) {
    if (err instanceof ImmutablePropertyError) {
      return res.status(400).send(err.message);
    }
    if (err instanceof DuplicateIdError) {
      logger.warn('Duplicate stix.id and stix.modified');
      return res.status(409).send('Unable to create analytic. Duplicate stix.id and stix.modified properties.');
    } else {
      logger.error('Failed with error: ' + err);
      return res.status(500).send('Unable to create analytic. Server error.');
    }
  }
};
```

### After (with automatic exception handling)

```javascript
exports.create = async function (req, res, next) {
  const analyticData = req.body;
  const options = {
    import: false,
    userAccountId: req.user?.userAccountId,
  };

  try {
    const analytic = await analyticsService.create(analyticData, options);
    logger.debug('Success: Created analytic with id ' + analytic.stix.id);
    return res.status(201).send(analytic);
  } catch (err) {
    // Pass the error to the next middleware - the serviceExceptions middleware will handle it
    return next(err);
  }
};
```

**Key changes:**
1. Add `next` parameter to the controller function
2. Remove all custom exception imports (unless needed for other logic)
3. Remove all `instanceof` checks for service exceptions
4. Simply call `next(err)` to pass exceptions to the middleware

### Even Simpler (no try-catch needed)

For controller functions that don't need any special success handling, you can use an async handler wrapper or simply let the error propagate:

```javascript
exports.create = async function (req, res, next) {
  const analyticData = req.body;
  const options = {
    import: false,
    userAccountId: req.user?.userAccountId,
  };

  const analytic = await analyticsService.create(analyticData, options).catch(next);
  if (!analytic) return; // catch(next) already handled the error

  logger.debug('Success: Created analytic with id ' + analytic.stix.id);
  return res.status(201).send(analytic);
};
```

## Benefits

1. **Consistency**: All exceptions are handled uniformly across the API
2. **Maintainability**: Exception handling logic is centralized in one place
3. **Reduced code**: Controllers are simpler and easier to read
4. **Fewer bugs**: Less chance of missing an exception case
5. **Better logging**: Consistent logging format for all exceptions

## Custom Exception Handling

If a controller needs custom handling for specific exceptions (e.g., different error messages or additional logic), it can still catch those exceptions before calling `next(err)`:

```javascript
exports.specialCase = async function (req, res, next) {
  try {
    const result = await someService.doSomething();
    return res.status(200).send(result);
  } catch (err) {
    // Custom handling for a specific case
    if (err instanceof DuplicateIdError && req.query.merge === 'true') {
      // Do something special for merge scenarios
      const merged = await someService.merge();
      return res.status(200).send(merged);
    }

    // All other exceptions handled by middleware
    return next(err);
  }
};
```
