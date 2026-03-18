# Notes

- Refactored the task scheduler
- Uses a new library for scheduling tasks: `node-schedule`
- Uses a new pattern for detecting tasks
  - The scheduler will attempt to load any tasks defined in any JS module located in `app/scheduler/` with the suffix, `-task` (e.g., `app/scheduler/foobar-task.js` will work but `app/scheduler/foo.js` will not)
  - All the scheduler does is load the task module. It is up to the module defining the task to (1) implement the task, (2) load the task with the `node-schedule` library, and (3) execute the loader in the global scope

Example:
```javascript
/**
 * Initialize and schedule this task
 */
function initializeTask() {
  const cronPattern = config.scheduler.myTaskNameCron;

  logger.info(`[here-is-my-task-name] Scheduling task with cron pattern: ${cronPattern}`);

  schedule.scheduleJob(cronPattern, async () => {
    try {
      await MYTASKTHATSHOULDRUN();
    } catch (err) {
      logger.error(`[here-is-my-task-name] Task execution failed: ${err.message}`);
    }
  });

  logger.info(`[here-is-my-task-name] Task scheduled successfully`);
}

if (config.scheduler.enableScheduler) { // <-- make sure to condition the task to only load if globally enabled!
  initializeTask();
}
```
- The old task scheduler (formerly known as the "collection manager") is now defined in `app/scheduler/sync-collection-indexes-task.js`
- Adds a new global runtime configuration setting for toggling on/off all scheduled tasks. The environment variable is `ENABLE_SCHEDULER` and it maps to `config.scheduler.enableScheduler`.
- Adds a new CRON pattern for configuring when tasks are scheduled.
  - The `SYNC_COLLECTION_INDEXES_CRON` environment variable is read at runtime to determine the periodicity that the scheduler should use for the former collection manager (now the `sync-collection-indexes-tasks`). It maps to `config.scheduler.syncCollectionIndexesCron`. 
  - Future tasks must follow a similar pattern:
    - Add the task file

## TODO

- [ ] Add robust documentation to `USAGE.md` explaining how task scheduling works and how to create new tasks
- [ ] In the future we should add the ability to dynamically load tasks without having to clone the repository and modify the `app/` source code. This new design pattern makes it possible to define them elsewhere and mount them via Docker volume.
- [ ] There is another task called `check-wip-attack-ids-task.js` that should probably be deleted
  -  It was created with the goal of restricting ATT&CK IDs to only exist on non-WIP objects
  -  That conversation is sort of out of scope
  -  I think we're going to move away from this approach and that the task will probably be moot