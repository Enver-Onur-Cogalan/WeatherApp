/**
 * Places, and which one the app is about.
 *
 * The last hard-coded thing a person could see. İstanbul was a constant in `config.ts`,
 * shown on two screens and sent with every request, and the server's `saved_locations`
 * table had been built and tested for a week without anything reading it.
 *
 * One interface over two stores, as with profiles: an account's places live on the server,
 * a guest's on the device, and the screen that edits them does not know which. The floor
 * is the same idea too — with nothing saved, the app is about İstanbul rather than about
 * nowhere, so it opens and works before anyone has done anything.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SavedLocation as SavedLocationSchema } from "@weatherapp/schema";
import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import { z } from "zod";

import {
  deleteLocalLocation,
  saveLocalLocation,
  useLocalLocations,
} from "@/db/locations";
import { request } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { DEFAULT_LOCATION, TIMEOUT_MS } from "@/lib/config";
import { uuidv7 } from "@/lib/uuid";

export type SavedLocation = SavedLocationSchema;

const LocationList = z.array(SavedLocationSchema);

/** A geocoding result, before anyone has decided to keep it. */
export const Place = z.object({
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string(),
  country: z.string().nullable().optional(),
});
// A value and a type of the same name is Zod's own convention and legal TypeScript —
// `packages/schema` generates every one of its exports this way. The rule cannot tell the
// two namespaces apart.
// eslint-disable-next-line @typescript-eslint/no-redeclare
export type Place = z.infer<typeof Place>;

/**
 * What the app is about when nothing is saved.
 *
 * Not a real record — it has no id and cannot be edited or deleted. It exists so that the
 * first launch shows a forecast rather than an empty state demanding setup, which is the
 * same argument the built-in profiles are there for.
 */
export const FALLBACK: SavedLocation = {
  id: "fallback",
  label: DEFAULT_LOCATION.name,
  latitude: DEFAULT_LOCATION.latitude,
  longitude: DEFAULT_LOCATION.longitude,
  timezone: DEFAULT_LOCATION.timezone,
  created_at: "1970-01-01T00:00:00+00:00",
  updated_at: "1970-01-01T00:00:00+00:00",
};

/**
 * Which place is on screen.
 *
 * Persisted, and not a secret — `expo-secure-store` is used for the same reason the guest
 * flag is: it is installed, it survives a reinstall, and a second storage library for one
 * string costs more than the impurity.
 *
 * Deliberately separate from `is_current`, which docs/12 defines as *the device's own
 * position*. Being somewhere and looking at somewhere are different questions, and one
 * flag answering both is how a person ends up unable to check the weather where they are
 * going without lying about where they are.
 */
const SELECTED_KEY = "weatherapp.selected_location";

export function useLocations() {
  const signedIn = useAuth((state) => state.status === "signed-in");
  const local = useLocalLocations();

  const remote = useQuery({
    queryKey: ["locations"],
    enabled: signedIn,
    queryFn: ({ signal }) =>
      request({
        method: "GET",
        path: "/locations",
        schema: LocationList,
        timeoutMs: TIMEOUT_MS.plan,
        signal,
      }),
  });

  const saved = signedIn ? (remote.data ?? []) : local;
  return { saved, isPending: signedIn && remote.isPending };
}

/**
 * The place the app is about, and how to change it.
 *
 * Falls back rather than holding a dangling id: a place can be deleted on another device,
 * and a selection pointing at nothing would leave the screen with no forecast to draw.
 */
export function useSelectedLocation() {
  const { saved } = useLocations();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(SELECTED_KEY)
      .then(setSelectedId)
      .catch(() => setSelectedId(null));
  }, []);

  const selected =
    saved.find((place) => place.id === selectedId) ?? saved[0] ?? FALLBACK;

  const select = (id: string) => {
    setSelectedId(id);
    void SecureStore.setItemAsync(SELECTED_KEY, id).catch(() => {
      // The choice is lost at next launch and the first place is shown instead.
      // Annoying, not broken.
    });
  };

  return { selected, select, saved };
}

export function useSaveLocation() {
  const signedIn = useAuth((state) => state.status === "signed-in");
  const client = useQueryClient();

  const remote = useMutation({
    mutationFn: (location: SavedLocation) =>
      request({
        method: "PUT",
        path: `/locations/${location.id}`,
        body: {
          label: location.label,
          latitude: location.latitude,
          longitude: location.longitude,
          timezone: location.timezone,
          is_current: location.is_current ?? false,
          sort_order: location.sort_order ?? 0,
          updated_at: location.updated_at,
        },
        schema: SavedLocationSchema,
        timeoutMs: TIMEOUT_MS.plan,
      }),
    onSettled: () => client.invalidateQueries({ queryKey: ["locations"] }),
  });

  return (location: SavedLocation) => {
    if (signedIn) remote.mutate(location);
    else void saveLocalLocation(location);
  };
}

export function useDeleteLocation() {
  const signedIn = useAuth((state) => state.status === "signed-in");
  const client = useQueryClient();

  const remote = useMutation({
    mutationFn: (id: string) =>
      request({
        method: "DELETE",
        path: `/locations/${id}`,
        schema: z.unknown(),
        timeoutMs: TIMEOUT_MS.plan,
      }),
    onSettled: () => client.invalidateQueries({ queryKey: ["locations"] }),
  });

  return (id: string) => {
    if (signedIn) remote.mutate(id);
    else void deleteLocalLocation(id);
  };
}

/** Find a place by name, through our own server rather than from the phone. */
export function useSearchPlaces(query: string) {
  const trimmed = query.trim();

  return useQuery({
    queryKey: ["places", trimmed],
    // Two characters is the server's own minimum; asking sooner is a request that can
    // only be rejected.
    enabled: trimmed.length >= 2,
    queryFn: ({ signal }) =>
      request({
        method: "GET",
        path: `/places?q=${encodeURIComponent(trimmed)}`,
        schema: z.array(Place),
        timeoutMs: TIMEOUT_MS.plan,
        signal,
      }),
    // A place does not move. Once looked up, the answer is good for the session.
    staleTime: Infinity,
  });
}

/** A geocoding result, as a record that can be stored. */
export function fromPlace(place: Place): SavedLocation {
  const now = new Date().toISOString();
  return {
    id: uuidv7(),
    label: place.name,
    latitude: place.latitude,
    longitude: place.longitude,
    timezone: place.timezone,
    is_current: false,
    sort_order: 0,
    created_at: now,
    updated_at: now,
  };
}
