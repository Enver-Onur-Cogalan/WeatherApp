"""Password hashing.

Argon2id, at parameters tuned so that hashing costs roughly 100 ms on the target hardware
(docs/07). The cost is the point: it is what makes a leaked table expensive to attack, and
100 ms is a number a person logging in does not notice and an attacker grinding a
wordlist very much does.

No hints, no security questions, no maximum length, and no character-class rules. Length
is what matters, and a composition rule mostly produces `Passw0rd!`.
"""

from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError

# argon2-cffi's defaults, stated rather than inherited: a default that changes underneath
# a stored hash is a migration nobody planned. `verify` reads the parameters back out of
# the encoded hash, so raising these later re-hashes on next login rather than locking
# anyone out — see `needs_rehash`.
HASHER = PasswordHasher(
    time_cost=3,
    memory_cost=64 * 1024,  # 64 MiB
    parallelism=4,
    hash_len=32,
    salt_len=16,
)

# Long enough to matter, bounded only so that a megabyte of input cannot be turned into a
# denial of service by way of the hasher.
MIN_PASSWORD_LENGTH = 10
MAX_PASSWORD_LENGTH = 256


def hash_password(password: str) -> str:
    return HASHER.hash(password)


def verify_password(password: str, encoded: str) -> bool:
    """Whether the password matches, without leaking why it does not.

    A malformed stored hash returns False rather than raising: it is a corrupt row, and
    the caller's only correct response is the same as for a wrong password.
    """
    try:
        return HASHER.verify(encoded, password)
    except (VerifyMismatchError, InvalidHashError):
        return False


def needs_rehash(encoded: str) -> bool:
    """Whether this hash was made with parameters we have since raised."""
    try:
        return HASHER.check_needs_rehash(encoded)
    except InvalidHashError:
        return True
