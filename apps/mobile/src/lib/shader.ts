/**
 * Compiling an SkSL shader, loudly.
 *
 * `Skia.RuntimeEffect.Make` returns `null` when the source does not compile, and the
 * `<Shader>` node accepts that null without complaint — so a typo in a shader paints
 * nothing at all and reports nothing at all. That is the failure mode this project has
 * been bitten by twice already (a `NaN` colour and an MLX engine ignoring `format`, both
 * silent), and CLAUDE.md's rule about not building on an unverified guarantee applies to
 * our own code as much as to anyone else's.
 *
 * Throwing is right rather than harsh: the source is a module-scope string constant, so
 * it either compiles on every device or on none. There is no runtime condition to
 * degrade gracefully around, and the first render in development is where it should be
 * found.
 *
 * This version of the library takes no error callback, so `null` is the whole diagnosis
 * we get. The shader's name at least says which one.
 */

import { Skia, type SkRuntimeEffect } from "@shopify/react-native-skia";

export function compileShader(name: string, sksl: string): SkRuntimeEffect {
  const effect = Skia.RuntimeEffect.Make(sksl);
  if (effect === null) {
    throw new Error(
      `SkSL shader "${name}" failed to compile. It would otherwise have drawn nothing, ` +
        `silently. Check the source in the component that declares it.`,
    );
  }
  return effect;
}
