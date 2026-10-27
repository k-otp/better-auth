import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const source = ".cache/dts";
const dest = "dist";

const walk = (dir: string): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const from = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(from);
      continue;
    }
    if (!entry.name.endsWith(".d.ts")) continue;
    const target = join(dest, relative(source, from));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(from, target);
    copyFileSync(from, `${target.slice(0, -5)}.d.cts`);
  }
};

walk(source);
