# @k-otp/better-auth

## 0.1.0 — 2026-10-26

### Minor changes

- [2d6319c](https://github.com/k-otp/better-auth/commit/2d6319c3d526990d9ace374a464f0da87f89fa1e) Initial release of the Better Auth plugin for K-OTP phone verification.
  `kotp()` issues and verifies codes through `@k-otp/sdk/server` without ever
  returning the code. Default mode attaches a verified phone to a signed-in
  user; `mode: "signIn"` is an opt-in passwordless sign-in. — Thanks imjlk!

