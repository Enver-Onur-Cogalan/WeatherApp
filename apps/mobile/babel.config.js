/**
 * An Expo project normally needs no Babel config: `babel-preset-expo` is applied
 * automatically, and it is what configures the worklets plugin that Reanimated depends
 * on. This file exists for one plugin, and keeps the preset so nothing else changes.
 *
 * `babel-plugin-inline-import` turns `import m from './0000_….sql'` into a string
 * literal at build time. Adding `sql` to Metro's `sourceExts` is only half of it: without
 * this the resolver finds the file and then hands it to the JavaScript parser, which
 * fails on `CREATE TABLE`. Both halves are needed, and each one alone produces an error
 * that looks like the other half is missing.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [["inline-import", { extensions: [".sql"] }]],
  };
};
