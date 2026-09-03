/**
 * UUIDv7, generated on the device.
 *
 * ADR-0015 asks for v7 specifically, and `expo-crypto` only offers v4, so this is written
 * out. The difference is the point: v7 puts a millisecond timestamp in the high bits, so
 * ids sort by creation time. Rows arrive in a useful order, an index on the primary key
 * stays dense instead of scattering writes across the B-tree, and a list can be ordered
 * without a second column.
 *
 * Generated here rather than by the server so that a guest can create a profile with no
 * network, and signing up later uploads what they already have instead of renumbering it.
 *
 * Layout, per RFC 9562:
 *
 *     0                   1                   2                   3
 *     |unix_ts_ms (48 bits)               |ver|rand_a |var|rand_b   |
 */

import { getRandomBytes } from "expo-crypto";

export function uuidv7(): string {
  const bytes = getRandomBytes(16);
  const timestamp = Date.now();

  // 48 bits of milliseconds, most significant first. `Date.now()` exceeds 32 bits, so the
  // top two bytes are taken by division rather than by shifting — `>>>` would truncate to
  // 32 bits and silently produce ids that all share a prefix.
  bytes[0] = Math.floor(timestamp / 2 ** 40) & 0xff;
  bytes[1] = Math.floor(timestamp / 2 ** 32) & 0xff;
  bytes[2] = (timestamp >>> 24) & 0xff;
  bytes[3] = (timestamp >>> 16) & 0xff;
  bytes[4] = (timestamp >>> 8) & 0xff;
  bytes[5] = timestamp & 0xff;

  // Version 7 in the high nibble of byte 6, variant 10 in the top bits of byte 8. The
  // rest stays random.
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
