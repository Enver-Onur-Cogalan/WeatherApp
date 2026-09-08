/**
 * The WMO mapping, which is where two defects lived.
 *
 * This file exists because of what it would have caught. Thunder was asked of the
 * condition, so 96 and 99 — thunderstorms whose falling body is hail — drew hail out of a
 * silent sky. And freezing rain was read as ordinary water, in the one condition where
 * the difference changes what a person should do; the engine had excluded those codes
 * from the start and only the client disagreed.
 *
 * Both were found on a device. Both are a table lookup.
 */

import { conditionFor, hasThunder, isSevere } from "@/lib/weather-code";

describe("conditionFor", () => {
  it.each([
    [0, "clear"],
    [1, "partly"],
    [2, "partly"],
    [3, "overcast"],
    [45, "fog"],
    [48, "fog"],
    [53, "light-rain"],
    [61, "light-rain"],
    [80, "light-rain"],
    [65, "downpour"],
    [82, "downpour"],
    [73, "snow"],
    [77, "snow"],
    [86, "snow"],
    [95, "storm"],
    [96, "hail"],
    [99, "hail"],
  ] as const)("reads %i as %s", (code, condition) => {
    expect(conditionFor(code)).toBe(condition);
  });

  it.each([56, 57, 66, 67])("reads %i as freezing rather than rain", (code) => {
    expect(conditionFor(code)).toBe("freezing");
  });

  it("falls back to partly for a code it does not know", () => {
    // Open-Meteo could add one, and a code nobody has heard of is not a reason to draw
    // nothing at all.
    expect(conditionFor(4)).toBe("partly");
  });
});

describe("hasThunder", () => {
  it.each([95, 96, 99])("is true for %i, whatever falls out of it", (code) => {
    expect(hasThunder(code)).toBe(true);
  });

  it("is not the same question as the condition", () => {
    // The defect, stated as a test: both of these thunder, and only one of them is a
    // `storm`. Asking the condition drew a silent sky over hail.
    expect(conditionFor(96)).toBe("hail");
    expect(hasThunder(96)).toBe(true);
  });

  it.each([0, 3, 61, 73, 82])("is false for %i", (code) => {
    expect(hasThunder(code)).toBe(false);
  });
});

describe("isSevere", () => {
  it.each([95, 96, 99, 65, 56, 66])("marks %i severe", (code) => {
    expect(isSevere(code)).toBe(true);
  });

  it.each([0, 1, 3, 45, 53, 73])("leaves %i alone", (code) => {
    expect(isSevere(code)).toBe(false);
  });
});
