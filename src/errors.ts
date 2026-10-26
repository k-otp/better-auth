/**
 * Stable error codes. Messages never include a phone number or OTP code.
 * Apps match `error.code` (and HTTP 402 for credits).
 */
export const KOTP_ERROR_CODES = {
  KOTP_CREDITS_EXHAUSTED: {
    code: "KOTP_CREDITS_EXHAUSTED",
    message:
      "K-OTP credits are exhausted. Top up the wallet before issuing another code.",
  },
  KOTP_UNAVAILABLE: {
    code: "KOTP_UNAVAILABLE",
    message:
      "K-OTP did not confirm the request. Retry the same action; the plugin reuses the idempotency key.",
  },
  KOTP_RATE_LIMITED: {
    code: "KOTP_RATE_LIMITED",
    message: "K-OTP rate limited the request. Retry after the indicated delay.",
  },
  KOTP_COOLDOWN: {
    code: "KOTP_COOLDOWN",
    message: "A code was sent to this number too recently. Wait and try again.",
  },
  KOTP_CODE_MISMATCH: {
    code: "KOTP_CODE_MISMATCH",
    message: "The code does not match. Try again.",
  },
  KOTP_MAX_ATTEMPTS: {
    code: "KOTP_MAX_ATTEMPTS",
    message: "Too many incorrect codes. Request a new code.",
  },
  KOTP_EXPIRED: {
    code: "KOTP_EXPIRED",
    message: "The code has expired. Request a new code.",
  },
  KOTP_ALREADY_VERIFIED: {
    code: "KOTP_ALREADY_VERIFIED",
    message: "This code was already used.",
  },
  KOTP_REPLACED: {
    code: "KOTP_REPLACED",
    message: "This code was replaced by a newer one. Use the latest code.",
  },
  KOTP_NOT_FOUND: {
    code: "KOTP_NOT_FOUND",
    message: "K-OTP has no issue with this id.",
  },
  KOTP_PENDING_ISSUE_NOT_FOUND: {
    code: "KOTP_PENDING_ISSUE_NOT_FOUND",
    message: "No pending phone verification for this session.",
  },
  KOTP_ISSUE_NOT_OWNED: {
    code: "KOTP_ISSUE_NOT_OWNED",
    message: "This phone verification belongs to a different session.",
  },
  KOTP_INVALID_PHONE: {
    code: "KOTP_INVALID_PHONE",
    message: "Phone number could not be normalized to E.164.",
  },
  KOTP_INVALID_CODE: {
    code: "KOTP_INVALID_CODE",
    message: "Code must be 6 digits.",
  },
  KOTP_PHONE_IN_USE: {
    code: "KOTP_PHONE_IN_USE",
    message: "This phone number is already verified on another account.",
  },
  KOTP_PHONE_AMBIGUOUS: {
    code: "KOTP_PHONE_AMBIGUOUS",
    message:
      "More than one account has this phone hash. Enable uniquePhone before using sign-in.",
  },
  KOTP_SESSION_REQUIRED: {
    code: "KOTP_SESSION_REQUIRED",
    message: "Sign in before verifying a phone number.",
  },
  KOTP_REJECTED: {
    code: "KOTP_REJECTED",
    message: "K-OTP rejected the request.",
  },
  KOTP_UNAUTHORIZED: {
    code: "KOTP_UNAUTHORIZED",
    message: "K-OTP rejected the API key.",
  },
  KOTP_FORBIDDEN: {
    code: "KOTP_FORBIDDEN",
    message: "K-OTP refused the API key for this operation.",
  },
  KOTP_ENCRYPT_FAILED: {
    code: "KOTP_ENCRYPT_FAILED",
    message: "The encrypt hook failed. The phone number was not stored.",
  },
} as const;

export type KotpErrorCode = keyof typeof KOTP_ERROR_CODES;

export type KotpError = (typeof KOTP_ERROR_CODES)[KotpErrorCode];
