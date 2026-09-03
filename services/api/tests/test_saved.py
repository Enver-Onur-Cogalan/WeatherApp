"""Profiles and locations: ownership, conflicts, and the invariants the database holds.

Three groups matter more than the rest. `TestOwnership` is the security boundary — one
account must not be able to see or touch another's rows. `TestLastWriteWins` is ADR-0015
made concrete. `TestTheDatabaseHoldsTheRules` checks the constraints actually exist,
because a constraint that was never exercised is a comment with a `CREATE` statement
attached.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service as auth_service
from app.saved.models import SavedLocation, SavedProfile

PASSWORD = "correct-horse-battery"

CONSTRAINTS = {
    "activity": "running",
    "temp_min": 5,
    "temp_max": 26,
    "wind_max_kmh": 15,
    "precip_max_pct": 20,
    "preferred_hours": [6, 10],
    "uv_max": 6,
}


def profile_body(name: str = "Sabah koşusu", updated_at: datetime | None = None) -> dict:
    return {
        "name": name,
        "constraints": CONSTRAINTS,
        "updated_at": (updated_at or datetime.now(UTC)).isoformat(),
    }


def location_body(
    label: str = "Ev", is_current: bool = False, updated_at: datetime | None = None
) -> dict:
    return {
        "label": label,
        "latitude": 41.0082,
        "longitude": 28.9784,
        "timezone": "Europe/Istanbul",
        "is_current": is_current,
        "sort_order": 0,
        "updated_at": (updated_at or datetime.now(UTC)).isoformat(),
    }


async def account(client: AsyncClient) -> dict[str, str]:
    """A registered account, and the header that authenticates it."""
    email = f"user-{uuid.uuid4().hex[:12]}@example.com"
    tokens = (
        await client.post("/auth/register", json={"email": email, "password": PASSWORD})
    ).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


@pytest.mark.asyncio
class TestProfiles:
    async def test_a_new_profile_is_created(self, client: AsyncClient) -> None:
        headers = await account(client)
        profile_id = str(uuid.uuid4())

        response = await client.put(
            f"/profiles/{profile_id}", json=profile_body(), headers=headers
        )
        assert response.status_code == 201
        body = response.json()
        assert body["id"] == profile_id
        assert body["name"] == "Sabah koşusu"
        assert body["constraints"]["preferred_hours"] == [6, 10]

    async def test_the_client_chooses_the_id(self, client: AsyncClient) -> None:
        """ADR-0015. A guest creates profiles offline, and signing up renumbers nothing."""
        headers = await account(client)
        chosen = str(uuid.uuid4())

        await client.put(f"/profiles/{chosen}", json=profile_body(), headers=headers)
        listed = (await client.get("/profiles", headers=headers)).json()

        assert [row["id"] for row in listed] == [chosen]

    async def test_putting_twice_replaces_rather_than_duplicates(
        self, client: AsyncClient
    ) -> None:
        """Which is what makes a retry after a dropped response harmless."""
        headers = await account(client)
        profile_id = str(uuid.uuid4())
        now = datetime.now(UTC)

        await client.put(
            f"/profiles/{profile_id}", json=profile_body(updated_at=now), headers=headers
        )
        second = await client.put(
            f"/profiles/{profile_id}",
            json=profile_body(name="Akşam koşusu", updated_at=now + timedelta(minutes=1)),
            headers=headers,
        )

        assert second.status_code == 200
        listed = (await client.get("/profiles", headers=headers)).json()
        assert len(listed) == 1
        assert listed[0]["name"] == "Akşam koşusu"

    async def test_an_impossible_temperature_range_is_refused(
        self, client: AsyncClient
    ) -> None:
        headers = await account(client)
        body = profile_body()
        body["constraints"] = {**CONSTRAINTS, "temp_min": 30, "temp_max": 10}

        response = await client.put(f"/profiles/{uuid.uuid4()}", json=body, headers=headers)
        assert response.status_code == 422

    async def test_deleting_removes_it(self, client: AsyncClient) -> None:
        headers = await account(client)
        profile_id = str(uuid.uuid4())
        await client.put(f"/profiles/{profile_id}", json=profile_body(), headers=headers)

        assert (
            await client.delete(f"/profiles/{profile_id}", headers=headers)
        ).status_code == 204
        assert (await client.get("/profiles", headers=headers)).json() == []

    async def test_deleting_something_absent_is_a_404(self, client: AsyncClient) -> None:
        headers = await account(client)
        response = await client.delete(f"/profiles/{uuid.uuid4()}", headers=headers)
        assert response.status_code == 404


@pytest.mark.asyncio
class TestOwnership:
    """The security boundary. Everything else here is correctness; this is safety."""

    async def test_one_account_cannot_see_anothers_profiles(self, client: AsyncClient) -> None:
        mine = await account(client)
        theirs = await account(client)

        await client.put(f"/profiles/{uuid.uuid4()}", json=profile_body(), headers=mine)

        assert (await client.get("/profiles", headers=theirs)).json() == []

    async def test_one_account_cannot_overwrite_anothers_profile(
        self, client: AsyncClient
    ) -> None:
        """The id is public once it is on a device; ownership is what protects the row.

        Writing this test found a real defect. The lookup is scoped by owner, so an
        intruder's PUT saw nothing of its own and went on to insert — colliding with the
        global primary key and surfacing a 500 from inside the driver. That is both an
        unhelpful answer and a usable oracle for whether an id exists. It is a 409 now,
        and the owner's record is untouched either way.
        """
        mine = await account(client)
        theirs = await account(client)
        profile_id = str(uuid.uuid4())

        await client.put(
            f"/profiles/{profile_id}", json=profile_body(name="Benim"), headers=mine
        )
        intruder = await client.put(
            f"/profiles/{profile_id}", json=profile_body(name="Onların"), headers=theirs
        )

        assert intruder.status_code == 409
        untouched = (await client.get("/profiles", headers=mine)).json()
        assert untouched[0]["name"] == "Benim"
        assert (await client.get("/profiles", headers=theirs)).json() == []

    async def test_one_account_cannot_delete_anothers_profile(
        self, client: AsyncClient
    ) -> None:
        mine = await account(client)
        theirs = await account(client)
        profile_id = str(uuid.uuid4())
        await client.put(f"/profiles/{profile_id}", json=profile_body(), headers=mine)

        assert (
            await client.delete(f"/profiles/{profile_id}", headers=theirs)
        ).status_code == 404
        assert len((await client.get("/profiles", headers=mine)).json()) == 1

    async def test_a_guest_gets_401_rather_than_an_empty_list(
        self, client: AsyncClient
    ) -> None:
        """A guest has nothing here by design — but silence would look like "no profiles"."""
        assert (await client.get("/profiles")).status_code == 401
        assert (await client.get("/locations")).status_code == 401


@pytest.mark.asyncio
class TestLastWriteWins:
    """ADR-0015, made concrete.

    The rule costs something and the ADR says so: two devices editing while both offline
    means one edit disappears. What the server must not do is drop it *quietly* — a write
    that loses comes back with the record that won.
    """

    async def test_an_older_write_does_not_overwrite_a_newer_one(
        self, client: AsyncClient
    ) -> None:
        headers = await account(client)
        profile_id = str(uuid.uuid4())
        now = datetime.now(UTC)

        await client.put(
            f"/profiles/{profile_id}",
            json=profile_body(name="Yeni", updated_at=now),
            headers=headers,
        )
        stale = await client.put(
            f"/profiles/{profile_id}",
            json=profile_body(name="Eski", updated_at=now - timedelta(hours=1)),
            headers=headers,
        )

        assert stale.status_code == 409
        assert stale.json()["name"] == "Yeni", "the loser is told what it lost to"

    async def test_the_same_timestamp_is_treated_as_stale(self, client: AsyncClient) -> None:
        """A resend of what the server already holds changes nothing, and says so."""
        headers = await account(client)
        profile_id = str(uuid.uuid4())
        now = datetime.now(UTC)
        body = profile_body(updated_at=now)

        await client.put(f"/profiles/{profile_id}", json=body, headers=headers)
        again = await client.put(f"/profiles/{profile_id}", json=body, headers=headers)

        assert again.status_code == 409

    async def test_a_newer_write_wins(self, client: AsyncClient) -> None:
        headers = await account(client)
        profile_id = str(uuid.uuid4())
        now = datetime.now(UTC)

        await client.put(
            f"/profiles/{profile_id}",
            json=profile_body(name="Önce", updated_at=now),
            headers=headers,
        )
        newer = await client.put(
            f"/profiles/{profile_id}",
            json=profile_body(name="Sonra", updated_at=now + timedelta(seconds=1)),
            headers=headers,
        )

        assert newer.status_code == 200
        assert newer.json()["name"] == "Sonra"


@pytest.mark.asyncio
class TestLocations:
    async def test_a_place_round_trips(self, client: AsyncClient) -> None:
        headers = await account(client)
        location_id = str(uuid.uuid4())

        created = await client.put(
            f"/locations/{location_id}", json=location_body(), headers=headers
        )
        assert created.status_code == 201
        assert created.json()["timezone"] == "Europe/Istanbul"

    async def test_coordinates_keep_five_decimals(self, client: AsyncClient) -> None:
        """`numeric(8,5)` is about a metre, and exact — a float would drift in the last
        digit and make two clients disagree about a record neither has edited."""
        headers = await account(client)
        body = location_body()
        body["latitude"] = 41.00821
        body["longitude"] = 28.97841

        created = await client.put(f"/locations/{uuid.uuid4()}", json=body, headers=headers)
        assert created.json()["latitude"] == 41.00821
        assert created.json()["longitude"] == 28.97841

    async def test_marking_a_place_current_stands_the_previous_one_down(
        self, client: AsyncClient
    ) -> None:
        headers = await account(client)
        first, second = str(uuid.uuid4()), str(uuid.uuid4())

        await client.put(
            f"/locations/{first}",
            json=location_body(label="Ev", is_current=True),
            headers=headers,
        )
        await client.put(
            f"/locations/{second}",
            json=location_body(label="İş", is_current=True),
            headers=headers,
        )

        listed = (await client.get("/locations", headers=headers)).json()
        current = [row["label"] for row in listed if row["is_current"]]
        assert current == ["İş"]

    async def test_two_accounts_may_each_have_a_current_place(
        self, client: AsyncClient
    ) -> None:
        """The uniqueness is per account, not global — the index includes `user_id`."""
        mine = await account(client)
        theirs = await account(client)

        first = await client.put(
            f"/locations/{uuid.uuid4()}", json=location_body(is_current=True), headers=mine
        )
        second = await client.put(
            f"/locations/{uuid.uuid4()}",
            json=location_body(is_current=True),
            headers=theirs,
        )
        assert first.status_code == second.status_code == 201


@pytest.mark.asyncio
class TestTheDatabaseHoldsTheRules:
    """A constraint nothing has ever violated is a comment with a `CREATE` attached.

    These bypass the API deliberately: the handlers check these rules too, and the point
    is that the database would still refuse if a future handler forgot.
    """

    async def test_an_impossible_temperature_range_is_refused_by_postgres(
        self, session: AsyncSession, unique_email: str
    ) -> None:
        user, _ = await auth_service.register(session, unique_email, PASSWORD)
        await session.flush()

        session.add(
            SavedProfile(
                id=uuid.uuid4(),
                user_id=user.id,
                name="Imkânsız",
                activity="running",
                temp_min=30,
                temp_max=10,
                wind_max_kmh=15,
                precip_max_pct=20,
                preferred_hours=[6, 10],
                updated_at=datetime.now(UTC),
            )
        )
        with pytest.raises(IntegrityError):
            await session.flush()

    async def test_two_current_locations_are_refused_by_postgres(
        self, session: AsyncSession, unique_email: str
    ) -> None:
        user, _ = await auth_service.register(session, unique_email, PASSWORD)
        await session.flush()

        for label in ("Ev", "İş"):
            session.add(
                SavedLocation(
                    id=uuid.uuid4(),
                    user_id=user.id,
                    label=label,
                    latitude=41.0,
                    longitude=29.0,
                    timezone="Europe/Istanbul",
                    is_current=True,
                    sort_order=0,
                    updated_at=datetime.now(UTC),
                )
            )
        with pytest.raises(IntegrityError):
            await session.flush()

    async def test_many_non_current_locations_are_fine(
        self, session: AsyncSession, unique_email: str
    ) -> None:
        """The partial index must not turn into a unique constraint on `user_id`."""
        user, _ = await auth_service.register(session, unique_email, PASSWORD)
        await session.flush()

        for label in ("Ev", "İş", "Yazlık"):
            session.add(
                SavedLocation(
                    id=uuid.uuid4(),
                    user_id=user.id,
                    label=label,
                    latitude=41.0,
                    longitude=29.0,
                    timezone="Europe/Istanbul",
                    is_current=False,
                    sort_order=0,
                    updated_at=datetime.now(UTC),
                )
            )
        await session.flush()

        rows = (await session.scalars(select(SavedLocation))).all()
        assert len(rows) == 3

    async def test_timestamps_come_back_with_a_timezone(
        self, session: AsyncSession, unique_email: str
    ) -> None:
        """docs/12: storage is UTC. A naive timestamp is a bug waiting for a DST boundary."""
        user, _ = await auth_service.register(session, unique_email, PASSWORD)
        await session.flush()

        stored = await session.scalar(text("SELECT now() AT TIME ZONE 'UTC'"))
        assert stored is not None

        row = SavedProfile(
            id=uuid.uuid4(),
            user_id=user.id,
            name="Koşu",
            activity="running",
            temp_min=5,
            temp_max=26,
            wind_max_kmh=15,
            precip_max_pct=20,
            preferred_hours=[6, 10],
            updated_at=datetime.now(UTC),
        )
        session.add(row)
        await session.flush()
        await session.refresh(row)
        assert row.created_at.tzinfo is not None


@pytest.mark.asyncio
class TestDeletionCascades:
    async def test_deleting_an_account_takes_its_profiles_and_places(
        self, session: AsyncSession, unique_email: str
    ) -> None:
        """docs/12: deletion is real deletion, and the cascade is the whole claim."""
        user, _ = await auth_service.register(session, unique_email, PASSWORD)
        await session.flush()

        session.add(
            SavedProfile(
                id=uuid.uuid4(),
                user_id=user.id,
                name="Koşu",
                activity="running",
                temp_min=5,
                temp_max=26,
                wind_max_kmh=15,
                precip_max_pct=20,
                preferred_hours=[6, 10],
                updated_at=datetime.now(UTC),
            )
        )
        session.add(
            SavedLocation(
                id=uuid.uuid4(),
                user_id=user.id,
                label="Ev",
                latitude=41.0,
                longitude=29.0,
                timezone="Europe/Istanbul",
                is_current=True,
                sort_order=0,
                updated_at=datetime.now(UTC),
            )
        )
        await session.flush()

        await session.delete(user)
        await session.flush()

        assert not (await session.scalars(select(SavedProfile))).all()
        assert not (await session.scalars(select(SavedLocation))).all()
