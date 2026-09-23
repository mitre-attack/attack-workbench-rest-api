# Deletion Guardrails

These safeguards prevent automatic cleanup from **recreating snapshots, deleting a newly tagged release, or leaving the database inconsistent if an operation fails halfway through**.

They are implementation requirements for the proposed features—not additional settings you would need to manage.

## 1. “Scheduler receipts must survive snapshot deletion”

**The system needs to remember that a scheduled run already happened, even after its snapshot has been deleted.**

Suppose a virtual track creates a snapshot every hour:

1. The 10:00 scheduled run creates snapshot A.
2. The server crashes before recording that the scheduled run finished.
3. After restarting, the scheduler sees the unfinished 10:00 run and considers retrying it.

Today, the scheduler can find snapshot A and conclude: “The snapshot was already created; I just need to finish recording success.”

Automatic truncation introduces a problem:

4. Newer snapshots are created, and retention deletes A.
5. The scheduler retries the unfinished 10:00 run.
6. It cannot find A, so it could create another snapshot for the same scheduled occurrence.

That replacement might contain different content because the component tracks have changed since 10:00.

### The safeguard

Keep a small, separate record—a **receipt**—saying:

> The 10:00 occurrence already created snapshot A.

Deleting A must not delete that receipt. A retry then knows that the work already happened and must not repeat it.

The backend already has records for scheduled occurrences, so we can build on those rather than introduce a separate scheduling system. These small records would remain even while the much larger snapshot history and associated metadata are trimmed.

---

## 2. “Serialize the virtual target’s lifecycle”

Here, **serialize** means “make conflicting operations take turns.” The **target** is the virtual track being changed.

Two operations can happen at almost the same time:

- The scheduler creates a draft and starts pruning old drafts.
- A user tags one of those old drafts as a release.

Without coordination, this sequence is possible:

1. Cleanup checks snapshot A and sees that it is an old draft.
2. The user tags A as a release.
3. Cleanup deletes A based on its earlier check.

That would violate our most important rule: **never delete tagged releases.**

There is another possible race: one operation reads a snapshot as the basis for a new draft while another deletes that snapshot and cleans up metadata the new draft still needs.

### The safeguard

Use a database-backed lock for the affected virtual track. Conceptually:

> “I’m changing this track’s snapshots. Another conflicting operation cannot change them until I finish.”

The backend already uses this locking mechanism for releases and some other operations. We need to extend its coverage so virtual-track creation and cleanup participate too.

We should also make the final deletion conditional:

> Delete A only if it is **still an eligible draft**.

That provides an additional check rather than trusting an earlier decision.

This does **not** mean stopping all Workbench activity. It coordinates conflicting changes to the affected track. Under the existing locking convention, a competing operation may receive a conflict response and need to retry.

---

## 3. “Make cleanup recoverable”

**Cleanup has several steps. A failure halfway through must not lose the new release or leave cleanup permanently unfinished.**

For example, a user tags a draft and requests squashing:

1. The release is successfully created.
2. Cleanup deletes three earlier drafts.
3. The database connection fails before the remaining seven drafts are deleted.

At that point, two different things are true:

- **The release succeeded.**
- **Cleanup is incomplete.**

It would be misleading to show only “Release failed—try again.” Retrying the tagging operation is not the right way to finish deleting old drafts.

### The safeguard

Record the cleanup request and its progress separately. The system can then report:

> Release created successfully. Draft cleanup is incomplete and can be retried.

A retry should finish only the remaining cleanup. It must not create another release, change the released contents, or broaden the set of drafts originally approved for deletion.

### Shared metadata also needs care

Snapshots can share a **content manifest**: a stored list of the exact object versions and relationships needed to reproduce their exports.

If drafts A and B share the same manifest:

- Deleting A must leave the manifest intact because B still needs it.
- Deleting the last snapshot that references that manifest can make the manifest eligible for removal.

Cleanup must also update snapshot counts, so the UI does not report snapshots that no longer exist.

None of this should delete the underlying ATT&CK/STIX objects. We are removing obsolete snapshot history and metadata that no surviving snapshot needs.

---

In short:

| Safeguard | What it prevents |
|---|---|
| Keep scheduler receipts | A deleted scheduled snapshot being recreated by a retry |
| Coordinate conflicting operations | Cleanup deleting something that another operation just released or still needs |
| Record and resume cleanup | Partial failures leaving misleading results, stale counts, or unfinished database cleanup |

The intended user experience remains simple: configure a retention count, or check a squash option when releasing. These safeguards make those actions safe behind the scenes.
