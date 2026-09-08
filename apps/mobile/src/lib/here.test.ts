/**
 * The distance threshold that stops the device's location rewriting itself.
 *
 * GPS jitters by tens of metres on a desk. Without this the current location would be
 * rewritten on every launch and a plan re-requested to receive the same answer — and
 * before the launch race was fixed, rewritten meant *added*.
 */

import { movedFar } from "@/lib/here";

const istanbul = { label: "x", latitude: 41.0082, longitude: 28.9784, timezone: "Europe/Istanbul" };

describe("movedFar", () => {
  it("ignores the jitter of a phone sitting still", () => {
    // Roughly thirty metres north.
    expect(movedFar(istanbul, { latitude: 41.0085, longitude: 28.9784 })).toBe(false);
  });

  it("notices a kilometre", () => {
    expect(movedFar(istanbul, { latitude: 41.0182, longitude: 28.9784 })).toBe(true);
  });

  it("notices a different city", () => {
    expect(movedFar(istanbul, { latitude: 41.0027, longitude: 39.7168 })).toBe(true);
  });

  it("measures longitude by the latitude it is at", () => {
    // A degree of longitude is 111km at the equator and about 55km at sixty degrees
    // north. Without the cosine this comparison is far too sensitive in Scandinavia and
    // far too lax near the equator, so the same delta has to give different answers.
    const equator = { label: "x", latitude: 0, longitude: 0, timezone: "UTC" };
    const arctic = { label: "x", latitude: 80, longitude: 0, timezone: "UTC" };
    const delta = 0.03;

    expect(movedFar(equator, { latitude: 0, longitude: delta })).toBe(true);
    expect(movedFar(arctic, { latitude: 80, longitude: delta })).toBe(false);
  });
});
