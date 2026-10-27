---
npm/@k-otp/better-auth: patch
---

Fix plugin type inference so `authClient.kOtp.issue` / `verify` stay typed, including next to `organizationClient()` and `magicLinkClient()`.

`kotp()` and `kotpClient()` no longer widen to `BetterAuthPlugin`, which had erased those methods and sibling plugins. The registry key is `k-otp` (matching the plugin id), and `@better-auth/core` is a peer dependency (`^1.7.13`, the range Better Auth 1.7.13 pins and its published plugins peer) so the augmentation resolves when the installer does not hoist it. Error codes use Better Auth 1.7 `defineErrorCodes`. Paths are unchanged: `POST /k-otp/issue`, `POST /k-otp/verify`.
