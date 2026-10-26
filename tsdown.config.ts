import { defineConfig } from "tsdown";

const shared = {
  platform: "neutral" as const,
  target: "es2022" as const,
  tsconfig: "tsconfig.json",
  sourcemap: true,
  clean: false,
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
    dts: { generator: "oxc" },
  },
  {
    ...shared,
    entry,
    format: "cjs",
    dts: { generator: "oxc" },
  },
]);
