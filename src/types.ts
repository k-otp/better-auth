export type KotpMode = "verify" | "signIn";

export type KotpRateRule = {
  /** Window in seconds. Better Auth's plugin rateLimit uses seconds. */
  window: number;
  max: number;
};

/**
 * Server plugin options. `secretKey` and `hashSecret` are server-only and
 * must never be shipped to a browser bundle.
 */
export type KotpOptions = {
  /** K-OTP secret key (`sk_...` or `sk_test_...`). */
  secretKey: string;
  /**
   * HMAC key for `phoneNumberHash`. At least 16 characters; 32+ recommended.
   * Rotating it invalidates every stored hash.
   */
  hashSecret: string;
  /** Defaults to `https://api.k-otp.dev/v1`. Must include `/v1`. */
  baseUrl?: string;
  /**
   * K-OTP `purpose`. A new issue for the same number and purpose replaces
   * the previous code. Default `phone_verify` or `phone_sign_in`.
   */
  purpose?: string;
  /** K-OTP `templateId`. The default template is used when omitted. */
  template?: string;
  /**
   * SMS fallback of AlimTalk. Omitted (the default) leaves K-OTP's default
   * on. Pass `false` for AlimTalk only.
   */
  smsFallback?: boolean;
  /** OTP lifetime in seconds (30–600). K-OTP default is 180. */
  ttlSeconds?: number;
  /** Verification attempts (1–10). K-OTP default is 5. */
  maxAttempts?: number;
  /**
   * `verify` (default): a signed-in user attaches a verified phone.
   * `signIn`: passwordless sign-in. Off unless you opt in.
   */
  mode?: KotpMode;
  /**
   * Unique constraint on `user.phoneNumberHash`. Recommended, and required
   * in practice for `signIn` so a number maps to one account. Null hashes
   * (users who have not verified) do not collide.
   */
  uniquePhone?: boolean;
  /**
   * When set, the normalized E.164 number is passed here on successful
   * verify and the ciphertext is stored in `phoneNumberEncrypted`.
   * Not called when omitted. Must not log the number.
   */
  encrypt?: (phone: string) => string | Promise<string>;
  /** Replace the default Korean `+82` normalizer. Must return E.164. */
  normalizePhone?: (phone: string) => string;
  /** Minimum seconds between successful issues for one number. Default 60. */
  cooldownSeconds?: number;
  /**
   * Better Auth per-path rate limits (window in seconds). `false` omits
   * that rule. Defaults: issue 5/60s, verify 10/60s. This is in addition
   * to `cooldownSeconds`.
   */
  rateLimit?: {
    issue?: KotpRateRule | false;
    verify?: KotpRateRule | false;
  };
  /**
   * Called after the user row is updated. `phone` is the normalized E.164
   * number and exists only in this argument — do not log it.
   */
  onVerified?: (args: {
    user: { id: string; email: string; name: string };
    phoneHash: string;
    phone: string;
    mode: KotpMode;
  }) => void | Promise<void>;
  /** Custom fetch (tests, proxies). Does not relax the SDK's HTTPS rule. */
  fetch?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  signIn?: {
    /**
     * Email stored on a newly created phone user. Default
     * `${phoneHash}@users.phone.k-otp.invalid` (not a mailbox).
     */
    getTempEmail?: (phoneHash: string) => string;
    /** Display name for a new phone user. Default `K-OTP user` (no number). */
    getTempName?: (phoneHash: string) => string;
  };
};

export type ResolvedKotpOptions = {
  secretKey: string;
  hashSecret: string;
  baseUrl: string | undefined;
  purpose: string;
  template: string | undefined;
  smsFallback: boolean | undefined;
  ttlSeconds: number | undefined;
  maxAttempts: number | undefined;
  mode: KotpMode;
  uniquePhone: boolean;
  encrypt: KotpOptions["encrypt"];
  normalizePhone: (phone: string) => string;
  cooldownSeconds: number;
  rateLimit: KotpOptions["rateLimit"];
  onVerified: KotpOptions["onVerified"];
  fetch: KotpOptions["fetch"];
  getTempEmail: (phoneHash: string) => string;
  getTempName: (phoneHash: string) => string;
};
