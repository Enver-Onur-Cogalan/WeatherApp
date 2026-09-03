"""Issuing and reading the two kinds of token.

The access token is a signed JWT the service can verify without touching the database —
that is the whole reason it is short-lived. The refresh token is not a JWT at all: it is
opaque random bytes with a row behind it, because it has to be revocable, and a stateless
token that can be revoked is a stateful token wearing a costume.
"""

from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import jwt

from app.core.config import get_settings

ALGORITHM = "HS256"

# Names the claim by what it is, so an access token can never be mistaken for a refresh
# token by a handler that only checks the signature.
ACCESS_TYPE = "access"


class TokenError(Exception):
    """The token was absent, malformed, expired, or not the type expected."""


@dataclass(frozen=True, slots=True)
class IssuedRefresh:
    """What the client is given, and what the database keeps.

    They are deliberately different: the client holds the secret, the row holds a digest
    of it. A dump of the table is then not a set of working credentials.
    """

    token: str
    token_hash: str
    family_id: uuid.UUID
    expires_at: datetime


def create_access_token(user_id: uuid.UUID, now: datetime | None = None) -> str:
    settings = get_settings()
    issued = now or datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": ACCESS_TYPE,
        "iat": int(issued.timestamp()),
        "exp": int((issued + timedelta(minutes=settings.access_token_ttl_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=ALGORITHM)


def read_access_token(token: str) -> uuid.UUID:
    """The subject of a valid access token, or `TokenError`.

    The algorithm is pinned. Accepting whatever the header names is the classic JWT
    forgery: `alg: none` verifies anything, and an asymmetric key confused for an HMAC
    secret lets a public key sign tokens.
    """
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[ALGORITHM])
    except jwt.PyJWTError as exc:
        raise TokenError(str(exc)) from exc

    if payload.get("type") != ACCESS_TYPE:
        raise TokenError("not an access token")

    subject = payload.get("sub")
    try:
        return uuid.UUID(str(subject))
    except ValueError as exc:
        raise TokenError("subject is not a uuid") from exc


def issue_refresh_token(
    family_id: uuid.UUID | None = None, now: datetime | None = None
) -> IssuedRefresh:
    """A new refresh token, continuing a family or starting one.

    256 bits from `secrets`, which is why the stored digest is a plain SHA-256 rather than
    Argon2id: there is no guessing to slow down, and refresh happens often enough that a
    deliberately slow hash would be felt on every cycle.
    """
    issued = now or datetime.now(UTC)
    settings = get_settings()
    token = secrets.token_urlsafe(32)
    return IssuedRefresh(
        token=token,
        token_hash=hash_refresh_token(token),
        family_id=family_id or uuid.uuid4(),
        expires_at=issued + timedelta(days=settings.refresh_token_ttl_days),
    )


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()
