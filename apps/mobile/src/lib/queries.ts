/**
 * The app's two requests, as hooks.
 *
 * `/plan` is a read and `/ask` is an event, and they are wired differently for reasons
 * that came out of measurement rather than convention.
 *
 * **The assistant never retries.** A retry policy is written for requests that are cheap
 * and fail transiently. This one is neither: the median answer takes 27 seconds of local
 * inference and the slowest measured 47 (docs/08), so a silent second attempt turns a
 * failed 47-second wait into a failed 94-second one, having asked the user's own laptop
 * to do the same expensive work twice. If it failed, say so and let the person decide.
 *
 * **A wrong request is never retried either.** A 4xx and a schema mismatch are bugs on
 * this side of the wire; repeating them only delays the error by a few seconds.
 */

import {
  QueryClient,
  keepPreviousData,
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { fetch as streamingFetch } from "expo/fetch";
import { AskResponse, PlanResult } from "@weatherapp/schema";

import { locationKey, planKey, readPlan, writePlan } from "@/db/plan-cache";
import { useState } from "react";

import { ApiError, post } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import { API_BASE_URL, TIMEOUT_MS } from "@/lib/config";
import type { SavedLocation } from "@/lib/locations";
import type { Choice } from "@/lib/profiles";

/** Errors that will not get better by being repeated. */
const PERMANENT = new Set(["unconfigured", "request", "contract", "forecast_unavailable"]);

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A forecast is hourly data behind a server-side cache; refetching it every time
      // a screen mounts would be traffic without information.
      staleTime: 10 * 60 * 1000,
      retry: (failureCount, error) =>
        error instanceof ApiError && PERMANENT.has(error.kind) ? false : failureCount < 2,
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});

export function usePlan(
  choice: Choice,
  place: SavedLocation,
): UseQueryResult<PlanResult, Error> {
  const key = planKey(place.latitude, place.longitude, choice.constraints);

  return useQuery({
    // Keyed on the limits rather than on the profile's name or id: two profiles with the
    // same constraints score identically, and editing a name should not refetch.
    queryKey: ["plan", place.latitude, place.longitude, choice.constraints],
    queryFn: ({ signal }) =>
      post({
        path: "/plan",
        body: {
          latitude: place.latitude,
          longitude: place.longitude,
          timezone: place.timezone,
          profile: choice.constraints,
        },
        schema: PlanResult,
        timeoutMs: TIMEOUT_MS.plan,
        signal,
      }).then((plan) => {
        // Written on the way through rather than in `onSuccess`: a cache that only fills
        // when a callback happens to run is a cache that is empty exactly when something
        // else went wrong.
        writePlan(key, locationKey(place.latitude, place.longitude), plan);
        return plan;
      }),

    /**
     * The last answer to this exact question, if there is one.
     *
     * `initialData` rather than `placeholderData`, because this is real data the app
     * genuinely has — it was the server's answer, and its own `fetched_at` says when.
     * Treating it as a placeholder would make React Query discard it on error, which is
     * the one moment it is worth the most (ADR-0016).
     *
     * `initialDataUpdatedAt` is what stops it being trusted forever: React Query compares
     * it to `staleTime` and refetches immediately if the cached answer is older than ten
     * minutes, which it usually is.
     */
    initialData: () => readPlan(key) ?? undefined,
    initialDataUpdatedAt: () => {
      const cached = readPlan(key);
      return cached ? Date.parse(cached.fetched_at) : undefined;
    },

    // Switching activity re-scores the same forecast. Holding the previous trace while
    // that happens keeps the chips feeling like a filter rather than a page load.
    placeholderData: keepPreviousData,
  });
}

/**
 * What the assistant is doing right now.
 *
 * The phases the agent actually goes through, in the order it goes through them. There is
 * no fraction: the agent does not know one, and a progress bar built from a guess is the
 * fiction docs/13 ruled out.
 */
export type AskPhase = "gathering" | "composing" | "repairing";

export function useAsk(
  choice: Choice,
  place: SavedLocation,
): UseMutationResult<AskResponse, Error, string> & { phase: AskPhase | null } {
  const [phase, setPhase] = useState<AskPhase | null>(null);

  const mutation = useMutation({
    mutationFn: async (question: string) => {
      setPhase("gathering");
      return askStreaming(
        {
          latitude: place.latitude,
          longitude: place.longitude,
          timezone: place.timezone,
          profile: choice.constraints,
          question,
        },
        setPhase,
      );
    },
    onSettled: () => setPhase(null),
  });

  return { ...mutation, phase };
}

/**
 * One request, many lines.
 *
 * `expo/fetch` rather than the global one: React Native's `fetch` resolves `response.body`
 * to null, so a streamed response can only be read after it has finished — which is
 * exactly no better than not streaming. This is the WHATWG implementation Expo ships for
 * that reason.
 *
 * Not routed through `lib/api.ts`. That layer parses one JSON body against one schema and
 * refreshes tokens around it; this reads a stream of unrelated objects. Bending it to do
 * both would make the common path carry the rare one's complexity.
 */
async function askStreaming(
  body: unknown,
  onPhase: (phase: AskPhase) => void,
): Promise<AskResponse> {
  if (API_BASE_URL === null) {
    throw new ApiError("unconfigured", "No API address is configured.");
  }

  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), TIMEOUT_MS.ask);

  try {
    const token = getAccessToken();
    const response = await streamingFetch(`${API_BASE_URL}/ask/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: deadline.signal,
    });

    if (!response.ok) {
      if (response.status === 503) {
        throw new ApiError("forecast_unavailable", "Forecast unavailable", 503);
      }
      throw new ApiError(
        response.status >= 500 ? "server" : "request",
        `HTTP ${response.status}`,
        response.status,
      );
    }

    const reader = response.body?.getReader();
    if (!reader) throw new ApiError("contract", "The response could not be read.");

    const decoder = new TextDecoder();
    let buffer = "";
    let answer: AskResponse | null = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // A chunk can end mid-line, so the last fragment is kept for the next read rather
      // than parsed. Splitting and parsing everything would throw on a half-object.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as { phase: string; answer?: unknown };
        if (event.phase === "done") answer = AskResponse.parse(event.answer);
        else onPhase(event.phase as AskPhase);
      }
    }

    if (answer === null) {
      // The stream ended without an answer: the connection dropped mid-thought.
      throw new ApiError("server", "The assistant stopped before answering.");
    }
    return answer;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (deadline.signal.aborted) {
      throw new ApiError(
        "timeout",
        `No answer within ${Math.round(TIMEOUT_MS.ask / 1000)}s.`,
      );
    }
    throw new ApiError("unreachable", `Could not reach ${API_BASE_URL}.`);
  } finally {
    clearTimeout(timer);
  }
}
