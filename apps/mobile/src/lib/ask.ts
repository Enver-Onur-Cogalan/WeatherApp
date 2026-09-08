/**
 * Wording the assistant's answer.
 *
 * The request itself lives in `queries.ts` and the types come from `packages/schema`;
 * what is left here is the part that is genuinely this app's — how a verdict, a
 * provenance line and a failure are said to a person.
 *
 * Suggestions are seeded rather than recorded. They used to be the questions the fixture
 * happened to contain, which made the empty state a list of the only things that worked.
 */

import { copyFor, type Copy, type Language } from "@/lib/i18n";
import type { AskResponse } from "@weatherapp/schema";

import { ApiError, type ErrorKind } from "@/lib/api";

export type { AskResponse };
export type Answer = AskResponse["answer"];

export type Exchange = {
  id: string;
  question: string;
  response: AskResponse;
  /** UTC, from the row. The thread groups by the day this falls in locally. */
  createdAt: string;
};

export function verdictLabel(
  verdict: NonNullable<Answer["verdict"]>,
  language: Language,
): string {
  return copyFor(language).verdict[verdict];
}

/** "1 araç · 21,4 sn · cihazda" — provenance, which docs/11 requires on screen. */
export function formatProvenance(response: AskResponse, language: Language): string {
  const { provenance } = copyFor(language).ask;
  const tools =
    response.tool_calls.length === 0
      ? provenance.noTools
      : provenance.tools(response.tool_calls.length);
  const source = response.from_model ? provenance.onDevice : provenance.fromEngine;
  return `${tools} · ${provenance.seconds(response.duration_ms)} · ${source}`;
}

export type Described = { title: string; detail: string; technical?: string };

/**
 * Every `ErrorKind` has a message, checked here rather than on a device.
 *
 * The messages moved into `i18n.ts` when the app became bilingual, and an object literal
 * there knows nothing about this union — a kind added to `api.ts` would have compiled
 * fine and shown a blank card. This is what says otherwise: it fails to compile if the
 * dictionary is missing one.
 */
type MessagesCoverEveryKind = Copy["failure"] extends Record<ErrorKind, Described>
  ? true
  : never;
const _messagesCoverEveryKind: MessagesCoverEveryKind = true;
void _messagesCoverEveryKind;

/**
 * A failure, said in the interface's voice.
 *
 * docs/10: errors explain and offer a fix, with no apologies and no vagueness. Each
 * message names what happened and what would change it, because "bir hata oluştu" tells
 * the person nothing they can act on. The assistant being down is deliberately not
 * phrased as a failure of the app — it is reduced capability, since the forecast and the
 * windows still work, and the same table in docs/10 says to say so.
 *
 * The `technical` line is the address, the status, or the field that failed. Added after
 * a device session where the screen said "sunucuya ulaşılamıyor" and the cause — the
 * backend was simply not running — took a round trip of questions to establish. The
 * interface knew which address it had tried and did not say. Naming it turns "check the
 * network" into something a person can actually check.
 *
 * The messages themselves are in `i18n.ts`, keyed by `ErrorKind` so that nothing has to
 * translate between two vocabularies of failure.
 */
export function describeError(error: unknown, language: Language): Described {
  const messages = copyFor(language).failure;
  if (error instanceof ApiError) {
    return { ...messages[error.kind], technical: error.message };
  }
  return messages.unknown;
}

/**
 * Whether trying the same thing again could plausibly work.
 *
 * Offering "tekrar dene" on a schema mismatch would be a lie: nothing about pressing it
 * changes the outcome.
 */
export function isWorthRetrying(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.kind === "unreachable" || error.kind === "timeout" || error.kind === "server";
}


/**
 * The window's conditions, as fields rather than as a sentence.
 *
 * D1 in docs/13 asked whether the assistant's answer should be formatted — bullets, bold,
 * maybe a chart. The tension it named is real: `reason` is a plain string on purpose, and
 * handing a 4B model markdown inside constrained decoding gives it a second thing to get
 * wrong for no gain.
 *
 * So the structure comes from the schema instead. Every figure here was computed by the
 * scoring engine and attached to the answer (ADR-0007), which means the client can render
 * each one as what it is — a temperature with a unit, a chance with a percent — rather
 * than parsing a phrase back out of prose the model wrote. The same argument that took the
 * window away from the model takes the formatting away from it.
 */
export type Reading = { label: string; value: string; tone?: "warn" | "cool" };

export function readingsOf(
  window: NonNullable<Answer["best_window"]>,
  language: Language,
): Reading[] {
  const copy = copyFor(language);
  const readings: Reading[] = [];

  if (window.temp_min_c != null && window.temp_max_c != null) {
    const low = Math.round(window.temp_min_c);
    const high = Math.round(window.temp_max_c);
    readings.push({
      label: copy.measure.temperature,
      value: copy.ask.readings.degrees(low, high),
    });
  }

  if (window.wind_max_kmh != null) {
    const speed = Math.round(window.wind_max_kmh);
    readings.push({
      label: copy.measure.wind,
      value: copy.ask.readings.windValue(speed),
      // Cool rather than a warning: a stiff breeze is information, and the engine already
      // refused to offer a window that broke the person's own limit.
      tone: speed >= 25 ? "cool" : undefined,
    });
  }

  if (window.precip_prob_max_pct != null) {
    readings.push({
      label: copy.measure.precipitation,
      value:
        window.precip_prob_max_pct === 0
          ? copy.ask.readings.precipNone
          : copy.ask.readings.precipValue(window.precip_prob_max_pct),
      tone: window.precip_prob_max_pct >= 40 ? "cool" : undefined,
    });
  }

  return readings;
}
