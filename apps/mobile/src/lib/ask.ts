/**
 * Talking to the assistant.
 *
 * Backed by recorded `/ask` responses for now, so the screen can be built and judged
 * without the backend reachable from a phone. The shape is the real one — every fixture
 * came out of the actual endpoint — so connecting later replaces one function and
 * nothing else.
 *
 * The recorded latencies are kept and replayed. An assistant that answers instantly is
 * a different product to design for than one that takes twenty seconds, and the waiting
 * state is most of the screen's job.
 */

import fixture from "@/fixtures/ask.json";
import type { Window } from "@/lib/plan";

export type Answer = {
  verdict: "good" | "mixed" | "bad";
  best_window: Window | null;
  reason: string;
  warnings: string[];
};

export type AskResponse = {
  answer: Answer;
  tool_calls: string[];
  duration_ms: number;
  from_model: boolean;
  fallback_reason: string | null;
  on_device: boolean;
};

export type Exchange = {
  id: string;
  question: string;
  response: AskResponse;
};

type Recorded = { question: string; response: AskResponse };

const RECORDED = fixture as unknown as Recorded[];

/** Questions to offer when the screen is empty, taken from what was recorded. */
export const SUGGESTIONS = RECORDED.map((item) => item.question);

/**
 * Answer a question.
 *
 * Matches a recorded question when it recognises one and otherwise returns the first,
 * which is honest about being a fixture rather than pretending to understand. The real
 * implementation is a POST to `/ask` with the same signature.
 */
export async function askAssistant(question: string): Promise<AskResponse> {
  const asked = question.trim().toLocaleLowerCase("tr");
  const hit =
    RECORDED.find((item) => item.question.toLocaleLowerCase("tr") === asked) ??
    RECORDED.find((item) => overlaps(item.question, asked)) ??
    RECORDED[0];

  // Replayed, not instant. The wait is the part of this screen that needs designing.
  await new Promise((resolve) => setTimeout(resolve, hit.response.duration_ms));
  return hit.response;
}

/** Crude overlap so a rephrased question still finds its recorded answer. */
function overlaps(recorded: string, asked: string): boolean {
  const words = new Set(
    recorded
      .toLocaleLowerCase("tr")
      .split(/\W+/)
      .filter((word) => word.length > 3),
  );
  const shared = asked.split(/\W+/).filter((word) => words.has(word));
  return shared.length >= 2;
}

export const VERDICT_LABELS: Record<Answer["verdict"], string> = {
  good: "Uygun",
  mixed: "Kısmen",
  bad: "Uygun değil",
};

/** "1 araç · 21,4 sn · cihazda" — provenance, which docs/11 requires on screen. */
export function formatProvenance(response: AskResponse): string {
  const seconds = (response.duration_ms / 1000).toFixed(1).replace(".", ",");
  const tools =
    response.tool_calls.length === 0
      ? "araç yok"
      : `${response.tool_calls.length} araç`;
  const source = response.from_model ? "cihazda" : "motordan";
  return `${tools} · ${seconds} sn · ${source}`;
}
