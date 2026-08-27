"""Test-wide setup.

`Settings` requires a JWT secret with no default, so the service refuses to start
without one (docs/07). Tests need a value, and it must be obviously fake — a plausible
looking secret in a test file is the kind of thing that gets copied into a deployment.
"""

from __future__ import annotations

import os

os.environ.setdefault("JWT_SECRET", "test-secret-not-for-use-anywhere-real-0123456789")
os.environ.setdefault("ENVIRONMENT", "test")
