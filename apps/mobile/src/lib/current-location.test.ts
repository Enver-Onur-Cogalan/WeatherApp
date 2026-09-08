/**
 * Keeping the device's own place up to date without adding a new one each time.
 *
 * The defect: the effect ran on mount, when the live query had not answered and the list
 * was `undefined`. It captured `current` as null, the id fell through to a fresh one, and
 * the place was *added* rather than updated — so pressing `r` in Expo grew Yerler by a row
 * every reload. docs/12 allows one current location; the app was making one a minute.
 *
 * The first fix was incomplete in a way worth keeping a test for. Cleaning up duplicates
 * inside the write path does nothing, because that path is guarded by distance and never
 * runs on a phone sitting still — which is exactly when the duplicates are on screen.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react-native";
import { createElement, type ReactNode } from "react";

import { useCurrentLocation } from "@/lib/locations";
import type { SavedLocation } from "@/lib/locations";

const place = (id: string, over: Partial<SavedLocation> = {}): SavedLocation => ({
  id,
  label: "Konumum",
  latitude: 41,
  longitude: 29,
  timezone: "Europe/Istanbul",
  is_current: true,
  sort_order: 0,
  created_at: "2026-09-01T00:00:00+00:00",
  updated_at: "2026-09-01T00:00:00+00:00",
  ...over,
});

let mockSaved: SavedLocation[] = [];
let mockLoaded = true;
const mockSave = jest.fn();
const mockDelete = jest.fn();

jest.mock("@/db/locations", () => ({
  useLocalLocations: () => ({ locations: mockSaved, loaded: mockLoaded }),
  saveLocalLocation: (...args: unknown[]) => mockSave(...args),
  deleteLocalLocation: (...args: unknown[]) => mockDelete(...args),
}));

jest.mock("@/lib/auth", () => ({
  useAuth: (select: (state: { status: string }) => unknown) => select({ status: "guest" }),
}));

const mockLocate = jest.fn();
const mockPermission = jest.fn();

jest.mock("@/lib/here", () => ({
  ...jest.requireActual("@/lib/here"),
  locate: (...args: unknown[]) => mockLocate(...args),
  permissionState: () => mockPermission(),
}));

const client = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 } },
});
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client }, children);

/** Mount, and let the effect's awaits settle. */
const mount = async () => {
  const rendered = await renderHook(() => useCurrentLocation(), { wrapper });
  await act(async () => {});
  return rendered;
};

beforeEach(() => {
  mockSaved = [];
  mockLoaded = true;
  // Every one of them: `mockResolvedValue` replaces the implementation and leaves the
  // call history alone, so an assertion that something was *not* called will read the
  // previous test's calls. That is what this file's first red was.
  mockSave.mockClear();
  mockDelete.mockClear();
  mockLocate.mockClear();
  mockPermission.mockClear();
  mockPermission.mockResolvedValue("granted");
  mockLocate.mockResolvedValue({
    label: "Beşiktaş",
    latitude: 41,
    longitude: 29,
    timezone: "Europe/Istanbul",
  });
});

describe("waiting for the places to be read", () => {
  it("writes nothing while the list is still unknown", async () => {
    // The bug. An unread list looked like an empty one, so the hook concluded there was
    // no current location and made a new one.
    mockLoaded = false;
    mockSaved = [];

    await mount();

    expect(mockSave).not.toHaveBeenCalled();
  });

  it("updates the record it already has rather than adding one", async () => {
    const existing = place("here", { latitude: 40, longitude: 29 });
    mockSaved = [existing];

    await mount();

    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave.mock.calls[0][0].id).toBe("here");
    expect(mockSave.mock.calls[0][0].created_at).toBe(existing.created_at);
  });

  it("does not write at all when the phone has not moved", async () => {
    // GPS jitters by tens of metres on a desk. Without the threshold this rewrites the
    // record and re-requests a plan on every launch to receive the same answer.
    mockSaved = [place("here", { latitude: 41, longitude: 29 })];

    await mount();

    expect(mockSave).not.toHaveBeenCalled();
  });
});

describe("reconciling duplicates", () => {
  it("keeps one current place and removes the rest", async () => {
    // What a month of reloads left behind, and what nobody could clear by hand: deleting
    // one only ever removed the oldest of a set that kept growing.
    mockSaved = [
      place("newest", { updated_at: "2026-09-09T00:00:00+00:00" }),
      place("older", { updated_at: "2026-09-08T00:00:00+00:00" }),
      place("oldest", { updated_at: "2026-09-07T00:00:00+00:00" }),
    ];

    await mount();

    expect(mockDelete).toHaveBeenCalledTimes(2);
    const removed = mockDelete.mock.calls.map((call) => call[0]);
    expect(removed).toEqual(expect.arrayContaining(["older", "oldest"]));
    expect(removed).not.toContain("newest");
  });

  it("runs even when the phone has not moved", async () => {
    // The incomplete first fix, stated as a test: the cleanup used to live in the write
    // path, which the distance guard skips on a phone sitting still.
    mockSaved = [
      place("newest", { latitude: 41, longitude: 29 }),
      place("stale", { latitude: 41, longitude: 29, updated_at: "2026-09-01T00:00:00+00:00" }),
    ];

    await mount();

    expect(mockSave).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith("stale");
  });

  it("leaves places the person added alone", async () => {
    mockSaved = [
      place("here"),
      place("rize", { is_current: false, label: "Rize" }),
    ];

    await mount();

    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe("without permission", () => {
  it("asks for no position and writes nothing", async () => {
    mockPermission.mockResolvedValue("denied");
    mockSaved = [place("here", { latitude: 40 })];

    await mount();

    expect(mockLocate).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
  });
});
