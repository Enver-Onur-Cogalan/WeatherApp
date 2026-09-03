/**
 * Who is signed in, and the tokens that say so.
 *
 * Two rules from docs/07 shape everything here.
 *
 * **The refresh token goes in the keystore, never in AsyncStorage.** It is the long-lived
 * credential; AsyncStorage is unencrypted and readable on a rooted or jailbroken device.
 * `expo-secure-store` is Keychain on iOS and Keystore on Android.
 *
 * **The access token lives in memory only.** It is valid for fifteen minutes, so writing
 * it to disk buys nothing and leaves a credential lying around. It is a module variable
 * rather than store state because it changes on every refresh and nothing should re-render
 * when it does.
 *
 * The third rule is not in any document, because it only exists once rotation does:
 * **refresh must be single-flight.** The server revokes an entire token family when a
 * refresh token is presented twice, since that is what theft looks like. Two requests
 * expiring together and each refreshing on its own is therefore not a wasted round trip —
 * it is indistinguishable from a stolen token, and the server correctly signs the user out
 * of everything. `inFlight` below is what stops that, and it is load-bearing.
 */

import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

import { API_BASE_URL, TIMEOUT_MS } from "@/lib/config";

const REFRESH_KEY = "weatherapp.refresh_token";

/**
 * Whether the person has already answered the gate.
 *
 * Not a secret, and `expo-secure-store` is for secrets — but it is installed, it survives
 * a reinstall the same way the refresh token does, and adding a second storage library
 * for one boolean costs more than the impurity. Written down so the next person does not
 * mistake it for a considered use of the keystore.
 *
 * It has to persist. A gate that reappears on every launch is the wall ADR-0009 exists to
 * avoid: the first person to open this project will not create an account to look around,
 * and being asked again every time is worse than being asked once.
 */
const GUEST_KEY = "weatherapp.chose_guest";

/** Fifteen minutes of validity, so disk would be a liability rather than a convenience. */
let accessToken: string | null = null;

/** The one refresh in progress, if any. See the note above — this prevents a lockout. */
let inFlight: Promise<string | null> | null = null;

/**
 * Bumped whenever the session changes shape.
 *
 * A refresh that is still in the air when the user signs out must not clear the slot a
 * newer cycle has since taken, and must not write a token into a session that has ended.
 * Comparing generations is how a finished attempt tells whether it is still the current
 * one — the kind of race that otherwise shows up as an occasional inexplicable logout.
 */
let generation = 0;

export type Account = { id: string; email: string };

export type AuthStatus =
  /** Reading the keystore. Nothing is known yet, and the UI should not guess. */
  | "restoring"
  /** No account. Everything still works; data stays on the device (ADR-0009). */
  | "guest"
  | "signed-in";

type AuthState = {
  status: AuthStatus;
  account: Account | null;
  /** The gate has been answered — with an account, or by deciding not to have one. */
  chosenGuest: boolean;
  restore: () => Promise<void>;
  continueAsGuest: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

export class AuthError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

type TokenPair = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

export const useAuth = create<AuthState>((set) => ({
  status: "restoring",
  account: null,
  chosenGuest: false,

  /**
   * Pick up where the last session left off.
   *
   * A stored refresh token is not proof of anything — it may have expired, or the family
   * may have been revoked — so it is spent on a real refresh before the app claims to be
   * signed in. Failing that, the token is cleared and the app is a guest, which is a
   * working state rather than an error.
   */
  restore: async () => {
    const chosenGuest = (await readFlag(GUEST_KEY)) === "1";
    const stored = await readRefreshToken();

    if (stored === null) {
      set({ status: "guest", account: null, chosenGuest });
      return;
    }

    const token = await refreshAccessToken();
    if (token === null) {
      set({ status: "guest", account: null, chosenGuest });
      return;
    }

    const account = await fetchAccount(token);
    set(
      account === null
        ? { status: "guest", account: null, chosenGuest }
        : { status: "signed-in", account, chosenGuest },
    );
  },

  continueAsGuest: async () => {
    await writeFlag(GUEST_KEY, "1");
    set({ chosenGuest: true, status: "guest", account: null });
  },

  signIn: async (email, password) => {
    const account = await authenticate("/auth/login", email, password);
    // Having an account answers the gate too, so signing out later lands in the app as a
    // guest rather than back at a screen the person has already been through.
    await writeFlag(GUEST_KEY, "1");
    set({ status: "signed-in", account, chosenGuest: true });
  },

  signUp: async (email, password) => {
    const account = await authenticate("/auth/register", email, password);
    await writeFlag(GUEST_KEY, "1");
    set({ status: "signed-in", account, chosenGuest: true });
  },

  /**
   * End the session, locally no matter what.
   *
   * The server call is best-effort: if it fails, the tokens are still cleared here. A
   * sign-out that leaves the user signed in because the network was down is the one
   * outcome this must never produce.
   */
  signOut: async () => {
    const stored = await readRefreshToken();
    accessToken = null;
    // Any refresh still in the air belongs to a session that no longer exists.
    generation += 1;
    inFlight = null;
    await clearRefreshToken();
    // `chosenGuest` deliberately survives a sign-out. Someone who signs out has answered
    // the gate; sending them back to it would read as being thrown out of the app.
    set({ status: "guest", account: null });

    if (stored !== null) {
      try {
        await call("/auth/logout", { refresh_token: stored });
      } catch {
        // Already signed out on this device; the token expires on its own.
      }
    }
  },
}));

export function getAccessToken(): string | null {
  return accessToken;
}

/**
 * Exchange the stored refresh token for a new access token.
 *
 * Everything that needs a refresh calls this, and they all get the same promise. The
 * second caller must not start a second rotation — see the module note.
 */
export async function refreshAccessToken(): Promise<string | null> {
  if (inFlight !== null) return inFlight;

  const mine = ++generation;

  inFlight = (async () => {
    const stored = await readRefreshToken();
    if (stored === null) return null;

    try {
      const pair = await call<TokenPair>("/auth/refresh", { refresh_token: stored });
      // Signed out while this was in flight: the tokens belong to a dead session, and
      // writing them back would silently sign the user in again.
      if (generation !== mine) return null;

      accessToken = pair.access_token;
      await SecureStore.setItemAsync(REFRESH_KEY, pair.refresh_token);
      return pair.access_token;
    } catch (error) {
      // A 401 here means the token is spent, expired, or its family was revoked. All
      // three end the same way: this device is a guest until someone signs in again.
      if (error instanceof AuthError && error.status === 401) {
        accessToken = null;
        await clearRefreshToken();
        useAuth.setState({ status: "guest", account: null });
      }
      return null;
    } finally {
      if (generation === mine) inFlight = null;
    }
  })();

  return inFlight;
}

async function authenticate(
  path: string,
  email: string,
  password: string,
): Promise<Account> {
  const pair = await call<TokenPair>(path, { email: email.trim(), password });
  accessToken = pair.access_token;
  await SecureStore.setItemAsync(REFRESH_KEY, pair.refresh_token);

  const account = await fetchAccount(pair.access_token);
  if (account === null) {
    throw new AuthError(500, "Signed in, but the account could not be read back.");
  }
  return account;
}

async function fetchAccount(token: string): Promise<Account | null> {
  try {
    return await call<Account>("/auth/me", undefined, token);
  } catch {
    return null;
  }
}

/**
 * A bare request to the account endpoints.
 *
 * Deliberately not `lib/api.ts`'s `post`. That one refreshes and retries on a 401, which
 * here would mean a failed login triggering a refresh, and a failed refresh triggering
 * another one. The auth endpoints are the bottom of the stack and cannot depend on it.
 */
async function call<T>(path: string, body?: unknown, token?: string): Promise<T> {
  if (API_BASE_URL === null) {
    throw new AuthError(0, "No API address is configured.");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS.plan);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new AuthError(0, `Could not reach ${API_BASE_URL}.`);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 204) return undefined as T;

  if (!response.ok) {
    throw new AuthError(response.status, await detailOf(response));
  }

  return (await response.json()) as T;
}

async function detailOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // A non-JSON error body tells us nothing the status does not.
  }
  return `HTTP ${response.status}`;
}

async function readFlag(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function writeFlag(key: string, value: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    // The gate will be shown again next launch. Annoying, not broken.
  }
}

async function readRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_KEY);
  } catch {
    // The keystore can refuse — a device with no passcode, a locked keychain. Treated as
    // "no session" rather than as a crash: the app works fine as a guest.
    return null;
  }
}

async function clearRefreshToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(REFRESH_KEY);
  } catch {
    // Nothing useful to do. The token expires on the server's schedule regardless.
  }
}
