import {
  defineErrorCodes,
  type RawError,
} from "@better-auth/core/utils/error-codes";

/**
 * Stable error codes. Messages never include a phone number or OTP code.
 * Apps match `error.code` (and HTTP 402 for credits).
 *
 * Same shape as Better Auth 1.7 `defineErrorCodes`: `{ code, message }`.
 */
const KOTP_ERROR_MESSAGES = {
  KOTP_CREDITS_EXHAUSTED:
    "K-OTP credits are exhausted. Top up the wallet before issuing another code.",
  KOTP_UNAVAILABLE:
    "K-OTP did not confirm the request. Retry the same action; the plugin reuses the idempotency key.",
  KOTP_RATE_LIMITED:
    "K-OTP rate limited the request. Retry after the indicated delay.",
  KOTP_COOLDOWN:
    "A code was sent to this number too recently. Wait and try again.",
  KOTP_CODE_MISMATCH: "The code does not match. Try again.",
  KOTP_MAX_ATTEMPTS: "Too many incorrect codes. Request a new code.",
  KOTP_EXPIRED: "The code has expired. Request a new code.",
  KOTP_ALREADY_VERIFIED: "This code was already used.",
  KOTP_REPLACED: "This code was replaced by a newer one. Use the latest code.",
  KOTP_NOT_FOUND: "K-OTP has no issue with this id.",
  KOTP_PENDING_ISSUE_NOT_FOUND:
    "No pending phone verification for this session.",
  KOTP_ISSUE_NOT_OWNED:
    "This phone verification belongs to a different session.",
  KOTP_INVALID_PHONE: "Phone number could not be normalized to E.164.",
  KOTP_INVALID_CODE: "Code must be 6 digits.",
  KOTP_PHONE_IN_USE:
    "This phone number is already verified on another account.",
  KOTP_PHONE_AMBIGUOUS:
    "More than one account has this phone hash. Enable uniquePhone before using sign-in.",
  KOTP_SESSION_REQUIRED: "Sign in before verifying a phone number.",
  KOTP_REJECTED: "K-OTP rejected the request.",
  KOTP_UNAUTHORIZED: "K-OTP rejected the API key.",
  KOTP_FORBIDDEN: "K-OTP refused the API key for this operation.",
  KOTP_ENCRYPT_FAILED:
    "The encrypt hook failed. The phone number was not stored.",
} as const;

export type KotpErrorCode = keyof typeof KOTP_ERROR_MESSAGES;

export const KOTP_ERROR_CODES: {
  [K in KotpErrorCode]: RawError<K>;
} = defineErrorCodes(KOTP_ERROR_MESSAGES);

export type KotpError = (typeof KOTP_ERROR_CODES)[KotpErrorCode];
