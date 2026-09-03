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

import { ApiError, request } from "@/lib/api";
import { TIMEOUT_MS } from "@/lib/config";
import { useAuth } from "@/lib/auth";
import { PROFILES, type ActivityKey, type ActivityProfile } from "@/lib/plan";

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

/**
 * What the chips offer: saved profiles when there are any, the built-in three otherwise.
 */
export function useChoices(): { choices: Choice[]; saved: boolean } {
  const { data } = useProfiles();

  if (data === undefined || data.length === 0) {
    return { choices: BUILT_IN, saved: false };
  }

  return {
    choices: data.map((profile) => ({
      key: profile.id,
      id: profile.id,
      label: profile.name,
      constraints: profile.constraints,
    })),
    saved: true,
  };
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
