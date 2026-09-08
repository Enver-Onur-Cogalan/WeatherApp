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

import { create } from "zustand";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SavedLocation as SavedLocationSchema } from "@weatherapp/schema";
import * as SecureStore from "expo-secure-store";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

import {
  deleteLocalLocation,
  saveLocalLocation,
  useLocalLocations,
} from "@/db/locations";
import { request } from "@/lib/api";
import { locate, movedFar, permissionState, type Here } from "@/lib/here";
import { useLanguage } from "@/lib/i18n";
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

/**
 * Which place is chosen, shared by everything that asks.
 *
 * A store rather than `useState`, and that is the whole of the bug this replaces. Three
 * screens call `useSelectedLocation` — İz, Sor and the list in Sen — and each one used to
 * get its *own* copy of the id. Choosing Trabzon in Sen updated the list's copy, wrote the
 * keystore, and left the other two holding whatever they had read when they mounted: the
 * row showed Trabzon as selected while the forecast stayed on İzmir, and it only agreed
 * with itself after a relaunch.
 *
 * Zustand for the same reason the session and the language use it: one value, many
 * readers, and every reader re-renders when it changes.
 */
type SelectionState = {
  selectedId: string | null;
  /** False until the keystore answers, so nothing chooses a place on a guess. */
  restored: boolean;
  restore: () => Promise<void>;
  select: (id: string) => void;
};

export const useSelection = create<SelectionState>((set) => ({
  selectedId: null,
  restored: false,
  restore: async () => {
    try {
      set({ selectedId: await SecureStore.getItemAsync(SELECTED_KEY), restored: true });
    } catch {
      set({ selectedId: null, restored: true });
    }
  },
  select: (id) => {
    set({ selectedId: id });
    void SecureStore.setItemAsync(SELECTED_KEY, id).catch(() => {
      // The choice is lost at next launch and the first place is shown instead.
      // Annoying, not broken.
    });
  },
}));

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

  const saved = signedIn ? (remote.data ?? []) : local.locations;
  // A guest's places are "pending" until SQLite has answered, which it does within the
  // frame — but not *before* the first one. Reporting them as loaded while the list is
  // still undefined is what let a caller act on an empty list that was never empty.
  const isPending = signedIn ? remote.isPending : !local.loaded;
  return { saved, isPending };
}

/**
 * The place the app is about, and how to change it.
 *
 * Falls back rather than holding a dangling id: a place can be deleted on another device,
 * and a selection pointing at nothing would leave the screen with no forecast to draw.
 */
export function useSelectedLocation() {
  const { saved } = useLocations();
  const selectedId = useSelection((state) => state.selectedId);
  const select = useSelection((state) => state.select);

  const selected = saved.find((place) => place.id === selectedId) ?? saved[0] ?? FALLBACK;

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


/**
 * Keep the device's own position up to date.
 *
 * Runs once per launch and only when permission has already been granted — a location
 * prompt on startup, before anyone has asked for anything, is the behaviour that teaches
 * people to refuse. The affordance in Sen is what asks.
 *
 * It rewrites the existing `is_current` record rather than adding one, so the selection
 * survives and the list does not grow a row every time the phone moves. And it only writes
 * when the fix is a kilometre or more from the stored one: GPS jitters by tens of metres
 * on a desk, and without the threshold this would rewrite a record and re-request a plan
 * on every launch to receive the same answer.
 */
export function useCurrentLocation() {
  const language = useLanguage();
  const { saved, isPending } = useLocations();
  const save = useSaveLocation();
  const remove = useDeleteLocation();
  const [asking, setAsking] = useState(false);

  // The freshest of them, if the list somehow holds more than one. Ordering by
  // `updated_at` rather than taking the first: the newest row carries the newest fix, and
  // the reconciliation below keeps exactly the one this points at.
  const currents = saved
    .filter((place) => place.is_current)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const current = currents[0] ?? null;

  /**
   * One current location, which is what docs/12 says there may be.
   *
   * Repair rather than prevention, and it needs to be both. The launch race below created
   * a *new* current row on every reload; fixing that stops the list growing and does
   * nothing about the rows already in it. A person cannot clear them by hand either —
   * before the race was fixed the row rewrote itself on the next launch, so deleting one
   * only ever removed the oldest of a set that kept growing.
   *
   * Deliberately not folded into the write below. That path is guarded by `movedFar`, so
   * on a phone sitting still it never runs — which is exactly the case where the
   * duplicates are visible and nothing was clearing them.
   */
  useEffect(() => {
    if (isPending || currents.length <= 1) return;
    for (const place of currents.slice(1)) remove(place.id);
    // `currents` is derived and a new array each render; its length is what matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending, currents.length]);

  const apply = (here: Here) => {
    const now = new Date().toISOString();

    save({
      // The same record, updated. A new id each time would leave a trail of stale places
      // and lose whatever the person had selected.
      id: current?.id ?? uuidv7(),
      label: here.label,
      latitude: here.latitude,
      longitude: here.longitude,
      timezone: here.timezone,
      is_current: true,
      sort_order: 0,
      created_at: current?.created_at ?? now,
      updated_at: now,
    });
  };

  /**
   * Once per launch, silently, if we are already allowed.
   *
   * Held until the places have actually been read. It used to run on mount, when
   * `useLiveQuery` had not answered yet and the list was `undefined` — so `current` was
   * captured as null, the id below fell through to a fresh `uuidv7()`, and the device's
   * location was *added* rather than updated. Every reload grew the list by one, which is
   * how it was found: pressing `r` in Expo cloned the row each time.
   */
  const ran = useRef(false);
  useEffect(() => {
    if (isPending || ran.current) return;
    ran.current = true;

    let cancelled = false;
    void (async () => {
      if ((await permissionState()) !== "granted") return;
      const here = await locate(false, language);
      if (cancelled || here === null) return;
      if (current !== null && !movedFar(here, current)) return;
      apply(here);
    })();
    return () => {
      cancelled = true;
    };
    // Once, after loading. Re-running as `saved` changes would fire on every write it
    // makes; `ran` is what makes "once" survive the extra render that loading causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending]);

  /**
   * The explicit ask, from a button someone pressed.
   *
   * Not named `useMyLocation`, tempting as that was: a returned function whose name starts
   * with `use` reads to the hooks lint rule as a hook called from a callback, which is an
   * error rather than a warning. The name would have been a small lie anyway.
   */
  const detectHere = async (): Promise<boolean> => {
    setAsking(true);
    try {
      const here = await locate(true, language);
      if (here === null) return false;
      apply(here);
      return true;
    } finally {
      setAsking(false);
    }
  };

  return { current, detectHere, asking };
}
