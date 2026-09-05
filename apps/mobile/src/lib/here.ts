/**
 * Where the device actually is.
 *
 * This fills `is_current`, which docs/12 defines as the device's own position and reserves
 * to at most one place per account. It is deliberately not the same thing as the place
 * being looked at: you can be in İstanbul and want Saturday's weather in Rize.
 *
 * Three pieces, from three sources, and each is the right source for what it gives:
 *
 * - **Coordinates** from `expo-location`, at neighbourhood accuracy. `Balanced` rather
 *   than `High`: the forecast cache rounds to about a kilometre anyway, so a GPS fix
 *   precise to five metres would cost battery to produce a number that is immediately
 *   thrown away.
 * - **A name** from the platform's own reverse geocoder. Open-Meteo's geocoding is
 *   forward-only, and this needs no network of its own.
 * - **The timezone** from the device. For *where you are* that is not an approximation —
 *   the phone already knows, and it is the same value every timestamp in the app is
 *   reconciled through.
 */

import * as Location from "expo-location";

export type Here = {
  label: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

export type Permission = "granted" | "denied" | "unasked";

export async function permissionState(): Promise<Permission> {
  const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
  if (status === Location.PermissionStatus.GRANTED) return "granted";
  return canAskAgain && status === Location.PermissionStatus.UNDETERMINED
    ? "unasked"
    : "denied";
}

/**
 * Ask, then locate. Returns null when refused or unavailable.
 *
 * Null rather than throwing: being refused a location is a normal answer to a question the
 * app is allowed to ask once. Everything still works — a person types a place name
 * instead, which is what they had to do before this existed.
 */
export async function locate(ask: boolean): Promise<Here | null> {
  try {
    const existing = await Location.getForegroundPermissionsAsync();
    let granted = existing.status === Location.PermissionStatus.GRANTED;

    if (!granted) {
      if (!ask) return null;
      const asked = await Location.requestForegroundPermissionsAsync();
      granted = asked.status === Location.PermissionStatus.GRANTED;
    }
    if (!granted) return null;

    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const { latitude, longitude } = position.coords;
    return {
      label: await nameFor(latitude, longitude),
      latitude,
      longitude,
      timezone: deviceTimezone(),
    };
  } catch {
    // A refused permission, a disabled radio, an indoor fix that never arrives. None of
    // them are worth an error state on a screen: the place list still works by hand.
    return null;
  }
}

/**
 * What to call where you are.
 *
 * District before city, because "Beşiktaş" is more useful on a weather screen than
 * "İstanbul" and the forecast is the district's. Falls back through what the geocoder
 * actually returned rather than assuming any field exists — reverse geocoding is
 * inconsistent between platforms and between countries.
 */
async function nameFor(latitude: number, longitude: number): Promise<string> {
  try {
    const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (!place) return "Konumum";

    const near = place.district ?? place.subregion ?? place.city ?? place.region;
    const wider = place.city ?? place.region;

    if (near && wider && near !== wider) return `${near}, ${wider}`;
    return near ?? wider ?? "Konumum";
  } catch {
    return "Konumum";
  }
}

/**
 * The device's IANA zone.
 *
 * `Intl` is the only source that gives a name rather than an offset, and an offset is
 * wrong twice a year (docs/12). The fallback is a fixed name rather than a computed
 * offset for the same reason: a wrong name is at least a name the server can reason about.
 */
function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Istanbul";
  } catch {
    return "Europe/Istanbul";
  }
}

/**
 * Whether a new fix is far enough from the old one to be worth writing.
 *
 * A kilometre, which is the granularity the forecast cache already rounds to — anything
 * closer would rewrite a record and re-request a plan to receive the same answer. GPS
 * jitters by tens of metres while a phone sits on a table, so without this the current
 * location would be rewritten on every launch for no reason.
 */
export function movedFar(a: Here, b: { latitude: number; longitude: number }): boolean {
  const dLat = a.latitude - b.latitude;
  // Longitude degrees shrink toward the poles; without the cosine this is far too
  // sensitive in Scandinavia and far too lax near the equator.
  const dLon = (a.longitude - b.longitude) * Math.cos((a.latitude * Math.PI) / 180);
  const km = Math.sqrt(dLat * dLat + dLon * dLon) * 111.32;
  return km >= 1;
}
