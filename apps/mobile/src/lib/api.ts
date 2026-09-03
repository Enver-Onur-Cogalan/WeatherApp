/**
 * Talking to the backend.
 *
 * Two things this layer insists on.
 *
 * **Responses are parsed, not cast.** `packages/schema` exists so the API contract and
 * the client cannot drift apart, and until now the mobile app declared its own copy of
 * every response type by hand — which is exactly the drift the package was built to
 * prevent, reintroduced one file later. Every response now goes through the generated Zod
 * schema, so a server that changes shape fails here with a description of what changed
 * rather than as `undefined` somewhere inside a Skia worklet.
 *
 * **Failures are named.** The interface has to say something specific and offer a fix
 * (docs/10), and it cannot do that from a boolean. `ApiError.kind` is the vocabulary the
 * screens speak: an unreachable server, a slow one, a forecast that could not be
 * retrieved, and a contract that no longer matches are four different sentences.
 */

import { z } from "zod";

import { getAccessToken, refreshAccessToken } from "@/lib/auth";
import { API_BASE_URL } from "@/lib/config";

export type ErrorKind =
  /** No API address is configured and no dev server to borrow one from. */
  | "unconfigured"
  /** The request never reached a server: wrong address, server down, no network. */
  | "unreachable"
  /** A server that took longer than we are willing to wait. */
  | "timeout"
  /** 503 — the backend could not retrieve a forecast and had nothing cached. */
  | "forecast_unavailable"
  /** Any other 5xx. The server is running and broken. */
  | "server"
  /** 4xx. We sent something the server would not accept; a bug on this side. */
  | "request"
  /** The response parsed as JSON but not as the schema. The contract has drifted. */
  | "contract"
  /** The endpoint needs an account and this device does not have a usable session. */
  | "unauthenticated";

export class ApiError extends Error {
  readonly kind: ErrorKind;
  readonly status: number | null;

  constructor(kind: ErrorKind, message: string, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

/** FastAPI's error body. Its `detail` is written for a developer, not for a person. */
const ProblemDetail = z.object({ detail: z.string() }).partial();

type PostOptions<T> = {
  path: string;
  body: unknown;
  schema: z.ZodType<T>;
  timeoutMs: number;
  signal?: AbortSignal;
};

export async function post<T>(options: PostOptions<T>): Promise<T> {
  try {
    return await attempt(options);
  } catch (error) {
    if (!(error instanceof ApiError) || error.kind !== "unauthenticated") throw error;

    // One refresh, one retry. `refreshAccessToken` is single-flight, so several requests
    // expiring together share a single rotation — presenting the same refresh token twice
    // is what the server treats as theft, and it would revoke the whole family.
    const refreshed = await refreshAccessToken();
    if (refreshed === null) throw error;

    return await attempt(options);
  }
}

async function attempt<T>({
  path,
  body,
  schema,
  timeoutMs,
  signal,
}: PostOptions<T>): Promise<T> {
  if (API_BASE_URL === null) {
    throw new ApiError(
      "unconfigured",
      "No API address. Set EXPO_PUBLIC_API_URL, or start the app from a dev server.",
    );
  }

  // Two reasons a request can stop early: our own deadline, and React Query cancelling
  // when the screen goes away. Both have to reach the same fetch.
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), timeoutMs);
  const onCancel = () => deadline.abort();
  signal?.addEventListener("abort", onCancel);

  let response: Response;
  try {
    const token = getAccessToken();
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Sent when we have one, on every request. An open endpoint ignores it; an
        // account-only one needs it; and neither has to be told which it is.
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: deadline.signal,
    });
  } catch (cause) {
    // `fetch` rejects identically for an aborted request and an unreachable host, so the
    // two are told apart by who did the aborting rather than by the error itself.
    if (signal?.aborted) throw cause;
    if (deadline.signal.aborted) {
      throw new ApiError("timeout", `No response within ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw new ApiError("unreachable", `Could not reach ${API_BASE_URL}.`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCancel);
  }

  if (!response.ok) {
    const detail = await readDetail(response);
    if (response.status === 401) {
      throw new ApiError("unauthenticated", detail, 401);
    }
    if (response.status === 503) {
      throw new ApiError("forecast_unavailable", detail, 503);
    }
    if (response.status >= 500) {
      throw new ApiError("server", detail, response.status);
    }
    throw new ApiError("request", detail, response.status);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError("contract", "The server's response was not JSON.", response.status);
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    // The first issue is enough to find the drift, and the whole tree is unreadable in a
    // toast. `packages/schema` is the fix for whatever this says.
    const [issue] = parsed.error.issues;
    const where = issue?.path.join(".") || "(root)";
    throw new ApiError(
      "contract",
      `Response did not match the schema at ${where}: ${issue?.message ?? "unknown"}.`,
      response.status,
    );
  }

  return parsed.data;
}

async function readDetail(response: Response): Promise<string> {
  try {
    const body = ProblemDetail.safeParse(await response.json());
    if (body.success && body.data.detail) return body.data.detail;
  } catch {
    // A non-JSON error body is not itself worth reporting; the status carries the news.
  }
  return `HTTP ${response.status}`;
}
