"""The boundary between the agent and whatever is generating text.

A protocol rather than a direct Ollama client, for two reasons. Tests need to exercise
the orchestrator without a model on the machine, and the whole orchestration has to stay
describable in terms of what it asks for — tools, or a schema — rather than in terms of
one vendor's request shape.

Everything here is local-only by design (ADR-0004). There is no hosted branch to fall
back to, because a fallback would silently become the real path and the local one would
rot untested.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from app.core.logging import get_logger

logger = get_logger(__name__)


class ModelUnavailableError(RuntimeError):
    """Ollama could not be reached, or answered with something unusable.

    Distinct from a bad answer: the caller degrades to the deterministic path rather than
    retrying, because retrying a model that is not running never succeeds.
    """


@dataclass(frozen=True, slots=True)
class ToolCall:
    name: str
    arguments: dict[str, Any]


@dataclass(frozen=True, slots=True)
class Completion:
    """One model turn.

    `tool_calls` and `text` are not exclusive in the wire format, but a turn that
    produced tool calls is a turn whose text we do not use — the agent asked for tools
    and got them.
    """

    text: str
    tool_calls: tuple[ToolCall, ...] = ()
    duration_ms: int = 0
    eval_tokens: int = 0

    @property
    def called_tools(self) -> bool:
        return bool(self.tool_calls)


@dataclass(frozen=True, slots=True)
class Message:
    role: str
    content: str
    # Carries a tool result back to the model. Ollama expects the name alongside it.
    name: str | None = None


class Provider(Protocol):
    """What the orchestrator needs, and nothing else.

    The two calls are deliberately separate rather than one call with optional
    arguments: ADR-0006 exists because asking for tools and a schema together drops
    tool calling to zero, and a single method taking both would invite exactly that.
    """

    async def call_tools(
        self, messages: list[Message], tools: list[dict[str, Any]], *, think: bool = False
    ) -> Completion:
        """Phase one. Tools declared, no schema constraint."""
        ...

    async def structured(
        self, messages: list[Message], schema: dict[str, Any], *, think: bool = False
    ) -> Completion:
        """Phase two. Schema constrained, no tools."""
        ...

    async def available(self) -> bool:
        """Whether the model is reachable and pulled."""
        ...


@dataclass
class OllamaProvider:
    """Ollama over HTTP.

    `think` defaults to false everywhere. Measured on this project's own model, enabling
    it cost 12.1s against 0.6s and 347 output tokens against 28 — twenty times the
    latency for a single-step task (docs/05). It is switched on only where the task is
    genuinely multi-step.
    """

    base_url: str
    model: str
    timeout_seconds: int = 120
    client: httpx.AsyncClient | None = None
    _extra: dict[str, Any] = field(default_factory=dict)

    async def _chat(self, payload: dict[str, Any]) -> dict[str, Any]:
        body = {"model": self.model, "stream": False, "options": {"temperature": 0}, **payload}
        url = f"{self.base_url.rstrip('/')}/api/chat"
        try:
            if self.client is not None:
                response = await self.client.post(
                    url, json=body, timeout=float(self.timeout_seconds)
                )
            else:
                async with httpx.AsyncClient(timeout=float(self.timeout_seconds)) as client:
                    response = await client.post(url, json=body)
            response.raise_for_status()
            data: dict[str, Any] = response.json()
        except httpx.HTTPError as exc:
            raise ModelUnavailableError(f"Ollama request failed: {exc}") from exc
        except ValueError as exc:
            raise ModelUnavailableError("Ollama returned a body that is not JSON") from exc
        return data

    @staticmethod
    def _to_completion(data: dict[str, Any]) -> Completion:
        message = data.get("message") or {}
        raw_calls = message.get("tool_calls") or []
        calls = tuple(
            ToolCall(
                name=str(call.get("function", {}).get("name", "")),
                # Ollama sends arguments as an object, but a model that has drifted can
                # send a JSON string. Both are handled where the call is dispatched.
                arguments=dict(call.get("function", {}).get("arguments") or {}),
            )
            for call in raw_calls
            if call.get("function", {}).get("name")
        )
        return Completion(
            text=str(message.get("content") or ""),
            tool_calls=calls,
            duration_ms=int(data.get("total_duration", 0) / 1_000_000),
            eval_tokens=int(data.get("eval_count") or 0),
        )

    async def call_tools(
        self, messages: list[Message], tools: list[dict[str, Any]], *, think: bool = False
    ) -> Completion:
        return self._to_completion(
            await self._chat(
                {
                    "messages": [_wire(m) for m in messages],
                    "tools": tools,
                    "think": think,
                }
            )
        )

    async def structured(
        self, messages: list[Message], schema: dict[str, Any], *, think: bool = False
    ) -> Completion:
        # `format` compiles the schema into a grammar and constrains the sampler — on a
        # GGUF build. On MLX it is accepted and silently ignored, which is why the
        # default model is a GGUF one (ADR-0011).
        return self._to_completion(
            await self._chat(
                {
                    "messages": [_wire(m) for m in messages],
                    "format": schema,
                    "think": think,
                }
            )
        )

    async def available(self) -> bool:
        try:
            url = f"{self.base_url.rstrip('/')}/api/tags"
            if self.client is not None:
                response = await self.client.get(url, timeout=3.0)
            else:
                async with httpx.AsyncClient(timeout=3.0) as client:
                    response = await client.get(url)
            response.raise_for_status()
            names = {model.get("name") for model in response.json().get("models", [])}
        except (httpx.HTTPError, ValueError, KeyError):
            return False
        return self.model in names


def _wire(message: Message) -> dict[str, Any]:
    out: dict[str, Any] = {"role": message.role, "content": message.content}
    if message.name is not None:
        out["name"] = message.name
    return out
