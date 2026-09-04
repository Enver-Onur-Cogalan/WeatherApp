/**
 * Compile every SkSL shader in the app, without a device.
 *
 * `Skia.RuntimeEffect.Make` returns `null` on a compile error and the `<Shader>` node
 * takes that null without complaint, so a typo paints nothing and says nothing.
 * `compileShader` in `src/lib/shader.ts` turns that into a throw, but a throw still needs
 * someone to run the app on a device to see it — and TypeScript, ESLint and the bundler
 * are all blind to the contents of a template literal.
 *
 * CanvasKit is the same Skia compiled to WebAssembly, so it accepts the same SkSL. That
 * makes the shaders checkable in CI on a plain Linux runner, which is the whole point:
 * this project has twice built on a capability that turned out to be absent and failed
 * silently, and the rule that came out of it was to measure rather than assume.
 *
 * What this does not check: how anything looks. A shader that compiles can still draw
 * the wrong picture, and only a device settles that.
 *
 *     node scripts/check-shaders.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const components = path.join(here, "..", "src", "components");

const canvaskit = require.resolve("canvaskit-wasm/bin/canvaskit.js");
const CanvasKit = await require(canvaskit)({
  locateFile: (file) => path.join(path.dirname(canvaskit), file),
});

/** Shaders are declared as `compileShader("name", \`…\`)`, which is what makes this findable. */
const DECLARATION = /compileShader\(\s*"([^"]+)",\s*`([\s\S]*?)`,?\s*\)/g;

let checked = 0;
let failed = 0;

for (const file of fs.readdirSync(components).filter((name) => name.endsWith(".tsx"))) {
  const source = fs.readFileSync(path.join(components, file), "utf8");

  for (const [, name, sksl] of source.matchAll(DECLARATION)) {
    checked += 1;

    // A backtick inside the source means the JavaScript template literal ended early,
    // even though the shader itself still compiles — SkSL sees it inside a `//` comment
    // and does not care. It happened, and this script cheerfully reported "ok" for a file
    // that was no longer valid JavaScript. `tsc` catches it; this says which shader.
    if (sksl.includes("`")) {
      failed += 1;
      console.error(
        `FAIL  ${file} :: ${name}\n` +
          "      a backtick in the shader source closes the template literal early\n",
      );
      continue;
    }
    let message = "";
    const effect = CanvasKit.RuntimeEffect.Make(sksl, (error) => {
      message = error;
    });

    if (effect === null) {
      failed += 1;
      console.error(`FAIL  ${file} :: ${name}\n${message}\n`);
    } else {
      console.log(`ok    ${file} :: ${name}  (${effect.getUniformCount()} uniforms)`);
      effect.delete();
    }
  }
}

if (checked === 0) {
  console.error("no shaders found — has the compileShader() declaration form changed?");
  process.exit(1);
}

console.log(`\n${checked - failed}/${checked} shaders compile`);
process.exit(failed === 0 ? 0 : 1);
