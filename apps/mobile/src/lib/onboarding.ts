/**
 * Whether the tour has been seen.
 *
 * The same shape as the guest flag in `auth.ts`, and stored the same way for the same
 * reason: `expo-secure-store` is not for booleans, but it is installed, it survives a
 * reinstall, and a second storage library for one flag costs more than the impurity.
 *
 * `seen` is `null` until the keystore answers, and that third state is load-bearing. The
 * tabs layout decides whether to redirect *before* rendering, so a flag that defaulted to
 * false while still being read would show the tour for one frame to somebody who had
 * already dismissed it — the same flash the auth `restoring` state exists to prevent.
 */

import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

const SEEN_KEY = "weatherapp.seen_tour";

type TourState = {
  /** `null` while the keystore is being read. Nothing should guess during it. */
  seen: boolean | null;
  restore: () => Promise<void>;
  markSeen: () => void;
};

export const useTour = create<TourState>((set) => ({
  seen: null,
  restore: async () => {
    try {
      set({ seen: (await SecureStore.getItemAsync(SEEN_KEY)) === "1" });
    } catch {
      // Treated as seen. Showing the tour again to someone who has dismissed it is worse
      // than never showing it to someone whose keystore is unreadable — one is an
      // annoyance on every launch, the other is a missed introduction.
      set({ seen: true });
    }
  },
  markSeen: () => {
    set({ seen: true });
    void SecureStore.setItemAsync(SEEN_KEY, "1").catch(() => {
      // It reappears next launch, which is the failure this can afford to have.
    });
  },
}));
