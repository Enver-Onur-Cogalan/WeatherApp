/**
 * The formatting the client does instead of the server.
 *
 * D1 decided the client formats, which put every date, unit and separator on this side of
 * the wire — and then the app became bilingual, which doubled all of it. Date arithmetic
 * from a "YYYY-MM-DD" string is the part most likely to be quietly wrong, because it is
 * right in the timezone of whoever wrote it.
 */

import { formatAge, formatWindowDay, formatWindowSpan } from "@/lib/plan";

const window = { day: "2026-09-12", start_hour: 6, end_hour: 11, score: 90 };

describe("formatWindowDay", () => {
  it("names the weekday of the date, not of today", () => {
    // 2026-09-12 is a Saturday.
    expect(formatWindowDay(window, "en")).toBe("Saturday");
    expect(formatWindowDay(window, "tr")).toBe("Cumartesi");
  });

  it("reads the date as a date rather than as an instant", () => {
    // Parsed through UTC on purpose: `new Date("2026-09-12")` is midnight UTC, and in
    // any timezone west of Greenwich that is the previous day. A window's day is a label
    // the server already decided, not a moment to be converted.
    for (const day of ["2026-01-01", "2026-06-15", "2026-12-31"]) {
      expect(formatWindowDay({ ...window, day }, "en")).toBeTruthy();
    }
    expect(formatWindowDay({ ...window, day: "2026-01-01" }, "en")).toBe("Thursday");
  });
});

describe("formatWindowSpan", () => {
  it("pads both ends so the row does not reflow", () => {
    expect(formatWindowSpan({ ...window, start_hour: 6, end_hour: 11 })).toBe(
      "06:00–11:00",
    );
    expect(formatWindowSpan({ ...window, start_hour: 0, end_hour: 9 })).toBe(
      "00:00–09:00",
    );
  });
});

describe("formatAge", () => {
  const now = Date.parse("2026-09-12T12:00:00Z");
  const ago = (minutes: number) =>
    new Date(now - minutes * 60_000).toISOString();

  it("says just now rather than zero minutes", () => {
    expect(formatAge(ago(0), "en", now)).toBe("just now");
    expect(formatAge(ago(0), "tr", now)).toBe("az önce");
  });

  it("steps up through minutes, hours and days", () => {
    expect(formatAge(ago(14), "en", now)).toContain("14");
    expect(formatAge(ago(90), "en", now)).toContain("2");
    expect(formatAge(ago(60 * 30), "en", now)).toContain("1");
  });

  it("never reports a forecast from the future as old", () => {
    // Clocks disagree, and "-3 min ago" is the kind of thing that gets screenshotted.
    expect(formatAge(new Date(now + 60_000).toISOString(), "en", now)).toBe("just now");
  });
});
