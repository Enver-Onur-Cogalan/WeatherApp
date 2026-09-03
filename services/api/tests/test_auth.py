"""Accounts, tokens, and the rotation that makes a stolen one detectable.

The interesting tests are in `TestTheftDetection`. Everything above it is the groundwork
that has to hold for that to mean anything.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service
from app.auth.models import RefreshToken, User
from app.auth.passwords import hash_password, needs_rehash, verify_password
from app.auth.tokens import (
    TokenError,
    create_access_token,
    issue_refresh_token,
    read_access_token,
)

PASSWORD = "correct-horse-battery"


class TestPasswords:
    def test_a_hash_is_not_the_password(self) -> None:
        encoded = hash_password(PASSWORD)
        assert PASSWORD not in encoded
        assert encoded.startswith("$argon2id$")

    def test_the_same_password_hashes_differently_every_time(self) -> None:
        """Salted. Two identical passwords must not produce identical rows."""
        assert hash_password(PASSWORD) != hash_password(PASSWORD)

    def test_verification_accepts_the_password_and_nothing_else(self) -> None:
        encoded = hash_password(PASSWORD)
        assert verify_password(PASSWORD, encoded)
        assert not verify_password(PASSWORD + "x", encoded)

    def test_a_corrupt_hash_is_a_failed_login_not_a_crash(self) -> None:
        """The caller's correct response is the same as for a wrong password."""
        assert not verify_password(PASSWORD, "not-an-argon2-hash")

    def test_current_parameters_do_not_ask_for_a_rehash(self) -> None:
        assert not needs_rehash(hash_password(PASSWORD))


class TestAccessTokens:
    def test_a_token_round_trips_to_its_subject(self) -> None:
        user_id = uuid.uuid4()
        assert read_access_token(create_access_token(user_id)) == user_id

    def test_an_expired_token_is_rejected(self) -> None:
        past = datetime.now(UTC) - timedelta(hours=2)
        with pytest.raises(TokenError):
            read_access_token(create_access_token(uuid.uuid4(), now=past))

    def test_a_tampered_token_is_rejected(self) -> None:
        token = create_access_token(uuid.uuid4())
        head, payload, signature = token.split(".")
        with pytest.raises(TokenError):
            read_access_token(f"{head}.{payload}.{signature[:-4]}AAAA")

    def test_the_algorithm_is_pinned(self) -> None:
        """`alg: none` is the oldest JWT forgery and it verifies anything."""
        import base64
        import json

        def segment(data: dict[str, object]) -> str:
            raw = json.dumps(data).encode()
            return base64.urlsafe_b64encode(raw).decode().rstrip("=")

        forged = ".".join(
            [
                segment({"alg": "none", "typ": "JWT"}),
                segment({"sub": str(uuid.uuid4()), "type": "access"}),
                "",
            ]
        )
        with pytest.raises(TokenError):
            read_access_token(forged)

    def test_a_refresh_token_is_not_an_access_token(self) -> None:
        """They are different kinds of secret and must not be interchangeable."""
        with pytest.raises(TokenError):
            read_access_token(issue_refresh_token().token)


class TestRefreshTokenIssue:
    def test_the_stored_value_is_a_digest_not_the_token(self) -> None:
        issued = issue_refresh_token()
        assert issued.token not in issued.token_hash
        assert len(issued.token_hash) == 64

    def test_two_tokens_are_never_the_same(self) -> None:
        assert issue_refresh_token().token != issue_refresh_token().token

    def test_continuing_a_family_keeps_its_id(self) -> None:
        first = issue_refresh_token()
        second = issue_refresh_token(family_id=first.family_id)
        assert second.family_id == first.family_id
        assert second.token != first.token


@pytest.mark.asyncio
class TestRegistration:
    async def test_registering_returns_a_usable_pair(
        self, client: AsyncClient, unique_email: str
    ) -> None:
        response = await client.post(
            "/auth/register", json={"email": unique_email, "password": PASSWORD}
        )
        assert response.status_code == 201
        body = response.json()
        assert read_access_token(body["access_token"])
        assert body["refresh_token"]
        assert body["token_type"] == "bearer"

    async def test_the_address_is_taken_only_once(
        self, client: AsyncClient, unique_email: str
    ) -> None:
        await client.post("/auth/register", json={"email": unique_email, "password": PASSWORD})
        again = await client.post(
            "/auth/register", json={"email": unique_email, "password": PASSWORD}
        )
        assert again.status_code == 409

    async def test_case_does_not_make_a_second_account(
        self, client: AsyncClient, unique_email: str
    ) -> None:
        """Every mail system treats these as one address, so we must too."""
        await client.post("/auth/register", json={"email": unique_email, "password": PASSWORD})
        shouted = await client.post(
            "/auth/register", json={"email": unique_email.upper(), "password": PASSWORD}
        )
        assert shouted.status_code == 409

    async def test_a_short_password_is_refused(
        self, client: AsyncClient, unique_email: str
    ) -> None:
        response = await client.post(
            "/auth/register", json={"email": unique_email, "password": "short"}
        )
        assert response.status_code == 422

    async def test_the_password_is_never_stored(
        self, client: AsyncClient, session: AsyncSession, unique_email: str
    ) -> None:
        await client.post("/auth/register", json={"email": unique_email, "password": PASSWORD})
        user = await session.scalar(select(User).where(User.email == unique_email))
        assert user is not None
        assert PASSWORD not in user.password_hash


@pytest.mark.asyncio
class TestLogin:
    async def test_correct_credentials_are_accepted(
        self, client: AsyncClient, unique_email: str
    ) -> None:
        await client.post("/auth/register", json={"email": unique_email, "password": PASSWORD})
        response = await client.post(
            "/auth/login", json={"email": unique_email, "password": PASSWORD}
        )
        assert response.status_code == 200
        assert read_access_token(response.json()["access_token"])

    async def test_a_wrong_password_is_refused(
        self, client: AsyncClient, unique_email: str
    ) -> None:
        await client.post("/auth/register", json={"email": unique_email, "password": PASSWORD})
        response = await client.post(
            "/auth/login", json={"email": unique_email, "password": "wrong-but-long-enough"}
        )
        assert response.status_code == 401

    async def test_an_unknown_address_gives_the_same_answer(
        self, client: AsyncClient, unique_email: str
    ) -> None:
        """The status and the wording must not reveal which addresses have accounts."""
        await client.post("/auth/register", json={"email": unique_email, "password": PASSWORD})
        wrong_password = await client.post(
            "/auth/login", json={"email": unique_email, "password": "wrong-but-long-enough"}
        )
        no_account = await client.post(
            "/auth/login", json={"email": "nobody@example.com", "password": PASSWORD}
        )
        assert wrong_password.status_code == no_account.status_code == 401
        assert wrong_password.json() == no_account.json()


@pytest.mark.asyncio
class TestRotation:
    async def test_refreshing_returns_a_different_pair(
        self, client: AsyncClient, unique_email: str
    ) -> None:
        first = (
            await client.post(
                "/auth/register", json={"email": unique_email, "password": PASSWORD}
            )
        ).json()

        second = await client.post(
            "/auth/refresh", json={"refresh_token": first["refresh_token"]}
        )
        assert second.status_code == 200
        assert second.json()["refresh_token"] != first["refresh_token"]

    async def test_the_new_token_stays_in_the_same_family(
        self, session: AsyncSession, unique_email: str
    ) -> None:
        _, first = await service.register(session, unique_email, PASSWORD)
        await session.flush()
        second = await service.refresh(session, first.refresh_token)
        await session.flush()

        rows = (await session.scalars(select(RefreshToken))).all()
        assert len({row.family_id for row in rows}) == 1
        assert second.refresh_token != first.refresh_token

    async def test_an_unknown_token_is_refused(self, client: AsyncClient) -> None:
        response = await client.post("/auth/refresh", json={"refresh_token": "not-a-token"})
        assert response.status_code == 401

    async def test_an_expired_token_is_refused(
        self, session: AsyncSession, unique_email: str
    ) -> None:
        _, tokens = await service.register(session, unique_email, PASSWORD)
        await session.flush()

        row = await session.scalar(select(RefreshToken))
        assert row is not None
        row.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await session.flush()

        with pytest.raises(service.InvalidRefreshError):
            await service.refresh(session, tokens.refresh_token)


@pytest.mark.asyncio
class TestTheftDetection:
    """The reason rotation exists.

    A legitimate client presents each refresh token exactly once. A second presentation
    means two parties hold the same secret, and there is no way to tell which one is the
    owner — so both are logged out. Revoking only the replayed token would leave the
    thief's newer token working and log out the victim instead, which is the wrong
    direction to be wrong in.
    """

    async def test_replaying_a_used_token_is_refused(
        self, client: AsyncClient, unique_email: str
    ) -> None:
        first = (
            await client.post(
                "/auth/register", json={"email": unique_email, "password": PASSWORD}
            )
        ).json()
        await client.post("/auth/refresh", json={"refresh_token": first["refresh_token"]})

        replay = await client.post(
            "/auth/refresh", json={"refresh_token": first["refresh_token"]}
        )
        assert replay.status_code == 401

    async def test_a_replay_revokes_the_whole_family(
        self, client: AsyncClient, unique_email: str
    ) -> None:
        """Including the token the thief just obtained, which is the point."""
        first = (
            await client.post(
                "/auth/register", json={"email": unique_email, "password": PASSWORD}
            )
        ).json()
        second = (
            await client.post("/auth/refresh", json={"refresh_token": first["refresh_token"]})
        ).json()

        # The victim's client refreshes again with the token it still holds — the one
        # already exchanged. That is the signal.
        await client.post("/auth/refresh", json={"refresh_token": first["refresh_token"]})

        stolen = await client.post(
            "/auth/refresh", json={"refresh_token": second["refresh_token"]}
        )
        assert stolen.status_code == 401, "the newest token in a compromised family must die"

    async def test_one_family_dying_does_not_touch_another(
        self, client: AsyncClient, unique_email: str
    ) -> None:
        """A phone being compromised must not log the tablet out."""
        phone = (
            await client.post(
                "/auth/register", json={"email": unique_email, "password": PASSWORD}
            )
        ).json()
        tablet = (
            await client.post("/auth/login", json={"email": unique_email, "password": PASSWORD})
        ).json()

        await client.post("/auth/refresh", json={"refresh_token": phone["refresh_token"]})
        await client.post("/auth/refresh", json={"refresh_token": phone["refresh_token"]})

        survivor = await client.post(
            "/auth/refresh", json={"refresh_token": tablet["refresh_token"]}
        )
        assert survivor.status_code == 200


@pytest.mark.asyncio
class TestLogout:
    async def test_logging_out_ends_the_session(
        self, client: AsyncClient, unique_email: str
    ) -> None:
        tokens = (
            await client.post(
                "/auth/register", json={"email": unique_email, "password": PASSWORD}
            )
        ).json()

        assert (
            await client.post("/auth/logout", json={"refresh_token": tokens["refresh_token"]})
        ).status_code == 204

        after = await client.post(
            "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
        )
        assert after.status_code == 401

    async def test_logging_out_an_unknown_token_still_succeeds(
        self, client: AsyncClient
    ) -> None:
        """A client that has lost its token still has to reach a logged-out state."""
        response = await client.post("/auth/logout", json={"refresh_token": "never-existed"})
        assert response.status_code == 204


@pytest.mark.asyncio
class TestWhoAmI:
    async def test_a_token_identifies_its_owner(
        self, client: AsyncClient, unique_email: str
    ) -> None:
        tokens = (
            await client.post(
                "/auth/register", json={"email": unique_email, "password": PASSWORD}
            )
        ).json()
        response = await client.get(
            "/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"}
        )
        assert response.status_code == 200
        assert response.json()["email"] == unique_email

    async def test_no_token_is_a_401_here(self, client: AsyncClient) -> None:
        assert (await client.get("/auth/me")).status_code == 401

    async def test_a_rubbish_token_is_a_401_here(self, client: AsyncClient) -> None:
        response = await client.get("/auth/me", headers={"Authorization": "Bearer nonsense"})
        assert response.status_code == 401


@pytest.mark.asyncio
class TestGuestMode:
    """A guest is the absence of an account, not an account with a flag (ADR-0009).

    The planning endpoints have to work with no credentials at all, or the guest mode the
    whole design rests on does not exist.
    """

    async def test_planning_works_with_no_credentials(self, client: AsyncClient) -> None:
        response = await client.post(
            "/plan",
            json={
                "latitude": 41.0082,
                "longitude": 28.9784,
                "timezone": "Europe/Istanbul",
                "profile": {
                    "activity": "running",
                    "temp_min": 5,
                    "temp_max": 26,
                    "wind_max_kmh": 15,
                    "precip_max_pct": 20,
                    "preferred_hours": [6, 10],
                    "uv_max": 6,
                },
            },
        )
        # 503 is an unreachable forecast, which is still not an auth failure — the point
        # here is only that nothing asks a guest to sign in.
        assert response.status_code != 401

    async def test_a_bad_token_does_not_lock_a_guest_out(self, client: AsyncClient) -> None:
        """An expired token on an open endpoint should serve a guest, not fail."""
        response = await client.post(
            "/plan",
            headers={"Authorization": "Bearer expired-nonsense"},
            json={
                "latitude": 41.0082,
                "longitude": 28.9784,
                "timezone": "Europe/Istanbul",
                "profile": {
                    "activity": "running",
                    "temp_min": 5,
                    "temp_max": 26,
                    "wind_max_kmh": 15,
                    "precip_max_pct": 20,
                    "preferred_hours": [6, 10],
                    "uv_max": 6,
                },
            },
        )
        assert response.status_code != 401


@pytest.mark.asyncio
class TestDeletionIsReal:
    async def test_deleting_an_account_takes_its_tokens(
        self, session: AsyncSession, unique_email: str
    ) -> None:
        """docs/12: no soft delete. A privacy claim the code does not honour is worse
        than no claim, so the cascade is checked rather than assumed."""
        user, _ = await service.register(session, unique_email, PASSWORD)
        await session.flush()
        assert (await session.scalars(select(RefreshToken))).all()

        await session.delete(user)
        await session.flush()

        assert not (await session.scalars(select(RefreshToken))).all()
