# @k-otp/better-auth

[English](./README.md) | [한국어](./README_ko.md)

Better Auth plugin for [K-OTP](https://k-otp.dev): issue and verify phone OTP
codes delivered by KakaoTalk AlimTalk, with SMS fallback on by default. The
code is never returned to your app and never logged.

Peer dependency: `better-auth` `>=1.7.0 <2`. Runs on Cloudflare Workers, Bun,
and Node.js 20+ (Web Crypto and `fetch` only).

## Install

```bash
npm install @k-otp/better-auth better-auth
```

`@k-otp/sdk` is a regular dependency. The server plugin uses
`@k-otp/sdk/server` (`sk_` keys, fetch-only, no Node.js built-ins).

## Server

```ts
import { betterAuth } from "better-auth";
import { kotp } from "@k-otp/better-auth";

export const auth = betterAuth({
  plugins: [
    kotp({
      secretKey: process.env.KOTP_SECRET_KEY!, // sk_... never a pk_ key
      hashSecret: process.env.KOTP_HASH_SECRET!, // HMAC key, 16+ chars
    }),
  ],
});
```

Default mode is `verify`: a signed-in user adds a verified phone to their
account. Both routes require that session.

| Method | Path | Body | Client |
| --- | --- | --- | --- |
| POST | `/kotp/issue` | `{ phoneNumber }` | `authClient.kotp.issue({ phoneNumber })` |
| POST | `/kotp/verify` | `{ code }` | `authClient.kotp.verify({ code })` |

Paths sit under the Better Auth base path (`/api/auth` by default), so the
HTTP routes are `/api/auth/kotp/issue` and `/api/auth/kotp/verify`. They are
namespaced so they do not collide with Better Auth's built-in phone-number
plugin.

`issue` generates an `Idempotency-Key` (UUID), stores the pending issue
(issue id, phone hash, user id, expiry) and never returns the code. A network
error or HTTP 5xx is `KOTP_UNAVAILABLE` with `retryable: true`; the next
`issue` for the same user and number reuses that idempotency key. HTTP 402 is
`KOTP_CREDITS_EXHAUSTED` (status 402) so you can alert on credits separately
from other failures.

`verify` loads the pending issue owned by the session, calls K-OTP, and maps
`reasonCode` to a Better Auth `APIError`:

| `reasonCode` | `error.code` | HTTP |
| --- | --- | --- |
| `MISMATCH` | `KOTP_CODE_MISMATCH` | 400 |
| `MAX_ATTEMPTS` | `KOTP_MAX_ATTEMPTS` | 403 |
| `EXPIRED` | `KOTP_EXPIRED` | 400 |
| `ALREADY_VERIFIED` | success, if this session owns the issue | — |
| `REPLACED` | `KOTP_REPLACED` | 409 |
| `NOT_FOUND` | `KOTP_NOT_FOUND` | 404 |

Another session cannot verify the code: the lookup is scoped to the session
user, and K-OTP is not called (`KOTP_PENDING_ISSUE_NOT_FOUND`).

## Client

```ts
import { createAuthClient } from "better-auth/client";
import { kotpClient } from "@k-otp/better-auth/client";

export const authClient = createAuthClient({
  plugins: [kotpClient()],
});

await authClient.kotp.issue({ phoneNumber: "010-1234-5678" });
await authClient.kotp.verify({ code: "123456" });
```

Import the client plugin from `@k-otp/better-auth/client` in the browser. The
root entry loads the server plugin.

## Options

| Option | Default | |
| --- | --- | --- |
| `secretKey` | required | `sk_` / `sk_test_` key. |
| `hashSecret` | required | HMAC key for `phoneNumberHash`. Rotating it invalidates stored hashes. |
| `baseUrl` | `https://api.k-otp.dev/v1` | Must include `/v1`. |
| `purpose` | `phone_verify` or `phone_sign_in` | Same number + purpose replaces the previous code. |
| `template` | omitted | K-OTP `templateId`. |
| `smsFallback` | omitted (K-OTP default: on) | `false` is AlimTalk only. |
| `ttlSeconds` | K-OTP default 180 | 30–600. |
| `maxAttempts` | K-OTP default 5 | 1–10. |
| `mode` | `"verify"` | `"signIn"` opts into passwordless sign-in. |
| `uniquePhone` | `false` | Unique constraint on `phoneNumberHash`. Use `true` for sign-in. |
| `encrypt` | omitted | Called only on success, with the E.164 number. Ciphertext is stored. |
| `normalizePhone` | Korean `+82` helper | Must return E.164. |
| `cooldownSeconds` | `60` | Per number, after a successful issue. `0` disables. |
| `rateLimit` | issue 5/60s, verify 10/60s | Better Auth path rules (`window` in seconds). `false` omits a rule. |
| `onVerified` | omitted | `{ user, phoneHash, phone, mode }`. Do not log `phone`. |
| `fetch` | `globalThis.fetch` | Tests and proxies. |
| `signIn.getTempEmail` | `${hash}@users.phone.k-otp.invalid` | Not a mailbox. |
| `signIn.getTempName` | `K-OTP user` | No phone number in the name. |

## Sign-in mode

```ts
kotp({
  secretKey: process.env.KOTP_SECRET_KEY!,
  hashSecret: process.env.KOTP_HASH_SECRET!,
  mode: "signIn",
  uniquePhone: true,
})
```

Off by default. Trade-offs:

- A phone number is not a stable identity. Carriers recycle numbers. Anyone
  who later receives that number can sign into the account unless you add
  your own step-up (email, passkey) or expire phone trust.
- There is no email to recover the account. The stored email is a synthetic
  address derived from the hash (`…@users.phone.k-otp.invalid`). It is not
  deliverable. `emailVerified` stays false.
- Set `uniquePhone: true`. Without it, two rows with the same hash make
  sign-in fail with `KOTP_PHONE_AMBIGUOUS`.
- Ownership of the pending issue is an httpOnly signed cookie (`kotp_pending`),
  not a session. The cookie alone is not the code; verify still needs the
  code K-OTP sent.

`verify` mode does not create users. Use it when the account already exists.

## Schema

Generate a migration with the Better Auth CLI after adding the plugin:

```bash
npx @better-auth/cli@latest generate
```

User fields (all `input: false`; clients cannot set them):

| Field | Stored | Returned on session |
| --- | --- | --- |
| `phoneNumberHash` | HMAC-SHA256 hex of `phone:` + E.164, keyed by `hashSecret` | yes |
| `phoneVerifiedAt` | date | yes |
| `phoneNumberEncrypted` | only when `encrypt` is set | no |

`uniquePhone: true` adds a unique constraint on `phoneNumberHash`. Unverified
users have a null hash, so they do not collide. Changing `uniquePhone` changes
the generated migration.

Pending issues live in `kotpIssue` (`issueId`, `phoneHash`, `userId`,
`ownerTokenHash`, `idempotencyKey`, `purpose`, `status`, `expiresAt`,
`createdAt`, and a short-lived `phoneSeal`). The seal is AES-GCM of the
normalized number under `hashSecret`, so `encrypt` / `onVerified` can run on
verify without a plaintext column. It is wiped when the row is consumed or
failed, and no endpoint returns it.

Read a ciphertext the app stored:

```ts
import { readEncryptedPhone } from "@k-otp/better-auth";

const phone = await readEncryptedPhone(user, decrypt);
```

`hashPhoneNumber(e164, hashSecret)` reproduces `phoneNumberHash`.
`normalizeKoreanE164` is the default normalizer (`010-1234-5678`,
`+82 10 1234 5678` → `+821012345678`).

## Privacy

Store the hash by default. Persist the raw number only if you pass `encrypt`,
and only with a lawful basis (in Korea, consent or another basis under the
Personal Information Protection Act) that covers a phone number.

K-OTP, Kakao (AlimTalk), and the SMS carrier that delivers the fallback are
data processors for the send. Disclose them. K-OTP stores numbers as hashes
and never returns the code; this plugin follows the same rule. Do not log
request bodies. `hashSecret` must be high-entropy: a leaked secret plus the
hash column can be brute-forced over the Korean mobile range.

Test keys (`sk_test_`) never send a message and never spend credits. See the
[test-mode guide](https://k-otp.dev/docs/guides/test-mode).

## Workers

See [docs/workers.md](./docs/workers.md). Wrangler resolves
`@k-otp/sdk/server` with the `workerd` condition, so the real client is used.

## Errors worth alerting on

`KOTP_CREDITS_EXHAUSTED` (HTTP 402) means the organization wallet cannot send.
`KOTP_UNAVAILABLE` (`retryable: true`) means the outcome may be unknown; retry
`issue`, do not mint your own idempotency key (the plugin keeps it).

## Publishing

Maintainers: [docs/releasing.md](./docs/releasing.md). The Release workflow
publishes with npm provenance only after the `NPM_TOKEN` repository secret is
set.
