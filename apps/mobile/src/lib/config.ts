/**
 * Where the backend is, and what we ask it about.
 *
 * The base URL is not a secret — it is a host the user runs themselves — so it lives in
 * `EXPO_PUBLIC_API_URL` like any other public build-time value. Nothing that *is* secret
 * ever belongs here: the bundle is trivially extractable, which is a large part of why
 * there is a backend at all (CLAUDE.md).
 *
 * When it is unset, development falls back to the machine already serving the bundle.
 * The phone cannot reach `localhost` — that is the phone's own loopback — and hard-coding
 * a LAN address means editing a file every time the network changes. Metro already knows
 * the address the phone reached it on, so we borrow it and change the port. This is a
 * development convenience only: a release build with no URL configured has nowhere to go
 * and says so, rather than failing against a default that was never going to work.
 */

import Constants from "expo-constants";

const API_PORT = 8000;

function fromMetro(): string | null {
  // "192.168.1.24:8081" while a dev server is serving this bundle, absent otherwise.
  const hostUri = Constants.expoConfig?.hostUri;
  if (!hostUri) return null;

  const host = hostUri.split(":")[0];
  if (!host) return null;

  return `http://${host}:${API_PORT}`;
}

/**
 * The API root, or null when there is nowhere to go.
 *
 * Null rather than a thrown error or a bogus default: a missing address is a state the
 * interface can explain, and explaining it is more useful than a stack trace or a
 * connection that times out against a host that was never right.
 */
export const API_BASE_URL: string | null =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/+$/, "") ?? fromMetro();

/**
 * How long each endpoint is allowed to take.
 *
 * Measured rather than guessed. The assistant's median is 27 seconds on this hardware
 * and the slowest scenario in the suite took 47 (docs/08), so a conventional 30-second
 * timeout would abort answers that were about to arrive. The plan endpoint is
 * deterministic arithmetic over a cached forecast and has no such excuse.
 */
export const TIMEOUT_MS = {
  plan: 15_000,
  ask: 90_000,
} as const;

/**
 * The place the app is about.
 *
 * One constant, honestly named, until location management exists — docs/11 lists
 * `Konumlar` under Sen and it is unbuilt. It is exported rather than inlined so that the
 * screens can *show* which place an answer concerns (F3 in docs/13): an assistant that
 * sounds this confident should say what it is confident about.
 */
export const DEFAULT_LOCATION = {
  name: "İstanbul",
  latitude: 41.0082,
  longitude: 28.9784,
  timezone: "Europe/Istanbul",
} as const;
