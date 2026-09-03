"""The account endpoints.

Five of them, and one shape running through all of them: the service layer raises, this
layer decides what the outside world is told. Registration and login deliberately reveal
less than they know — which address exists is not the client's business, and a 404 here
would answer that question for anyone who asked.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service
from app.auth.passwords import MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH
from app.core.deps import CurrentUser, RateLimiterDep
from app.db.session import get_session

router = APIRouter(prefix="/auth", tags=["auth"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=512)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class Account(BaseModel):
    id: str
    email: str


def _pair(tokens: service.Tokens) -> TokenPair:
    return TokenPair(
        access_token=tokens.access_token,
        refresh_token=tokens.refresh_token,
        expires_in=tokens.expires_in,
    )


@router.post(
    "/register",
    response_model=TokenPair,
    status_code=status.HTTP_201_CREATED,
    summary="Create an account",
    responses={409: {"description": "That address already has an account"}},
)
async def register(
    body: Credentials, session: SessionDep, request: Request, limiter: RateLimiterDep
) -> TokenPair:
    # Per-IP rather than per-account: there is no account yet, and the thing being
    # limited is someone enumerating addresses or filling the table.
    await limiter.check(f"register:{_client(request)}", limit=5, window_seconds=300)

    try:
        _, tokens = await service.register(session, body.email, body.password)
    except service.EmailTakenError as exc:
        # 409 does tell an attacker the address is taken. There is no way around that for
        # a self-service registration form — the alternative is silently not creating an
        # account, which breaks the honest case to inconvenience the dishonest one. The
        # rate limit above is the real mitigation.
        raise HTTPException(
            status.HTTP_409_CONFLICT, detail="An account with that address already exists"
        ) from exc

    return _pair(tokens)


@router.post(
    "/login",
    response_model=TokenPair,
    summary="Exchange credentials for tokens",
    responses={401: {"description": "Wrong address or password"}},
)
async def login(
    body: Credentials, session: SessionDep, request: Request, limiter: RateLimiterDep
) -> TokenPair:
    # Keyed on address *and* address-less IP so that neither a single account nor a
    # spray across many can be ground through. Credential stuffing is the threat docs/07
    # names, and it looks like the second.
    await limiter.check(
        f"login:{service.normalise_email(body.email)}", limit=10, window_seconds=300
    )
    await limiter.check(f"login-ip:{_client(request)}", limit=30, window_seconds=300)

    try:
        _, tokens = await service.login(session, body.email, body.password)
    except service.BadCredentialsError as exc:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Wrong address or password",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    return _pair(tokens)


@router.post(
    "/refresh",
    response_model=TokenPair,
    summary="Rotate the refresh token for a new pair",
    responses={401: {"description": "The refresh token is not usable"}},
)
async def refresh(body: RefreshRequest, session: SessionDep) -> TokenPair:
    try:
        tokens = await service.refresh(session, body.refresh_token)
    except service.InvalidRefreshError as exc:
        # One message for every reason. Distinguishing "already used" from "expired"
        # would tell whoever is holding a stolen token which one they have.
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            detail="Sign in again",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    return _pair(tokens)


@router.post(
    "/logout",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke the session this token belongs to",
)
async def logout(body: RefreshRequest, session: SessionDep) -> None:
    # Always 204, even for a token we have never seen. A client that has lost track of
    # its token still has to be able to reach a logged-out state.
    await service.logout(session, body.refresh_token)


@router.get(
    "/me",
    response_model=Account,
    summary="Who the access token belongs to",
    responses={401: {"description": "No usable access token"}},
)
async def me(user: CurrentUser) -> Account:
    return Account(id=str(user.id), email=user.email)


def _client(request: Request) -> str:
    """The caller's address, for rate limiting.

    Behind a reverse proxy every request appears to come from the proxy, which would make
    one bucket for the whole internet. `X-Forwarded-For` is trusted only for its leftmost
    entry and only because this service is expected to sit behind a proxy the operator
    runs themselves (docs/09) — it is spoofable when exposed directly, and the header is
    the operator's responsibility to strip at the edge.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
