---
npm/@k-otp/better-auth: minor
---

Initial release of the Better Auth plugin for K-OTP phone verification.
`kotp()` issues and verifies codes through `@k-otp/sdk/server` without ever
returning the code. Default mode attaches a verified phone to a signed-in
user; `mode: "signIn"` is an opt-in passwordless sign-in.
