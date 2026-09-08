/**
 * What the tests stand on instead of a device.
 *
 * Two native modules are replaced here rather than in each file. The keystore is the one
 * every persisted preference in this app goes through — the chosen place, the chosen
 * language, whether the tour has run, whether somebody answered the gate — so a fake for
 * it is the difference between testing those and not. A Map is enough: what the tests
 * care about is what was asked for and what came back, not that it survived a reboot.
 *
 * The names are prefixed because Jest hoists `jest.mock` above everything else in the
 * file, and refuses a factory that reaches for a variable which might not exist yet.
 * Anything called `mock*` is exempted.
 *
 * The Map is not exported. A test arranges and inspects the keystore through the mocked
 * module itself — `getItemAsync.mockResolvedValueOnce`, `expect(setItemAsync)` — which is
 * the seam the app actually uses, rather than through a back door into the fake.
 */

const mockKeystore = new Map();

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key) =>
    mockKeystore.has(key) ? mockKeystore.get(key) : null,
  ),
  setItemAsync: jest.fn(async (key, value) => void mockKeystore.set(key, value)),
  deleteItemAsync: jest.fn(async (key) => void mockKeystore.delete(key)),
}));

/**
 * Refused by default.
 *
 * The app is built so that everything works without location permission, and a test that
 * silently had it would never exercise that. A test that wants a fix arranges one.
 */
jest.mock("expo-location", () => ({
  PermissionStatus: { GRANTED: "granted", UNDETERMINED: "undetermined", DENIED: "denied" },
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: jest.fn(async () => ({
    status: "denied",
    canAskAgain: true,
  })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: "denied" })),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(async () => []),
}));

beforeEach(() => {
  mockKeystore.clear();
});
