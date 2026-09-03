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
import { AskResponse, PlanResult } from "@weatherapp/schema";

import { ApiError, post } from "@/lib/api";
import { DEFAULT_LOCATION, TIMEOUT_MS } from "@/lib/config";
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

export function usePlan(choice: Choice): UseQueryResult<PlanResult, Error> {
  return useQuery({
    // Keyed on the limits rather than on the profile's name or id: two profiles with the
    // same constraints score identically, and editing a name should not refetch.
    queryKey: [
      "plan",
      DEFAULT_LOCATION.latitude,
      DEFAULT_LOCATION.longitude,
      choice.constraints,
    ],
    queryFn: ({ signal }) =>
      post({
        path: "/plan",
        body: {
          latitude: DEFAULT_LOCATION.latitude,
          longitude: DEFAULT_LOCATION.longitude,
          timezone: DEFAULT_LOCATION.timezone,
          profile: choice.constraints,
        },
        schema: PlanResult,
        timeoutMs: TIMEOUT_MS.plan,
        signal,
      }),
    // Switching activity re-scores the same forecast. Holding the previous trace while
    // that happens keeps the chips feeling like a filter rather than a page load.
    placeholderData: keepPreviousData,
  });
}

export function useAsk(choice: Choice): UseMutationResult<AskResponse, Error, string> {
  return useMutation({
    mutationFn: (question: string) =>
      post({
        path: "/ask",
        body: {
          latitude: DEFAULT_LOCATION.latitude,
          longitude: DEFAULT_LOCATION.longitude,
          timezone: DEFAULT_LOCATION.timezone,
          profile: choice.constraints,
          question,
        },
        schema: AskResponse,
        timeoutMs: TIMEOUT_MS.ask,
      }),
  });
}
