/**
 * Saved profiles, as hooks.
 *
 * The rule this file exists to hold: **İz always has something to draw.** A signed-in
 * account with no saved profiles falls back to the same built-in defaults a guest uses,
 * rather than showing an empty state that has to be cleared before the app works. Saving
 * a profile is additive, never a prerequisite.
 *
 * Nothing is written to an account without being asked for. Seeding the three defaults
 * server-side on first sign-in would be convenient and would also be data the person did
 * not create, in an account whose whole premise is that it stores what they ask it to.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SavedProfile } from "@weatherapp/schema";
import { z } from "zod";

import {
  deleteLocalProfile,
  saveLocalProfile,
  seedLocalProfiles,
  useLocalProfiles,
} from "@/db/profiles";
import { ApiError, request } from "@/lib/api";
import { TIMEOUT_MS } from "@/lib/config";
import { useAuth } from "@/lib/auth";
import { PROFILES, type ActivityKey, type ActivityProfile } from "@/lib/plan";
import { uuidv7 } from "@/lib/uuid";

const ProfileList = z.array(SavedProfile);

export type { SavedProfile };

/** What İz shows when there is nothing saved: the built-in three, as chips. */
export type Choice = {
  key: string;
  label: string;
  constraints: ActivityProfile;
  /** Absent for a built-in default, which exists only on this device. */
  id?: string;
};

const BUILT_IN_LABELS: Record<ActivityKey, string> = {
  running: "Koşu",
  cycling: "Bisiklet",
  picnic: "Piknik",
};

export const BUILT_IN: Choice[] = (
  Object.keys(PROFILES) as ActivityKey[]
).map((key) => ({ key, label: BUILT_IN_LABELS[key], constraints: PROFILES[key] }));

export function useProfiles() {
  const signedIn = useAuth((state) => state.status === "signed-in");

  return useQuery({
    queryKey: ["profiles"],
    enabled: signedIn,
    queryFn: ({ signal }) =>
      request({
        method: "GET",
        path: "/profiles",
        schema: ProfileList,
        timeoutMs: TIMEOUT_MS.plan,
        signal,
      }),
  });
}

const asChoice = (profile: SavedProfile): Choice => ({
  key: profile.id,
  id: profile.id,
  label: profile.name,
  constraints: profile.constraints,
});

/**
 * What the chips offer.
 *
 * An account's profiles when signed in, the device's own when not. The built-in three are
 * the floor in both cases: İz always has something to draw, and an empty list is never a
 * state the person has to clear before the app works.
 */
export function useChoices(): { choices: Choice[]; saved: boolean } {
  const signedIn = useAuth((state) => state.status === "signed-in");
  const { data: remote } = useProfiles();
  const local = useLocalProfiles();

  const profiles = signedIn ? (remote ?? []) : local;

  if (profiles.length === 0) return { choices: BUILT_IN, saved: false };
  return { choices: profiles.map(asChoice), saved: true };
}

export function useSaveProfile() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (profile: SavedProfile) =>
      request({
        method: "PUT",
        path: `/profiles/${profile.id}`,
        body: {
          name: profile.name,
          constraints: profile.constraints,
          updated_at: profile.updated_at,
        },
        schema: SavedProfile,
        timeoutMs: TIMEOUT_MS.plan,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["profiles"] }),
    onError: (error) => {
      // A 409 is the server saying it holds a newer version, and the newer version is in
      // the body. Refetching is the honest response: the local edit lost, and pretending
      // otherwise leaves the screen showing something the server does not have.
      if (error instanceof ApiError && error.status === 409) {
        void client.invalidateQueries({ queryKey: ["profiles"] });
      }
    },
  });
}

export function useDeleteProfile() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      request({
        method: "DELETE",
        path: `/profiles/${id}`,
        schema: z.unknown(),
        timeoutMs: TIMEOUT_MS.plan,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["profiles"] }),
  });
}


/**
 * One interface over two stores.
 *
 * The profiles screen should not know whether it is talking to a server or to SQLite —
 * the difference is where the person's data lives, not what the screen does with it. It
 * also means the guest and account paths cannot drift into behaving differently, which
 * ADR-0009 already warns is the cost of having two.
 */
export type ProfileStore = {
  profiles: SavedProfile[];
  isPending: boolean;
  isError: boolean;
  /** True while a write is in flight; only the remote store can be slow enough to matter. */
  saving: boolean;
  save: (profile: SavedProfile) => void;
  remove: (id: string) => void;
  seed: () => void;
};

export function useProfileStore(): ProfileStore {
  const signedIn = useAuth((state) => state.status === "signed-in");

  const query = useProfiles();
  const saveRemote = useSaveProfile();
  const deleteRemote = useDeleteProfile();
  const local = useLocalProfiles();

  if (signedIn) {
    return {
      profiles: query.data ?? [],
      isPending: query.isPending,
      isError: query.isError,
      saving: saveRemote.isPending,
      save: (profile) => saveRemote.mutate(profile),
      remove: (id) => deleteRemote.mutate(id),
      seed: () => BUILT_IN.forEach((choice) => saveRemote.mutate(fromBuiltIn(choice))),
    };
  }

  return {
    profiles: local,
    // SQLite answers within the frame; a spinner would flash rather than inform.
    isPending: false,
    isError: false,
    saving: false,
    save: (profile) => void saveLocalProfile(profile),
    remove: (id) => void deleteLocalProfile(id),
    seed: () => void seedLocalProfiles(BUILT_IN),
  };
}

/** A built-in default, as a record that can be stored. */
export function fromBuiltIn(choice: Choice): SavedProfile {
  const now = new Date().toISOString();
  return {
    id: uuidv7(),
    name: choice.label,
    constraints: choice.constraints,
    created_at: now,
    updated_at: now,
  };
}
