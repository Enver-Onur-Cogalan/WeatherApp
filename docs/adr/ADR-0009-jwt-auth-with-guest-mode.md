# ADR-0009 — JWT authentication with a guest mode

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

The application will not be published to an app store, so authentication is not
commercially required. Local-only storage would be simpler.

Two arguments for building it anyway. It is genuinely needed: activity profiles belong
to a person, and one self-hosted instance serves a household. And its absence would be
read, correctly, as a gap — token rotation, secure storage, and rate limiting are
standard production concerns, and skipping them in a portfolio project invites the
conclusion that they are unfamiliar.

## Decision

Implement **JWT authentication with rotating refresh tokens**, plus a full-featured
**guest mode** that requires no account.

## Consequences

**Positive**

- Multi-user support on one instance.
- Demonstrates the production concerns above, deliberately and visibly.
- Guest mode removes the first-run barrier — a reader evaluating the project will not
  create an account to look around, and should not have to.
- "We store nothing unless you ask us to" is a genuine privacy position rather than a
  missing feature.

**Negative**

- Two code paths — authenticated and guest — through profile storage and sync.
- Guest-to-account migration must move local data up without loss or duplication. This
  is the fiddliest part of the feature and the one most likely to harbour bugs.
- Password reset requires email delivery, which is infrastructure a self-hosted instance
  may not have. Initial release ships without reset; the limitation is documented rather
  than half-implemented.

## Alternatives considered

| Option | Why not |
|---|---|
| No authentication | Simpler, but leaves an obvious gap in a project whose purpose is demonstrating completeness. |
| Session cookies | Poor fit for a mobile client; token-based is the idiomatic choice. |
| OAuth via a third party | Contradicts the self-hosted, no-external-dependency principle, and adds a provider the reader must configure. |
| Device-local only, no accounts | Considered seriously. Rejected because household multi-user is a real case, not a hypothetical one. |
