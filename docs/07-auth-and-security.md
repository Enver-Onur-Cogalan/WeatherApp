# 07 — Authentication and Security

## Why a self-hosted app has accounts

The application is never going to a public app store, so authentication is not a
commercial requirement. It is here for two reasons.

First, it is real: activity profiles and saved locations belong to a person, and a
household running one instance has more than one person in it.

Second, a portfolio project that skips authentication invites the conclusion that the
author has not built one. Production concerns — token rotation, secret storage, rate
limiting, migrations — are exactly the things that separate a demo from a system.

See [ADR-0009](./adr/ADR-0009-jwt-auth-with-guest-mode.md).

## Token design

| Token | Lifetime | Stored where | Purpose |
|---|---|---|---|
| Access | 15 minutes | Memory only, on the client | Sent with every request |
| Refresh | 30 days, rotating | `expo-secure-store` (Keychain / Keystore) | Obtains a new access token |

**Rotation:** each refresh issues a new refresh token and invalidates the old one. If an
invalidated token is presented, the entire token family is revoked — that pattern means
a token was stolen, and the safe response is to log everyone on that family out.

**Never in AsyncStorage.** It is unencrypted and readable on a rooted or jailbroken
device. The refresh token is the long-lived credential and belongs in the platform
keystore.

## Passwords

Argon2id, with parameters tuned so hashing takes roughly 100 ms on the target hardware.
No password hints, no security questions, no maximum length, and no character-class
rules — length is what matters.

## Guest mode

A user can use the entire application without an account. Data lives on the device;
nothing is sent to the account service.

This exists because the first person to open a portfolio project will not create an
account to look around, and because "we do not collect anything unless you ask us to"
is a defensible privacy position rather than a compromise.

Upgrading a guest to an account migrates the local profiles up. It does not start over.

## Secrets

- No secrets in the mobile bundle. A React Native bundle is trivially extracted; anything
  shipped inside it is public. This is one of the reasons a backend exists at all.
- `.env.example` is committed with every key documented and every value blank.
- The container runs as a non-root user.
- CI fails on committed secrets via a scanning step.

## Transport and input

- HTTPS enforced; certificate pinning is deliberately skipped, since the service is
  self-hosted at an address the user chooses.
- Every request body is a Pydantic model. Unvalidated input never reaches business logic.
- Rate limiting per account and per IP, backed by Redis.

## Threat model, stated honestly

This is a self-hosted application handling low-sensitivity data: locations and activity
preferences. It is not handling payments or health records, and the security work here
is proportionate to that.

What we defend against: token theft from a lost device, credential stuffing, a
malicious client sending malformed input, and one user monopolising a shared local
model.

What we do not defend against: an attacker who already controls the host running the
service. At that point the database is theirs and no application-level control changes
that.
