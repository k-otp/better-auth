import { createOtpServerClient, isOtpApiError } from "@k-otp/sdk/server";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthEndpoint,
  getSessionFromCtx,
} from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import * as z from "zod";

import { KOTP_ERROR_CODES, type KotpError } from "./errors";
import {
  hashOwnerToken,
  hashPhoneNumber,
  normalizeKoreanE164,
  openPhone,
  randomToken,
  sealPhone,
} from "./phone";
import {
  issueFingerprint,
  KOTP_ISSUE_MODEL,
  kotpSchema,
  PENDING_COOKIE,
} from "./schema";
import type { KotpMode, KotpOptions, ResolvedKotpOptions } from "./types";

const PLUGIN_VERSION = "0.1.0";
const UNKNOWN_RETRY_MS = 10 * 60 * 1000;
const CODE_PATTERN = /^\d{6}$/;

type IssueStatus = "unknown" | "issued" | "failed" | "consumed";

type IssueRow = {
  id: string;
  issueId?: string | null;
  phoneHash: string;
  userId?: string | null;
  ownerTokenHash?: string | null;
  idempotencyKey: string;
  purpose: string;
  fingerprint: string;
  phoneSeal?: string | null;
  status: IssueStatus;
  expiresAt?: Date | string | null;
  createdAt: Date | string;
  consumedAt?: Date | string | null;
};

type UserRow = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  phoneNumberHash?: string | null;
  phoneVerifiedAt?: Date | string | null;
  phoneNumberEncrypted?: string | null;
};

type Adapter = {
  create: <T>(data: {
    model: string;
    data: Record<string, unknown>;
  }) => Promise<T>;
  findOne: <T>(data: {
    model: string;
    where: { field: string; value: string | number | boolean | null }[];
  }) => Promise<T | null>;
  findMany: <T>(data: {
    model: string;
    where?: {
      field: string;
      value: string | number | boolean | null;
      operator?: "eq" | "in";
    }[];
    sortBy?: { field: string; direction: "asc" | "desc" };
    limit?: number;
  }) => Promise<T[]>;
  update: <T>(data: {
    model: string;
    where: { field: string; value: string }[];
    update: Record<string, unknown>;
  }) => Promise<T | null>;
};

type EndpointCtx = {
  body: { phoneNumber?: string; code?: string };
  context: {
    adapter: Adapter;
    internalAdapter: {
      createUser: (
        user: {
          email: string;
          name: string;
          emailVerified: boolean;
        },
        source: { method: string },
      ) => Promise<UserRow>;
      createAccount: (account: {
        userId: string;
        providerId: string;
        accountId: string;
      }) => Promise<unknown>;
      createSession: (userId: string) => Promise<{
        id: string;
        token: string;
        userId: string;
        expiresAt: Date;
        createdAt: Date;
        updatedAt: Date;
      }>;
      updateUser: (
        userId: string,
        data: Record<string, unknown>,
      ) => Promise<UserRow>;
      findUserById: (userId: string) => Promise<UserRow | null>;
    };
    secret: string;
    session?: {
      session: { id: string; token: string; userId: string; expiresAt: Date };
      user: UserRow;
    } | null;
    logger: { error: (...args: unknown[]) => void };
  };
  getSignedCookie: (
    key: string,
    secret: string,
  ) => Promise<string | null | false>;
  setSignedCookie: (
    key: string,
    value: string,
    secret: string,
    options?: {
      httpOnly?: boolean;
      sameSite?: "lax" | "strict" | "none";
      path?: string;
      maxAge?: number;
      secure?: boolean;
    },
  ) => Promise<string>;
  json: (body: Record<string, unknown>) => unknown;
};

const fail = (
  status: ConstructorParameters<typeof APIError>[0],
  error: KotpError,
  extra?: Record<string, unknown>,
  headers?: HeadersInit,
): never => {
  throw new APIError(
    status,
    {
      message: error.message,
      code: error.code,
      ...extra,
    },
    headers,
  );
};

const defined = <T>(
  value: T | null | undefined,
  status: ConstructorParameters<typeof APIError>[0],
  error: KotpError,
): T => {
  if (value === null || value === undefined) return fail(status, error);
  return value;
};

type OtpFailure = {
  status: number;
  code: string;
  retryable: boolean;
  data: unknown;
  retryAfterMs: number | undefined;
};

const readOtpFailure = (error: unknown): OtpFailure | null => {
  if (typeof error !== "object" || error === null) return null;
  if (!("status" in error) || typeof error.status !== "number") return null;
  if (!("code" in error) || typeof error.code !== "string") return null;
  return {
    status: error.status,
    code: error.code,
    retryable: "retryable" in error && error.retryable === true,
    data: "data" in error ? error.data : undefined,
    retryAfterMs:
      "retryAfterMs" in error && typeof error.retryAfterMs === "number"
        ? error.retryAfterMs
        : undefined,
  };
};

const asTime = (value: Date | string | null | undefined): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
};

const resolveOptions = (options: KotpOptions): ResolvedKotpOptions => {
  const secretKey = options.secretKey?.trim();
  if (!secretKey?.startsWith("sk_")) {
    throw new TypeError(
      "kotp() requires an sk_ secret key (secretKey). Never use a pk_ key on the server.",
    );
  }
  if (!options.hashSecret || options.hashSecret.length < 16) {
    throw new TypeError(
      "kotp() requires hashSecret of at least 16 characters. It is the HMAC key for phoneNumberHash.",
    );
  }
  if (
    options.ttlSeconds !== undefined &&
    (!Number.isInteger(options.ttlSeconds) ||
      options.ttlSeconds < 30 ||
      options.ttlSeconds > 600)
  ) {
    throw new TypeError("kotp() ttlSeconds must be an integer from 30 to 600.");
  }
  if (
    options.maxAttempts !== undefined &&
    (!Number.isInteger(options.maxAttempts) ||
      options.maxAttempts < 1 ||
      options.maxAttempts > 10)
  ) {
    throw new TypeError("kotp() maxAttempts must be an integer from 1 to 10.");
  }
  const mode: KotpMode = options.mode ?? "verify";
  if (mode !== "verify" && mode !== "signIn") {
    throw new TypeError('kotp() mode must be "verify" or "signIn".');
  }
  const cooldownSeconds = options.cooldownSeconds ?? 60;
  if (
    !Number.isFinite(cooldownSeconds) ||
    cooldownSeconds < 0 ||
    !Number.isInteger(cooldownSeconds)
  ) {
    throw new TypeError("kotp() cooldownSeconds must be an integer >= 0.");
  }
  return {
    secretKey,
    hashSecret: options.hashSecret,
    baseUrl: options.baseUrl,
    purpose:
      options.purpose ?? (mode === "signIn" ? "phone_sign_in" : "phone_verify"),
    template: options.template,
    smsFallback: options.smsFallback,
    ttlSeconds: options.ttlSeconds,
    maxAttempts: options.maxAttempts,
    mode,
    uniquePhone: options.uniquePhone === true,
    encrypt: options.encrypt,
    normalizePhone: options.normalizePhone ?? normalizeKoreanE164,
    cooldownSeconds,
    rateLimit: options.rateLimit,
    onVerified: options.onVerified,
    fetch: options.fetch,
    getTempEmail:
      options.signIn?.getTempEmail ??
      ((phoneHash: string) => `${phoneHash}@users.phone.k-otp.invalid`),
    getTempName: options.signIn?.getTempName ?? (() => "K-OTP user"),
  };
};

const rateLimitRules = (
  options: ResolvedKotpOptions,
): BetterAuthPlugin["rateLimit"] => {
  const rules: NonNullable<BetterAuthPlugin["rateLimit"]> = [];
  const issue = options.rateLimit?.issue ?? { window: 60, max: 5 };
  const verify = options.rateLimit?.verify ?? { window: 60, max: 10 };
  if (issue) {
    rules.push({
      pathMatcher: (path: string) => path === "/k-otp/issue",
      window: issue.window,
      max: issue.max,
    });
  }
  if (verify) {
    rules.push({
      pathMatcher: (path: string) => path === "/k-otp/verify",
      window: verify.window,
      max: verify.max,
    });
  }
  return rules;
};

const mapOtpFailure = (error: unknown): never => {
  const otpError = readOtpFailure(error);
  if (!otpError) {
    return fail("SERVICE_UNAVAILABLE", KOTP_ERROR_CODES.KOTP_UNAVAILABLE, {
      retryable: true,
    });
  }
  if (otpError.status === 402 || otpError.code === "PAYMENT_REQUIRED") {
    const data = otpError.data;
    const kotpCode =
      typeof data === "object" &&
      data !== null &&
      "code" in data &&
      typeof data.code === "string"
        ? data.code
        : undefined;
    return fail(
      "PAYMENT_REQUIRED",
      KOTP_ERROR_CODES.KOTP_CREDITS_EXHAUSTED,
      kotpCode ? { kotpCode } : undefined,
    );
  }
  const retryable =
    otpError.retryable ||
    otpError.code === "ABORTED" ||
    otpError.code === "UNKNOWN" ||
    otpError.status === 0 ||
    otpError.status >= 500;
  if (otpError.status === 429 || otpError.code === "TOO_MANY_REQUESTS") {
    const retryAfter =
      otpError.retryAfterMs === undefined
        ? undefined
        : Math.ceil(otpError.retryAfterMs / 1000);
    return fail(
      "TOO_MANY_REQUESTS",
      KOTP_ERROR_CODES.KOTP_RATE_LIMITED,
      {
        retryable: true,
        ...(retryAfter === undefined ? {} : { retryAfter }),
      },
      retryAfter === undefined
        ? undefined
        : { "retry-after": String(retryAfter) },
    );
  }
  if (retryable) {
    return fail("SERVICE_UNAVAILABLE", KOTP_ERROR_CODES.KOTP_UNAVAILABLE, {
      retryable: true,
    });
  }
  if (otpError.status === 401) {
    return fail("UNAUTHORIZED", KOTP_ERROR_CODES.KOTP_UNAUTHORIZED);
  }
  if (otpError.status === 403) {
    return fail("FORBIDDEN", KOTP_ERROR_CODES.KOTP_FORBIDDEN);
  }
  return fail("BAD_REQUEST", KOTP_ERROR_CODES.KOTP_REJECTED);
};

const shouldKeepKey = (error: unknown): boolean => {
  if (!isOtpApiError(error)) return true;
  if (error.status === 402 || error.code === "PAYMENT_REQUIRED") return false;
  return (
    error.retryable ||
    error.code === "ABORTED" ||
    error.code === "UNKNOWN" ||
    error.status === 0 ||
    error.status >= 500 ||
    error.status === 429
  );
};

const requireSession = async (
  ctx: EndpointCtx,
  mode: KotpMode,
): Promise<{ user: UserRow; session: { token: string } } | null> => {
  if (mode === "signIn") return null;
  const session = await getSessionFromCtx(ctx as never);
  if (!session?.user?.id) {
    fail("UNAUTHORIZED", KOTP_ERROR_CODES.KOTP_SESSION_REQUIRED);
  }
  return session as { user: UserRow; session: { token: string } };
};

const findUsersByHash = async (
  adapter: Adapter,
  phoneHash: string,
): Promise<UserRow[]> =>
  adapter.findMany<UserRow>({
    model: "user",
    where: [{ field: "phoneNumberHash", value: phoneHash }],
    limit: 2,
  });

const assertPhoneAvailable = async (
  adapter: Adapter,
  phoneHash: string,
  userId: string | undefined,
  uniquePhone: boolean,
): Promise<void> => {
  if (!uniquePhone && userId) return;
  const matches = await findUsersByHash(adapter, phoneHash);
  const others = matches.filter((user) => user.id !== userId);
  if (others.length > 0 && (uniquePhone || !userId)) {
    if (!userId && others.length > 1) {
      fail("CONFLICT", KOTP_ERROR_CODES.KOTP_PHONE_AMBIGUOUS);
    }
    if (userId) fail("CONFLICT", KOTP_ERROR_CODES.KOTP_PHONE_IN_USE);
  }
  if (!userId && matches.length > 1) {
    fail("CONFLICT", KOTP_ERROR_CODES.KOTP_PHONE_AMBIGUOUS);
  }
};

const latestRow = (rows: IssueRow[]): IssueRow | null => {
  let best: IssueRow | null = null;
  let bestTime = -1;
  for (const row of rows) {
    const time = asTime(row.createdAt);
    if (time >= bestTime) {
      best = row;
      bestTime = time;
    }
  }
  return best;
};

const findOwned = async (
  adapter: Adapter,
  where: { field: string; value: string }[],
  status: IssueStatus,
): Promise<IssueRow | null> => {
  const rows = await adapter.findMany<IssueRow>({
    model: KOTP_ISSUE_MODEL,
    where: [...where, { field: "status", value: status }],
    sortBy: { field: "createdAt", direction: "desc" },
    limit: 5,
  });
  return latestRow(rows);
};

const enforceCooldown = async (
  adapter: Adapter,
  phoneHash: string,
  cooldownSeconds: number,
): Promise<void> => {
  if (cooldownSeconds <= 0) return;
  const rows = await adapter.findMany<IssueRow>({
    model: KOTP_ISSUE_MODEL,
    where: [{ field: "phoneHash", value: phoneHash }],
    sortBy: { field: "createdAt", direction: "desc" },
    limit: 10,
  });
  const now = Date.now();
  for (const row of rows) {
    if (row.status !== "issued" && row.status !== "consumed") continue;
    const elapsed = now - asTime(row.createdAt);
    const waitMs = cooldownSeconds * 1000 - elapsed;
    if (waitMs > 0) {
      const retryAfter = Math.ceil(waitMs / 1000);
      fail(
        "TOO_MANY_REQUESTS",
        KOTP_ERROR_CODES.KOTP_COOLDOWN,
        { retryAfter },
        { "retry-after": String(retryAfter) },
      );
    }
  }
};

const markStatus = async (
  adapter: Adapter,
  id: string,
  status: IssueStatus,
  extra: Record<string, unknown> = {},
): Promise<void> => {
  await adapter.update({
    model: KOTP_ISSUE_MODEL,
    where: [{ field: "id", value: id }],
    update: {
      status,
      ...(status === "failed" || status === "consumed"
        ? { phoneSeal: null }
        : {}),
      ...extra,
    },
  });
};

const issueBody = (
  options: ResolvedKotpOptions,
  idempotencyKey: string,
  phone: string,
) => ({
  phoneNumber: phone,
  purpose: options.purpose,
  idempotencyKey,
  ...(options.template ? { templateId: options.template } : {}),
  ...(options.smsFallback === undefined
    ? {}
    : { smsFallback: options.smsFallback }),
  ...(options.ttlSeconds === undefined
    ? {}
    : { expiresInSec: options.ttlSeconds }),
  ...(options.maxAttempts === undefined
    ? {}
    : { maxAttempts: options.maxAttempts }),
});

const cookieMaxAge = (options: ResolvedKotpOptions): number =>
  options.ttlSeconds ?? 180;

const readOwnerToken = async (ctx: EndpointCtx): Promise<string | null> => {
  const token = await ctx.getSignedCookie(PENDING_COOKIE, ctx.context.secret);
  if (!token) return null;
  return token;
};

const bindSignInCookie = async (
  ctx: EndpointCtx,
  options: ResolvedKotpOptions,
): Promise<{ token: string; ownerTokenHash: string }> => {
  const existing = await readOwnerToken(ctx);
  if (existing) {
    return {
      token: existing,
      ownerTokenHash: await hashOwnerToken(existing, options.hashSecret),
    };
  }
  const token = randomToken();
  await ctx.setSignedCookie(PENDING_COOKIE, token, ctx.context.secret, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: cookieMaxAge(options),
    secure: false,
  });
  return {
    token,
    ownerTokenHash: await hashOwnerToken(token, options.hashSecret),
  };
};

const clearPendingCookie = async (ctx: EndpointCtx): Promise<void> => {
  await ctx.setSignedCookie(PENDING_COOKIE, "", ctx.context.secret, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    secure: false,
  });
};

const completeVerification = async (
  ctx: EndpointCtx,
  options: ResolvedKotpOptions,
  row: IssueRow,
  phone: string,
  sessionUserId: string | undefined,
): Promise<UserRow> => {
  const userId = sessionUserId ?? row.userId ?? undefined;
  let user: UserRow | null = null;
  if (options.mode === "verify") {
    if (!userId)
      return fail("UNAUTHORIZED", KOTP_ERROR_CODES.KOTP_SESSION_REQUIRED);
    if (row.userId && row.userId !== userId) {
      return fail("FORBIDDEN", KOTP_ERROR_CODES.KOTP_ISSUE_NOT_OWNED);
    }
    user = await ctx.context.internalAdapter.findUserById(userId);
  } else {
    const matches = await findUsersByHash(ctx.context.adapter, row.phoneHash);
    if (matches.length > 1) {
      return fail("CONFLICT", KOTP_ERROR_CODES.KOTP_PHONE_AMBIGUOUS);
    }
    user = matches[0] ?? null;
    if (!user) {
      const email = options.getTempEmail(row.phoneHash);
      const name = options.getTempName(row.phoneHash);
      user = await ctx.context.internalAdapter.createUser(
        { email, name, emailVerified: false },
        { method: "kotp" },
      );
      await ctx.context.internalAdapter.createAccount({
        userId: user.id,
        providerId: "kotp",
        accountId: row.phoneHash,
      });
    }
  }
  const current = defined(user, "BAD_REQUEST", KOTP_ERROR_CODES.KOTP_NOT_FOUND);

  let encrypted: string | undefined;
  if (options.encrypt) {
    try {
      encrypted = await options.encrypt(phone);
    } catch (error) {
      ctx.context.logger.error("kotp encrypt hook failed", {
        userId: current.id,
        name: error instanceof Error ? error.name : "Error",
      });
      return fail(
        "INTERNAL_SERVER_ERROR",
        KOTP_ERROR_CODES.KOTP_ENCRYPT_FAILED,
      );
    }
    if (!encrypted) {
      return fail(
        "INTERNAL_SERVER_ERROR",
        KOTP_ERROR_CODES.KOTP_ENCRYPT_FAILED,
      );
    }
  }

  const verifiedAt = new Date();
  const updated = await ctx.context.internalAdapter.updateUser(current.id, {
    phoneNumberHash: row.phoneHash,
    phoneVerifiedAt: verifiedAt,
    phoneNumberEncrypted: encrypted ?? null,
  });

  if (row.status !== "consumed") {
    await markStatus(ctx.context.adapter, row.id, "consumed", {
      consumedAt: verifiedAt,
      userId: updated.id,
    });
    if (options.onVerified) {
      await options.onVerified({
        user: { id: updated.id, email: updated.email, name: updated.name },
        phoneHash: row.phoneHash,
        phone,
        mode: options.mode,
      });
    }
  }

  if (options.mode === "signIn") {
    const session = await ctx.context.internalAdapter.createSession(updated.id);
    await setSessionCookie(ctx as never, {
      session: session as never,
      user: updated as never,
    });
    await clearPendingCookie(ctx);
  }
  return updated;
};

const mapReason = (
  reason: string | undefined,
  extra?: Record<string, unknown>,
): never => {
  switch (reason) {
    case "MISMATCH":
      return fail("BAD_REQUEST", KOTP_ERROR_CODES.KOTP_CODE_MISMATCH, extra);
    case "MAX_ATTEMPTS":
      return fail("FORBIDDEN", KOTP_ERROR_CODES.KOTP_MAX_ATTEMPTS, extra);
    case "EXPIRED":
      return fail("BAD_REQUEST", KOTP_ERROR_CODES.KOTP_EXPIRED, extra);
    case "ALREADY_VERIFIED":
      return fail("CONFLICT", KOTP_ERROR_CODES.KOTP_ALREADY_VERIFIED, extra);
    case "REPLACED":
      return fail("CONFLICT", KOTP_ERROR_CODES.KOTP_REPLACED, extra);
    case "NOT_FOUND":
      return fail("NOT_FOUND", KOTP_ERROR_CODES.KOTP_NOT_FOUND, extra);
    default:
      return fail("BAD_REQUEST", KOTP_ERROR_CODES.KOTP_REJECTED, extra);
  }
};

/**
 * Better Auth server plugin for K-OTP phone verification.
 *
 * Paths (under the auth base path, `/api/auth` by default):
 * - `POST /k-otp/issue` — `{ phoneNumber }`
 * - `POST /k-otp/verify` — `{ code }`
 *
 * The client plugin exposes these as `authClient.kOtp.issue` /
 * `authClient.kOtp.verify`. The OTP code is never returned.
 */
export const kotp = (options: KotpOptions): BetterAuthPlugin => {
  const settings = resolveOptions(options);
  const otp = createOtpServerClient({
    apiKey: settings.secretKey,
    ...(settings.baseUrl ? { baseUrl: settings.baseUrl } : {}),
    ...(settings.fetch ? { fetch: settings.fetch as typeof fetch } : {}),
  });

  const issue = createAuthEndpoint(
    "/k-otp/issue",
    {
      method: "POST",
      body: z.object({
        phoneNumber: z.string().min(1).max(32),
      }),
      metadata: {
        openapi: {
          summary: "Issue a K-OTP phone code",
          description:
            "Sends a code via K-OTP. The response never includes the code.",
        },
      },
    },
    async (ctx) => {
      const endpoint = ctx as unknown as EndpointCtx;
      const session = await requireSession(endpoint, settings.mode);
      const phone = await (async (): Promise<string> => {
        try {
          return settings.normalizePhone(ctx.body.phoneNumber);
        } catch {
          return fail("BAD_REQUEST", KOTP_ERROR_CODES.KOTP_INVALID_PHONE);
        }
      })();
      const phoneHash = await hashPhoneNumber(phone, settings.hashSecret);
      await assertPhoneAvailable(
        endpoint.context.adapter,
        phoneHash,
        session?.user.id,
        settings.uniquePhone,
      );
      await enforceCooldown(
        endpoint.context.adapter,
        phoneHash,
        settings.cooldownSeconds,
      );

      const fingerprint = issueFingerprint(settings, settings.purpose);
      const owner =
        settings.mode === "signIn"
          ? await bindSignInCookie(endpoint, settings)
          : null;
      const ownerWhere =
        settings.mode === "signIn" && owner
          ? [{ field: "ownerTokenHash", value: owner.ownerTokenHash }]
          : [{ field: "userId", value: session?.user.id ?? "" }];

      let pending = await findOwned(
        endpoint.context.adapter,
        [
          { field: "phoneHash", value: phoneHash },
          { field: "fingerprint", value: fingerprint },
          ...ownerWhere,
        ],
        "unknown",
      );
      if (
        pending &&
        Date.now() - asTime(pending.createdAt) > UNKNOWN_RETRY_MS
      ) {
        await markStatus(endpoint.context.adapter, pending.id, "failed");
        pending = null;
      }

      const idempotencyKey = pending?.idempotencyKey ?? crypto.randomUUID();
      let row = pending;
      if (!row) {
        const created = await endpoint.context.adapter.create<IssueRow>({
          model: KOTP_ISSUE_MODEL,
          data: {
            phoneHash,
            userId: session?.user.id ?? null,
            ownerTokenHash: owner?.ownerTokenHash ?? null,
            idempotencyKey,
            purpose: settings.purpose,
            fingerprint,
            status: "unknown",
            createdAt: new Date(),
            phoneSeal: await sealPhone(phone, settings.hashSecret),
          },
        });
        row = created;
      }
      if (!row?.id) {
        fail("INTERNAL_SERVER_ERROR", KOTP_ERROR_CODES.KOTP_UNAVAILABLE, {
          retryable: true,
        });
      }

      try {
        const result = await otp.issue(
          issueBody(settings, idempotencyKey, phone),
        );
        await markStatus(endpoint.context.adapter, row.id, "issued", {
          issueId: result.issueId,
          expiresAt: new Date(result.expiresAt),
        });
        return ctx.json({
          issueId: result.issueId,
          expiresAt: result.expiresAt,
          attemptsRemaining: result.attemptsRemaining,
          queuedAt: result.queuedAt,
        });
      } catch (error) {
        if (!shouldKeepKey(error)) {
          await markStatus(endpoint.context.adapter, row.id, "failed");
        }
        mapOtpFailure(error);
      }
    },
  );

  const verify = createAuthEndpoint(
    "/k-otp/verify",
    {
      method: "POST",
      body: z.object({
        code: z.string(),
      }),
      metadata: {
        openapi: {
          summary: "Verify a K-OTP phone code",
          description:
            "Checks the code against the pending issue owned by this session (or the sign-in cookie). The code is not logged.",
        },
      },
    },
    async (ctx) => {
      const endpoint = ctx as unknown as EndpointCtx;
      const session = await requireSession(endpoint, settings.mode);
      if (!CODE_PATTERN.test(ctx.body.code)) {
        return fail("BAD_REQUEST", KOTP_ERROR_CODES.KOTP_INVALID_CODE);
      }
      const ownerWhere =
        settings.mode === "signIn"
          ? await (async () => {
              const token = await readOwnerToken(endpoint);
              if (!token) {
                return fail(
                  "NOT_FOUND",
                  KOTP_ERROR_CODES.KOTP_PENDING_ISSUE_NOT_FOUND,
                );
              }
              return [
                {
                  field: "ownerTokenHash",
                  value: await hashOwnerToken(token, settings.hashSecret),
                },
              ];
            })()
          : [{ field: "userId", value: session?.user.id ?? "" }];

      const issued = await findOwned(
        endpoint.context.adapter,
        ownerWhere,
        "issued",
      );
      if (issued) {
        if (
          settings.mode === "verify" &&
          issued.userId &&
          issued.userId !== session?.user.id
        ) {
          fail("FORBIDDEN", KOTP_ERROR_CODES.KOTP_ISSUE_NOT_OWNED);
        }
        if (!issued.issueId) {
          return fail(
            "NOT_FOUND",
            KOTP_ERROR_CODES.KOTP_PENDING_ISSUE_NOT_FOUND,
          );
        }
        const issueId = issued.issueId;
        let result: Awaited<ReturnType<typeof otp.verify>>;
        try {
          result = await otp.verify({
            issueId,
            code: ctx.body.code,
          });
        } catch (error) {
          return mapOtpFailure(error);
        }
        if (!result.verified) {
          if (
            result.reasonCode === "MAX_ATTEMPTS" ||
            result.reasonCode === "EXPIRED" ||
            result.reasonCode === "REPLACED" ||
            result.reasonCode === "NOT_FOUND"
          ) {
            await markStatus(endpoint.context.adapter, issued.id, "failed");
          }
          if (result.reasonCode === "ALREADY_VERIFIED") {
            const phone = await recoverPhone(endpoint, settings, issued);
            const user = await completeVerification(
              endpoint,
              settings,
              issued,
              phone,
              session?.user.id,
            );
            return ctx.json(verifiedBody(result, user));
          }
          mapReason(result.reasonCode);
        }
        const phone = await recoverPhone(endpoint, settings, issued);
        const user = await completeVerification(
          endpoint,
          settings,
          issued,
          phone,
          session?.user.id,
        );
        return ctx.json(verifiedBody(result, user));
      }

      const consumed = await findOwned(
        endpoint.context.adapter,
        ownerWhere,
        "consumed",
      );
      if (consumed) {
        const userId = session?.user.id ?? consumed.userId ?? undefined;
        const user = userId
          ? await endpoint.context.internalAdapter.findUserById(userId)
          : (
              await findUsersByHash(
                endpoint.context.adapter,
                consumed.phoneHash,
              )
            )[0];
        if (user?.phoneNumberHash === consumed.phoneHash) {
          if (settings.mode === "signIn") {
            const created =
              await endpoint.context.internalAdapter.createSession(user.id);
            await setSessionCookie(endpoint as never, {
              session: created as never,
              user: user as never,
            });
          }
          return ctx.json({
            verified: true,
            issueId: consumed.issueId ?? "",
            attemptsRemaining: 0,
            expiresAt:
              consumed.expiresAt instanceof Date
                ? consumed.expiresAt.toISOString()
                : String(consumed.expiresAt ?? ""),
            verifiedAt:
              user.phoneVerifiedAt instanceof Date
                ? user.phoneVerifiedAt.toISOString()
                : new Date().toISOString(),
            userId: user.id,
          });
        }
      }
      fail("NOT_FOUND", KOTP_ERROR_CODES.KOTP_PENDING_ISSUE_NOT_FOUND);
    },
  );

  return {
    id: "k-otp",
    version: PLUGIN_VERSION,
    endpoints: { issue, verify },
    schema: kotpSchema(settings),
    rateLimit: rateLimitRules(settings),
    $ERROR_CODES: KOTP_ERROR_CODES,
  };
};

const recoverPhone = async (
  ctx: EndpointCtx,
  options: ResolvedKotpOptions,
  row: IssueRow,
): Promise<string> => {
  const seal = row.phoneSeal;
  if (!seal) {
    return fail("NOT_FOUND", KOTP_ERROR_CODES.KOTP_PENDING_ISSUE_NOT_FOUND);
  }
  try {
    return await openPhone(seal, options.hashSecret);
  } catch {
    ctx.context.logger.error("kotp pending seal could not be opened", {
      issueRowId: row.id,
    });
    return fail("NOT_FOUND", KOTP_ERROR_CODES.KOTP_PENDING_ISSUE_NOT_FOUND);
  }
};

const verifiedBody = (
  result: {
    issueId: string;
    attemptsRemaining: number;
    expiresAt: string;
    verifiedAt?: string;
  },
  user: UserRow,
): Record<string, unknown> => ({
  verified: true,
  issueId: result.issueId,
  attemptsRemaining: result.attemptsRemaining,
  expiresAt: result.expiresAt,
  ...(result.verifiedAt ? { verifiedAt: result.verifiedAt } : {}),
  userId: user.id,
});
