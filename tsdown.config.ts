import { defineConfig } from "tsdown";

const shared = {
  platform: "neutral" as const,
  target: "es2022" as const,
  tsconfig: "tsconfig.json",
  sourcemap: true,
  clean: false,
  // Declarations are emitted by `ttsc -p tsconfig.dts.json`. oxc's dts
  // generator requires isolatedDeclarations and would widen `kotp()` back
  // to `BetterAuthPlugin`, which drops client endpoint inference.
  dts: false,
};

const entry = {
  index: "src/index.ts",
  client: "src/client.ts",
};

export default defineConfig([
  {
    ...shared,
    entry,
    format: "esm",
  },
  {
    ...shared,
    entry,
    format: "cjs",
  },
]);
