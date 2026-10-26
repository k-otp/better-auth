# AGENTS.md

Guide for coding agents working in `k-otp/better-auth`
(https://github.com/k-otp/better-auth).

## What this repo is

Public, MIT-licensed Better Auth plugin (`@k-otp/better-auth`) for the K-OTP
Korean OTP API (`https://api.k-otp.dev/v1`). One package. Server plugin
`kotp()`, client plugin `kotpClient()` from `@k-otp/better-auth/client`.

The OTP code is never returned and never logged. Phone numbers are stored as
an HMAC, plus a short-lived AES-GCM seal on the pending-issue row that is
wiped when the row is consumed or failed. Raw numbers are written to the user
row only when the app passes `encrypt`.

## Hard rules

- This repository is **public**. Never add secrets, real API keys, customer
  data, or code copied from private repositories.
- Do not push, publish to npm, or create GitHub releases unless the user
  explicitly asks. The owner publishes after review.
- Never log a phone number or an OTP code. Error messages stay static.
- `secretKey` is an `sk_` key and stays on the server. Do not import the root
  entry from browser code; use `@k-otp/better-auth/client`.
- Web Crypto only. No `node:` imports. The package must keep working on
  Cloudflare Workers, Bun, and Node 20+.
- Peer dependency is `better-auth` `>=1.7.0 <2`. Do not lower the minimum.

## Toolchain

- Bun 1.4.2 is the package manager, script runner and test runner.
- TypeScript 7 checked with `ttsc` (+ `@ttsc/lint`, `lint.config.ts`).
- Biome for lint/format (`biome.json`). tsdown for the build. Sampo for
  changesets (`.sampo/config.toml`).

## Commands

```bash
bun install
bun run typecheck
bun run lint
bun run test
bun run build
bun run check
sampo add -p npm/@k-otp/better-auth -b patch -m "Fix ..."
```

## Publishing

See `docs/releasing.md`. The Release workflow publishes only when the
`NPM_TOKEN` repository secret is set. Do not add that secret yourself.
