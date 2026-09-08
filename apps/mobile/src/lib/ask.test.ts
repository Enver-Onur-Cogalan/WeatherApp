/**
 * How a failure is described, which is the thing that cost an evening.
 *
 * The streaming path wrapped the request, the stream, the JSON and the schema in one
 * `try` whose `catch` called all of it "unreachable" and threw the real error away. So a
 * server that had just written a correct answer was reported to the person as
 * unreachable, and the diagnosis pointed at a network that was working perfectly. The
 * fix that found the cause was making the error say what it was.
 */

import { ApiError } from "@/lib/api";
import { describeError, formatProvenance, isWorthRetrying, readingsOf } from "@/lib/ask";

const response = (over: Partial<Parameters<typeof formatProvenance>[0]> = {}) =>
  ({
    answer: { verdict: "good", reason: "x", warnings: [] },
    tool_calls: ["get_activity_windows"],
    duration_ms: 21_795,
    from_model: true,
    on_device: true,
    fallback_reason: null,
    ...over,
  }) as Parameters<typeof formatProvenance>[0];

describe("describeError", () => {
  it("has a message for every kind the API can raise", () => {
    // The compile-time check in `ask.ts` proves the dictionary covers the union. This
    // proves the lookup actually finds them, in both languages.
    for (const language of ["tr", "en"] as const) {
      for (const kind of [
        "unconfigured",
        "unreachable",
        "timeout",
        "forecast_unavailable",
        "server",
        "request",
        "unauthenticated",
        "contract",
      ] as const) {
        const described = describeError(new ApiError(kind, "detail"), language);
        expect(described.title).toBeTruthy();
        expect(described.detail).toBeTruthy();
      }
    }
  });

  it("carries the underlying message on the technical line", () => {
    // Naming what was tried is what turns "check the network" into something a person
    // can actually check — and it is what named the failing field when a schema drifted.
    const described = describeError(new ApiError("server", "warnings.0 too long"), "en");
    expect(described.technical).toBe("warnings.0 too long");
  });

  it("does not describe an unknown failure as a reachable server", () => {
    const described = describeError(new Error("something else"), "tr");
    expect(described.title).toBeTruthy();
    expect(described.technical).toBeUndefined();
  });

  it("answers in the language it was asked in", () => {
    expect(describeError(new ApiError("unreachable", ""), "tr").title).not.toBe(
      describeError(new ApiError("unreachable", ""), "en").title,
    );
  });
});

describe("isWorthRetrying", () => {
  it("offers a retry for a failure that could pass next time", () => {
    expect(isWorthRetrying(new ApiError("timeout", ""))).toBe(true);
    expect(isWorthRetrying(new ApiError("unreachable", ""))).toBe(true);
  });

  it("does not offer one where pressing it changes nothing", () => {
    // A schema mismatch and a misconfigured address are not going to resolve themselves,
    // and a button that cannot work is a lie.
    expect(isWorthRetrying(new ApiError("contract", ""))).toBe(false);
    expect(isWorthRetrying(new ApiError("unconfigured", ""))).toBe(false);
  });
});

describe("formatProvenance", () => {
  it("says where the answer came from", () => {
    expect(formatProvenance(response(), "en")).toContain("on device");
    expect(formatProvenance(response({ from_model: false }), "en")).not.toContain(
      "on device",
    );
  });

  it("counts no tools as none rather than as zero", () => {
    expect(formatProvenance(response({ tool_calls: [] }), "en")).toContain("no tools");
  });

  it("uses each language's own decimal separator", () => {
    expect(formatProvenance(response(), "tr")).toContain("21,8");
    expect(formatProvenance(response(), "en")).toContain("21.8");
  });
});

describe("readingsOf", () => {
  const window = {
    day: "2026-09-10",
    start_hour: 6,
    end_hour: 12,
    score: 97.3,
    temp_min_c: 20,
    temp_max_c: 27,
    wind_max_kmh: 14,
    precip_prob_max_pct: 0,
  };

  it("writes a percentage the way each language writes one", () => {
    expect(readingsOf({ ...window, precip_prob_max_pct: 40 }, "tr")[2].value).toBe("%40");
    expect(readingsOf({ ...window, precip_prob_max_pct: 40 }, "en")[2].value).toBe("40%");
  });

  it("says none rather than zero percent", () => {
    expect(readingsOf(window, "en")[2].value).toBe("none");
  });

  it("collapses a range that has only one value", () => {
    expect(readingsOf({ ...window, temp_min_c: 22, temp_max_c: 22 }, "en")[0].value).toBe(
      "22°",
    );
  });

  it("marks a stiff breeze without calling it a warning", () => {
    // The engine already refused to offer a window that broke the person's own limit, so
    // this is information rather than an alarm.
    expect(readingsOf({ ...window, wind_max_kmh: 30 }, "en")[1].tone).toBe("cool");
    expect(readingsOf(window, "en")[1].tone).toBeUndefined();
  });
});
