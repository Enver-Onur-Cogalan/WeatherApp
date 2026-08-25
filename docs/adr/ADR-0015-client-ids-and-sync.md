# ADR-0015 — Client-generated ids, server authority, last-write-wins

- **Status:** Accepted
- **Date:** 2026-08-25

## Context

Three facts collide. The app has a **guest mode** with no account and no network
([ADR-0009](./ADR-0009-jwt-auth-with-guest-mode.md)). It is **offline-first**, so edits
must succeed with no connectivity. And it has **accounts**, so a household can share one
instance across devices.

Together these mean records are created where no server can number them, and the same
record can be edited in two places.

## Decision

Three rules, in order.

1. **Ids are UUIDv7, generated on the device.**
2. **The server is authoritative** once an account exists; the device holds a copy and
   queues its edits.
3. **Conflicts resolve last-write-wins per record**, compared on `updated_at`.

## Consequences

**Positive**

- A guest creates profiles and locations with no network and no round-trip. Nothing about
  the offline path is a special case waiting to be tested.
- Signing up is an **insert, not a remap**. Ids created before the account survive it, so
  no local reference is rewritten and no foreign key is patched.
- UUIDv7 sorts by creation time, so lists have a natural order without a separate column,
  and index locality is close to a sequential key rather than random like UUIDv4.
- Last-write-wins is a few lines. There is no merge engine to write, test, or debug.

**Negative**

- **Silent loss is possible.** Two devices editing the same profile while both offline:
  the later `updated_at` wins and the other edit is gone, with no notification. This is
  the real cost of the decision and it is not hidden.
- Clock skew decides the winner. A device with a wrong clock can beat a newer edit. The
  server stamps `updated_at` on receipt where it can, which narrows the window but does not
  close it for offline queues.
- 128-bit keys are wider than integers, in every index and every payload. Irrelevant at
  this scale, but real.

## Alternatives considered

| Option | Why not |
|---|---|
| **Server-assigned integer ids** | Simplest when online, and unworkable here: a guest with no network could not create anything, and signing up would renumber every local record and every reference to it. |
| **Field-level merge** | Would fix the silent-loss case for the common shape of conflict — two people changing different fields of the same profile. Rejected for now as more machinery than a household-scale app editing a handful of records justifies, but it is the natural next step if the assumption proves wrong. |
| **CRDTs** | Correct, and enormously out of proportion. The dataset is a few profiles and locations per person. |
| **No sync — device-local only** | Considered and rejected with [ADR-0009](./ADR-0009-jwt-auth-with-guest-mode.md): a household sharing one instance is the case accounts exist for. |
| **UUIDv4** | Same benefits for offline creation, but random ordering hurts index locality and gives no free chronological sort. v7 costs nothing over it. |

## When to revisit

If multi-device editing turns out to be common rather than incidental — the signal would be
users reporting changes that "did not stick" — the answer is field-level merge, not a
larger rewrite. The id scheme and server authority both survive that change; only the
conflict rule moves.
