/**
 * The chosen place, which three screens read and one of them writes.
 *
 * This is the defect that made the test file exist. `useSelectedLocation` held the id in
 * `useState`, so İz, Sor and the list in Sen each got their *own* copy: choosing Trabzon
 * in Sen marked the row selected, wrote the keystore, and left the forecast on İzmir
 * until the next launch. Every part worked on its own, which is why it took a device and
 * two screens to see.
 *
 * The tests are therefore about *sharing* rather than about selecting. A single consumer
 * would have passed against the broken version.
 */

// `renderHook` and `act` are asynchronous in this version, because React 19's renderer is
// concurrent: the hook has not run when `renderHook` returns, and a state change has not
// been re-rendered when `act` returns. Both failures are quiet — an un-awaited
// `renderHook` gives a Promise with no `result` on it, and an un-awaited `act` leaves the
// previous value in place, which reads exactly like the write having been ignored.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as SecureStore from "expo-secure-store";
import { act, renderHook } from "@testing-library/react-native";
import { createElement, type ReactNode } from "react";

import { FALLBACK, useSelectedLocation, useSelection } from "@/lib/locations";
import type { SavedLocation } from "@/lib/locations";

const place = (id: string, label: string): SavedLocation => ({
  id,
  label,
  latitude: 41,
  longitude: 29,
  timezone: "Europe/Istanbul",
  created_at: "2026-09-01T00:00:00+00:00",
  updated_at: "2026-09-01T00:00:00+00:00",
});

const izmir = place("a", "İzmir");
const trabzon = place("b", "Trabzon");

// Prefixed because Jest hoists `jest.mock` above every declaration in the file and
// refuses a factory that reaches for a variable which might not exist yet.
let mockSaved: SavedLocation[] = [];

jest.mock("@/db/locations", () => ({
  useLocalLocations: () => ({ locations: mockSaved, loaded: true }),
}));

jest.mock("@/lib/auth", () => ({
  useAuth: (select: (state: { status: string }) => unknown) =>
    select({ status: "guest" }),
}));

/**
 * `useLocations` asks React Query for the account's places even while signed out — the
 * query is disabled, not absent — so a client has to exist for the hook to render at all.
 *
 * One client for the file rather than one per render: a client keeps a garbage-collection
 * timer, and a new one per mount leaves a timer per mount behind it. Retries are off so a
 * test never waits on one, and `gcTime` is zero so nothing is scheduled to be forgotten
 * later.
 */
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 } },
});

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client }, children);

const mount = () => renderHook(() => useSelectedLocation(), { wrapper });

afterEach(() => {
  client.clear();
});

beforeEach(() => {
  mockSaved = [izmir, trabzon];
  useSelection.setState({ selectedId: null, restored: true });
});

describe("the selection is shared", () => {
  it("reaches a second reader that never called select", async () => {
    // The bug, stated. Two hooks, as two screens: one chooses, the other must agree.
    const chooser = await mount();
    const reader = await mount();

    await act(async () => chooser.result.current.select(trabzon.id));

    expect(chooser.result.current.selected.label).toBe("Trabzon");
    expect(reader.result.current.selected.label).toBe("Trabzon");
  });

  it("reaches a reader that mounted after the choice was made", async () => {
    const chooser = await mount();
    await act(async () => chooser.result.current.select(trabzon.id));

    const later = await mount();
    expect(later.result.current.selected.label).toBe("Trabzon");
  });

  it("remembers the choice for the next launch", async () => {
    const { result } = await mount();
    await act(async () => result.current.select(trabzon.id));

    // Written through, so a relaunch restores it rather than falling back to the first.
    await act(async () => {});
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      "weatherapp.selected_location",
      trabzon.id,
    );
  });
});

describe("what is shown when the choice cannot be honoured", () => {
  it("falls back to the first place rather than to nothing", async () => {
    // A place can be deleted on another device, and a selection pointing at nothing
    // would leave the screen with no forecast to draw.
    useSelection.setState({ selectedId: "deleted-elsewhere", restored: true });
    const { result } = await mount();

    expect(result.current.selected.label).toBe("İzmir");
  });

  it("falls back to İstanbul when nothing is saved at all", async () => {
    // Not a real record: it has no id and cannot be edited or deleted. It exists so the
    // first launch shows a forecast rather than an empty state demanding setup.
    mockSaved = [];
    const { result } = await mount();

    expect(result.current.selected.id).toBe(FALLBACK.id);
  });
});

describe("restoring", () => {
  it("does not claim to know the place before the keystore has answered", async () => {
    // The tabs wait on this. A screen that renders before the choice is known picks the
    // first saved place and fetches a forecast for somewhere nobody chose.
    useSelection.setState({ selectedId: null, restored: false });
    expect(useSelection.getState().restored).toBe(false);
  });

  it("reads the stored choice back", async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValueOnce(trabzon.id);
    useSelection.setState({ selectedId: null, restored: false });

    await act(async () => {
      await useSelection.getState().restore();
    });

    expect(useSelection.getState().restored).toBe(true);
    const { result } = await mount();
    expect(result.current.selected.label).toBe("Trabzon");
  });
});
