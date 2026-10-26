import { describe, expect, test } from "bun:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthClient } from "better-auth/client";
import {
  hashPhoneNumber,
  type KotpOptions,
  kotp,
  kotpClient,
  normalizeKoreanE164,
} from "../src/index";

const AUTH_SECRET =
  "better-auth-secret-that-is-long-enough-for-validation-test";
const HASH_SECRET = "test-hash-secret";
const API_KEY = "sk_test_plugin_key";
const PHONE = "010-1234-5678";
const E164 = "+821012345678";
const CODE = "654321";

const ISSUE = {
  issueId: "0192f3c4-8b7a-7c3e-9a51-2f4d6e8b1a90",
  expiresAt: "2026-10-26T00:03:00.000Z",
  attemptsRemaining: 5,
  queuedAt: "2026-10-26T00:00:00.000Z",
};

type Call = {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const errorEnvelope = (
  status: number,
  code: string,
  message: string,
  data?: unknown,
): Response =>
  json(status, {
    defined: true,
    code,
    status,
    message,
    ...(data === undefined ? {} : { data }),
  });

type FetchImpl = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const mockFetch = (
  handler: (call: Call) => Response | Promise<Response>,
): { fetch: FetchImpl; calls: Call[] } => {
  const calls: Call[] = [];
  const fetchImpl: FetchImpl = async (input, init) => {
    const request = new Request(input, init);
    const text = await request.text();
    const call: Call = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: text ? JSON.parse(text) : undefined,
    };
    calls.push(call);
    return handler(call);
  };
  return { fetch: fetchImpl, calls };
};

const successFetch = (): { fetch: FetchImpl; calls: Call[] } =>
  mockFetch((call) => {
    if (call.url.endsWith("/issue")) return json(200, ISSUE);
    if (call.url.endsWith("/verify")) {
      return json(200, {
        issueId: ISSUE.issueId,
        verified: true,
        attemptsRemaining: 4,
        expiresAt: ISSUE.expiresAt,
        verifiedAt: "2026-10-26T00:01:00.000Z",
      });
    }
    return errorEnvelope(404, "NOT_FOUND", "missing");
  });

type HandlerAuth = {
  handler: (request: Request) => Promise<Response>;
};

const cookieJar = (auth: HandlerAuth): FetchImpl => {
  const jar = new Map<string, string>();
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("origin", "http://localhost:3000");
    const stored = [...jar.entries()]
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
    if (stored) {
      const existing = headers.get("cookie");
      headers.set("cookie", existing ? `${existing}; ${stored}` : stored);
    }
    const response = await auth.handler(
      new Request(input, { ...init, headers }),
    );
    const setCookies =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];
    for (const raw of setCookies) {
      const pair = raw.split(";")[0];
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq < 1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (/max-age=0/i.test(raw)) jar.delete(name);
      else jar.set(name, value);
    }
    return response;
  };
};

const boot = (options: Partial<KotpOptions> & { fetch: FetchImpl }) => {
  const db: Record<string, unknown[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    kotpIssue: [],
  };
  const auth = betterAuth({
    baseURL: "http://localhost:3000",
    secret: AUTH_SECRET,
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    trustedOrigins: ["http://localhost:3000"],
    plugins: [
      kotp({
        secretKey: API_KEY,
        hashSecret: HASH_SECRET,
        cooldownSeconds: 0,
        ...options,
      }),
    ],
  });
  const client = createAuthClient({
    baseURL: "http://localhost:3000/api/auth",
    plugins: [kotpClient()],
    fetchOptions: { customFetchImpl: cookieJar(auth) },
  });
  return { auth, client, db };
};

const signUp = async (
  client: ReturnType<typeof boot>["client"],
  email: string,
) => {
  const result = await client.signUp.email({
    email,
    password: "password1234",
    name: "Tester",
  });
  expect(result.error).toBeNull();
  return result.data;
};

describe("normalizeKoreanE164", () => {
  test("canonicalizes Korean spellings and passes international E.164 through", () => {
    expect(normalizeKoreanE164("010-1234-5678")).toBe(E164);
    expect(normalizeKoreanE164("01012345678")).toBe(E164);
    expect(normalizeKoreanE164("+82 10 1234 5678")).toBe(E164);
    expect(normalizeKoreanE164("821012345678")).toBe(E164);
    expect(normalizeKoreanE164("+82 010-1234-5678")).toBe(E164);
    expect(normalizeKoreanE164("+1 415 555 2671")).toBe("+14155552671");
  });

  test("rejects empty and non-numeric input without echoing it", () => {
    expect(() => normalizeKoreanE164("   ")).toThrow(
      "Phone number could not be normalized to E.164.",
    );
    expect(() => normalizeKoreanE164("not-a-number")).toThrow(
      /normalized to E\.164/,
    );
  });
});

describe("hashPhoneNumber", () => {
  test("is HMAC-SHA256 of phone: plus the E.164 number", async () => {
    expect(await hashPhoneNumber(E164, HASH_SECRET)).toBe(
      "c3b7cfa7b50e604f9c9c732a5a2c4fffd3952013e147a30062a428978a7ed0a4",
    );
  });
});

describe("kotp plugin", () => {
  test("issue never returns a code and sends a UUID idempotency key", async () => {
    const { fetch, calls } = successFetch();
    const { client } = boot({ fetch });
    await signUp(client, "a@example.com");
    const issued = await client.kOtp.issue({ phoneNumber: PHONE });
    expect(issued.error).toBeNull();
    const data = issued.data;
    expect(data?.issueId).toBe(ISSUE.issueId);
    expect(data?.attemptsRemaining).toBe(ISSUE.attemptsRemaining);
    expect(new Date(data?.expiresAt ?? 0).toISOString()).toBe(ISSUE.expiresAt);
    expect(new Date(data?.queuedAt ?? 0).toISOString()).toBe(ISSUE.queuedAt);
    expect(data).not.toHaveProperty("code");
    expect(JSON.stringify(data)).not.toContain(PHONE);
    expect(JSON.stringify(data)).not.toContain(E164);
    expect(JSON.stringify(data)).not.toContain(CODE);
    const key = calls[0]?.headers.get("idempotency-key");
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(calls[0]?.body).toMatchObject({
      idempotencyKey: key,
      phoneNumber: E164,
      purpose: "phone_verify",
    });
    expect(calls[0]?.headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
  });

  test("verify success sets the hash and verified-at, not ciphertext", async () => {
    const { fetch } = successFetch();
    const { auth, client } = boot({ fetch });
    await signUp(client, "a@example.com");
    expect((await client.kOtp.issue({ phoneNumber: PHONE })).error).toBeNull();
    const verified = await client.kOtp.verify({ code: CODE });
    expect(verified.error).toBeNull();
    expect(verified.data?.verified).toBe(true);
    expect(verified.data).not.toHaveProperty("code");
    const ctx = await auth.$context;
    const user = await ctx.adapter.findOne<Record<string, unknown>>({
      model: "user",
      where: [{ field: "email", value: "a@example.com" }],
    });
    expect(user?.phoneNumberHash).toBe(
      await hashPhoneNumber(E164, HASH_SECRET),
    );
    expect(user?.phoneVerifiedAt).toBeTruthy();
    expect(user?.phoneNumberEncrypted ?? null).toBeNull();
    const pending = await ctx.adapter.findMany<Record<string, unknown>>({
      model: "kotpIssue",
      where: [{ field: "status", value: "consumed" }],
    });
    expect(pending[0]?.phoneSeal ?? null).toBeNull();
    expect(JSON.stringify(pending)).not.toContain(PHONE);
    expect(JSON.stringify(pending)).not.toContain(E164);
  });

  test("encrypt runs only when provided", async () => {
    let calls = 0;
    const { fetch } = successFetch();
    const { auth, client } = boot({
      fetch,
      encrypt: async (phone) => {
        calls += 1;
        expect(phone).toBe(E164);
        return "enc-v1";
      },
    });
    await signUp(client, "enc@example.com");
    expect((await client.kOtp.issue({ phoneNumber: PHONE })).error).toBeNull();
    expect(calls).toBe(0);
    expect((await client.kOtp.verify({ code: CODE })).error).toBeNull();
    expect(calls).toBe(1);
    const ctx = await auth.$context;
    const user = await ctx.adapter.findOne<Record<string, unknown>>({
      model: "user",
      where: [{ field: "email", value: "enc@example.com" }],
    });
    expect(user?.phoneNumberEncrypted).toBe("enc-v1");
  });

  test("maps mismatch, expired and max attempts", async () => {
    const cases = [
      ["MISMATCH", "KOTP_CODE_MISMATCH"],
      ["EXPIRED", "KOTP_EXPIRED"],
      ["MAX_ATTEMPTS", "KOTP_MAX_ATTEMPTS"],
    ] as const;
    for (const [reasonCode, errorCode] of cases) {
      const { fetch } = mockFetch((call) => {
        if (call.url.endsWith("/issue")) return json(200, ISSUE);
        return json(200, {
          issueId: ISSUE.issueId,
          verified: false,
          reasonCode,
          attemptsRemaining: 0,
          expiresAt: ISSUE.expiresAt,
        });
      });
      const { client } = boot({ fetch });
      await signUp(client, `${reasonCode.toLowerCase()}@example.com`);
      expect(
        (await client.kOtp.issue({ phoneNumber: PHONE })).error,
      ).toBeNull();
      const verified = await client.kOtp.verify({ code: CODE });
      expect(verified.data).toBeNull();
      expect(verified.error?.code).toBe(errorCode);
    }
  });

  test("enforces session ownership of the pending issue", async () => {
    const { fetch, calls } = successFetch();
    const db: Record<string, unknown[]> = {
      user: [],
      session: [],
      account: [],
      verification: [],
      kotpIssue: [],
    };
    const auth = betterAuth({
      baseURL: "http://localhost:3000",
      secret: AUTH_SECRET,
      database: memoryAdapter(db),
      emailAndPassword: { enabled: true },
      rateLimit: { enabled: false },
      trustedOrigins: ["http://localhost:3000"],
      plugins: [
        kotp({
          secretKey: API_KEY,
          hashSecret: HASH_SECRET,
          fetch,
          cooldownSeconds: 0,
        }),
      ],
    });
    const clientA = createAuthClient({
      baseURL: "http://localhost:3000/api/auth",
      plugins: [kotpClient()],
      fetchOptions: { customFetchImpl: cookieJar(auth) },
    });
    const clientB = createAuthClient({
      baseURL: "http://localhost:3000/api/auth",
      plugins: [kotpClient()],
      fetchOptions: { customFetchImpl: cookieJar(auth) },
    });
    await signUp(clientA, "owner-a@example.com");
    await signUp(clientB, "owner-b@example.com");
    expect((await clientA.kOtp.issue({ phoneNumber: PHONE })).error).toBeNull();
    const before = calls.filter((call) => call.url.endsWith("/verify")).length;
    const stolen = await clientB.kOtp.verify({ code: CODE });
    expect(stolen.error?.code).toBe("KOTP_PENDING_ISSUE_NOT_FOUND");
    expect(calls.filter((call) => call.url.endsWith("/verify")).length).toBe(
      before,
    );
    const ctx = await auth.$context;
    const owner = await ctx.adapter.findOne<Record<string, unknown>>({
      model: "user",
      where: [{ field: "email", value: "owner-a@example.com" }],
    });
    expect(owner?.phoneVerifiedAt ?? null).toBeNull();
  });

  test("cooldown blocks a second issue for the same number", async () => {
    const { fetch, calls } = successFetch();
    const { client } = boot({ fetch, cooldownSeconds: 60 });
    await signUp(client, "cool@example.com");
    expect((await client.kOtp.issue({ phoneNumber: PHONE })).error).toBeNull();
    const again = await client.kOtp.issue({ phoneNumber: "01012345678" });
    expect(again.error?.code).toBe("KOTP_COOLDOWN");
    expect(again.error?.status).toBe(429);
    expect(calls.filter((call) => call.url.endsWith("/issue"))).toHaveLength(1);
  });

  test("maps HTTP 402 to KOTP_CREDITS_EXHAUSTED", async () => {
    const { fetch } = mockFetch(() =>
      errorEnvelope(402, "PAYMENT_REQUIRED", "Insufficient credit", {
        code: "INSUFFICIENT_CREDIT",
      }),
    );
    const { auth, client } = boot({ fetch });
    await signUp(client, "credits@example.com");
    const issued = await client.kOtp.issue({ phoneNumber: PHONE });
    expect(issued.error?.code).toBe("KOTP_CREDITS_EXHAUSTED");
    expect(issued.error?.status).toBe(402);
    const ctx = await auth.$context;
    const user = await ctx.adapter.findOne<Record<string, unknown>>({
      model: "user",
      where: [{ field: "email", value: "credits@example.com" }],
    });
    expect(user?.phoneNumberHash ?? null).toBeNull();
  });

  test("network and 5xx errors are retryable and reuse the idempotency key", async () => {
    let mode: "throw" | "503" | "ok" = "throw";
    const { fetch, calls } = mockFetch((call) => {
      if (!call.url.endsWith("/issue")) {
        return errorEnvelope(404, "NOT_FOUND", "missing");
      }
      if (mode === "throw") throw new TypeError("network down");
      if (mode === "503") {
        return errorEnvelope(503, "SERVICE_UNAVAILABLE", "try later");
      }
      return json(200, ISSUE);
    });
    const { client } = boot({ fetch });
    await signUp(client, "retry@example.com");
    const first = await client.kOtp.issue({ phoneNumber: PHONE });
    expect(first.error?.code).toBe("KOTP_UNAVAILABLE");
    expect(first.error?.status).toBe(503);
    expect(first.error).toMatchObject({ retryable: true });
    mode = "503";
    const second = await client.kOtp.issue({ phoneNumber: PHONE });
    expect(second.error?.code).toBe("KOTP_UNAVAILABLE");
    mode = "ok";
    const third = await client.kOtp.issue({ phoneNumber: PHONE });
    expect(third.error).toBeNull();
    const keys = calls.map((call) => call.headers.get("idempotency-key"));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBe(keys[0]);
  });

  test("signIn mode creates a user and a session", async () => {
    const seen: string[] = [];
    const { fetch } = successFetch();
    const { client } = boot({
      fetch,
      mode: "signIn",
      onVerified: ({ phone, phoneHash, mode }) => {
        seen.push(`${mode}:${phoneHash}:${phone}`);
      },
    });
    const issued = await client.kOtp.issue({ phoneNumber: PHONE });
    expect(issued.error).toBeNull();
    expect(issued.data).not.toHaveProperty("code");
    const verified = await client.kOtp.verify({ code: CODE });
    expect(verified.error).toBeNull();
    expect(verified.data?.verified).toBe(true);
    const session = await client.getSession();
    expect(session.data?.user.email).toMatch(/@users\.phone\.k-otp\.invalid$/);
    expect(session.data?.user.phoneNumberHash).toBe(
      await hashPhoneNumber(E164, HASH_SECRET),
    );
    expect(session.data?.user.phoneVerifiedAt).toBeTruthy();
    expect(session.data?.user.name).toBe("K-OTP user");
    expect(seen).toEqual([
      `signIn:${await hashPhoneNumber(E164, HASH_SECRET)}:${E164}`,
    ]);
  });
});
