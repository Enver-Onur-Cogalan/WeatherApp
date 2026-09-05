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

import type { AskResponse } from "@weatherapp/schema";

import { ApiError, type ErrorKind } from "@/lib/api";

export type { AskResponse };
export type Answer = AskResponse["answer"];

export type Exchange = {
  id: string;
  question: string;
  response: AskResponse;
};

/** Openers for the empty screen — the kinds of question İz cannot already answer. */
export const SUGGESTIONS = [
  "Bu hafta koşu için en iyi zaman ne zaman?",
  "Yarın sabah koşabilir miyim?",
  "Hafta sonu piknik yapmayı düşünüyoruz, ne dersin?",
];

export const VERDICT_LABELS: Record<NonNullable<Answer["verdict"]>, string> = {
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

/**
 * A failure, said in the interface's voice.
 *
 * docs/10: errors explain and offer a fix, with no apologies and no vagueness. Each of
 * these names what happened and what would change it, because "bir hata oluştu" tells
 * the person nothing they can act on.
 *
 * The assistant being down is deliberately not phrased as a failure of the app. It is
 * reduced capability — the forecast and the windows still work — and the same table in
 * docs/10 says to say so.
 */
const MESSAGES: Record<ErrorKind, { title: string; detail: string }> = {
  unconfigured: {
    title: "Sunucu adresi tanımlı değil",
    detail:
      "EXPO_PUBLIC_API_URL ayarlanmamış ve ödünç alınacak bir geliştirme sunucusu da yok.",
  },
  unreachable: {
    title: "Sunucuya ulaşılamıyor",
    detail:
      "Backend çalışıyor mu ve telefon aynı ağda mı, kontrol et. Sonra tekrar dene.",
  },
  timeout: {
    title: "Cevap zamanında gelmedi",
    detail:
      "Model cihazda çalışıyor ve yavaşlamış olabilir. Tekrar denemek çoğu zaman yeterli.",
  },
  forecast_unavailable: {
    title: "Tahmin alınamadı",
    detail:
      "Sunucu hava tahminine ulaşamadı ve elinde önbelleğe alınmış bir kayıt yok. " +
      "Birkaç dakika sonra tekrar dene.",
  },
  server: {
    title: "Sunucu hata verdi",
    detail: "Backend çalışıyor ama isteği tamamlayamadı. Sunucu günlüklerinde ayrıntısı var.",
  },
  request: {
    title: "İstek kabul edilmedi",
    detail: "Uygulama sunucunun beklemediği bir şey gönderdi. Bu bir uygulama hatası.",
  },
  unauthenticated: {
    title: "Oturum açman gerekiyor",
    detail:
      "Bu kısım hesabına bağlı. Sen sekmesinden giriş yap — tahminler ve pencereler " +
      "hesapsız da çalışmaya devam ediyor.",
  },
  contract: {
    title: "Sunucunun cevabı beklenen biçimde değil",
    detail:
      "İstemci ve sunucu şemaları ayrışmış. packages/schema yeniden üretilmeli, " +
      "iki taraf da güncellenmeli.",
  },
};

const UNKNOWN = {
  title: "Beklenmeyen bir sorun",
  detail: "Ne olduğunu söyleyemiyoruz. Tekrar denemek bir sonuç vermezse günlüklere bak.",
};

export type Described = { title: string; detail: string; technical?: string };

/**
 * The `technical` line is the address, the status, or the field that failed.
 *
 * Added after a device session where the screen said "sunucuya ulaşılamıyor" and the
 * cause — the backend was simply not running — took a round trip of questions to
 * establish. The interface knew which address it had tried and did not say. Naming it
 * turns "check the network" into something a person can actually check, which is what
 * docs/10 means by offering a fix.
 */
export function describeError(error: unknown): Described {
  if (error instanceof ApiError) return { ...MESSAGES[error.kind], technical: error.message };
  return UNKNOWN;
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

export function readingsOf(window: NonNullable<Answer["best_window"]>): Reading[] {
  const readings: Reading[] = [];

  if (window.temp_min_c != null && window.temp_max_c != null) {
    const low = Math.round(window.temp_min_c);
    const high = Math.round(window.temp_max_c);
    readings.push({
      label: "Sıcaklık",
      value: low === high ? `${low}°` : `${low}–${high}°`,
    });
  }

  if (window.wind_max_kmh != null) {
    const speed = Math.round(window.wind_max_kmh);
    readings.push({
      label: "Rüzgâr",
      value: `${speed} km/sa`,
      // Cool rather than a warning: a stiff breeze is information, and the engine already
      // refused to offer a window that broke the person's own limit.
      tone: speed >= 25 ? "cool" : undefined,
    });
  }

  if (window.precip_prob_max_pct != null) {
    readings.push({
      label: "Yağış",
      value: window.precip_prob_max_pct === 0 ? "yok" : `%${window.precip_prob_max_pct}`,
      tone: window.precip_prob_max_pct >= 40 ? "cool" : undefined,
    });
  }

  return readings;
}
