# Contributing

Requirements: [Bun](https://bun.sh) 1.4.2 (`packageManager`). Go on `PATH` the
first time `ttsc` builds its lint plugin (cached under
`node_modules/.cache/ttsc`).

```bash
bun install
bun run check
```

| Script | What it does |
| --- | --- |
| `bun run typecheck` | `ttsc` (TypeScript 7) over `src/` and tests, with `@ttsc/lint`. |
| `bun run lint` / `lint:fix` | Biome lint + format. |
| `bun run test` | `bun test` with a fake `fetch` and Better Auth's memory adapter. |
| `bun run build` | tsdown: ESM + CJS and declarations for `.` and `./client`. |
| `bun run check` | typecheck, lint, test, build. |

User-facing changes need a Sampo changeset (`sampo add`). See
[docs/releasing.md](./docs/releasing.md). Do not publish from a fork; the
Release workflow publishes from `main` when `NPM_TOKEN` is set.
