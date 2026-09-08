/**
 * The sun's arc, which the atmosphere reads for everything it draws.
 *
 * The gradient, the stars, the heat and the sun's own position all come off this one
 * curve, so a change here moves every one of them at once.
 */

import { elevation, inkOn, luminance, skyAt } from "@/lib/sky";

describe("elevation", () => {
  it("is zero before dawn and after dusk, not negative", () => {
    // Clamped rather than signed: a negative sun would drag the gradient past night and
    // scale the star field the wrong way.
    expect(elevation(3)).toBe(0);
    expect(elevation(22)).toBe(0);
  });

  it("peaks in the middle of the day", () => {
    expect(elevation(13)).toBeGreaterThan(0.99);
  });

  it("crosses zero at dawn and at dusk", () => {
    expect(elevation(6.5)).toBeCloseTo(0, 5);
    expect(elevation(19.5)).toBeCloseTo(0, 5);
  });

  it("rises through the morning and falls through the afternoon", () => {
    expect(elevation(8)).toBeLessThan(elevation(10));
    expect(elevation(16)).toBeLessThan(elevation(14));
  });
});

describe("inkOn", () => {
  it("switches sets when the sky crosses the threshold", () => {
    // The whole point of the layer: at 14:00 the gradient runs pale enough that bone
    // white type disappears into it, so the ink has to swap rather than dim.
    const pale = skyAt(14, 0, 0.3);
    const night = skyAt(2, 0, 0.3);

    expect(luminance(pale)).toBeGreaterThan(luminance(night));
    expect(inkOn(pale).ink).not.toBe(inkOn(night).ink);
  });

  it("depends on where on the screen the text is, not only on the hour", () => {
    // The gradient is vertical and pales toward the horizon, so at the same moment the
    // top of the screen can want one set and the middle the other. This is why `Legible`
    // measures its own centre rather than reading the hour and being done.
    expect(inkOn(skyAt(14, 0, 0.05)).ink).not.toBe(inkOn(skyAt(14, 0, 0.3)).ink);
  });

  it("returns one of two sets and never a blend", () => {
    // A blend would need a contrast check per frame. Two sets and a threshold is a
    // decision made once, which is why the crossover is a constant.
    const sets = new Set(
      [0, 4, 8, 11, 14, 17, 20, 23].map((hour) => inkOn(skyAt(hour, 0, 0.3)).ink),
    );
    expect(sets.size).toBe(2);
  });

  it("keeps an accent in both", () => {
    for (const hour of [2, 14]) {
      expect(inkOn(skyAt(hour, 0, 0.3)).accent).toBeTruthy();
    }
  });
});
