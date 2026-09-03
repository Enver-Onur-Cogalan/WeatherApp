// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require("expo/metro-config");

/**
 * The project ran with no Metro config at all until now, which is the right default —
 * `getDefaultConfig` already handles this monorepo's workspace resolution, and a config
 * file that only repeats defaults is a thing to keep in step for nothing.
 *
 * One line earns it. `drizzle/migrations.js` imports the generated `.sql` files, and
 * Metro resolves only its known source extensions, so without `sql` in the list the
 * bundle fails to build with "None of these files exist" pointing at a file that plainly
 * does. The migrations have to be in the bundle: a phone has no filesystem to read them
 * from at launch.
 */
const config = getDefaultConfig(__dirname);
config.resolver.sourceExts.push("sql");

module.exports = config;
