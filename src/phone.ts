import { KOTP_ERROR_CODES } from "./errors";

/** Thrown when a number cannot be normalized. The message never echoes the input. */
export class InvalidPhoneNumberError extends Error {
  readonly code: "KOTP_INVALID_PHONE" =
    KOTP_ERROR_CODES.KOTP_INVALID_PHONE.code;

  constructor() {
    super(KOTP_ERROR_CODES.KOTP_INVALID_PHONE.message);
    this.name = "InvalidPhoneNumberError";
  }
}

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Default phone normalizer: Korean numbers become E.164 `+82...`.
 * Numbers that already start with `+` are kept as E.164 (a leading trunk `0`
 * after `+82` is stripped). Anything else that is not a Korean mobile form
 * is rejected — pass `normalizePhone` for other countries.
 *
 * `010-1234-5678`, `01012345678`, `+82 10 1234 5678` and `821012345678` all
 * become `+821012345678`.
 */
export const normalizeKoreanE164 = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) throw new InvalidPhoneNumberError();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) throw new InvalidPhoneNumberError();

  let e164: string;
  if (hasPlus) {
    e164 = digits.startsWith("82")
      ? `+82${stripTrunkZero(digits.slice(2))}`
      : `+${digits}`;
  } else if (digits.startsWith("0")) {
    e164 = `+82${digits.slice(1)}`;
  } else if (digits.startsWith("82") && digits.length >= 11) {
    e164 = `+82${stripTrunkZero(digits.slice(2))}`;
  } else if (
    digits.startsWith("10") &&
    (digits.length === 9 || digits.length === 10)
  ) {
    e164 = `+82${digits}`;
  } else {
    throw new InvalidPhoneNumberError();
  }

  if (!E164.test(e164)) throw new InvalidPhoneNumberError();
  return e164;
};

const stripTrunkZero = (national: string): string =>
  national.startsWith("0") ? national.slice(1) : national;

const toHex = (bytes: Uint8Array): string => {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
};

const hmacSha256Hex = async (
  secret: string,
  value: string,
): Promise<string> => {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    throw new TypeError(
      "hashPhoneNumber requires Web Crypto (globalThis.crypto.subtle).",
    );
  }
  const key = await cryptoApi.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await cryptoApi.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return toHex(new Uint8Array(signature));
};

/**
 * HMAC-SHA256 (hex) of `phone:` + the E.164 number, keyed by `hashSecret`.
 * The stored `phoneNumberHash` uses this exact input. Rotating `hashSecret`
 * invalidates every stored hash.
 */
export const hashPhoneNumber = (
  phoneE164: string,
  hashSecret: string,
): Promise<string> => hmacSha256Hex(hashSecret, `phone:${phoneE164}`);

/** HMAC used to bind a sign-in pending cookie to a row. Not a phone hash. */
export const hashOwnerToken = (
  token: string,
  hashSecret: string,
): Promise<string> => hmacSha256Hex(hashSecret, `owner:${token}`);

export const randomToken = (): string => {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return toHex(bytes);
};

const fromHex = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) {
    throw new Error("invalid seal");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

const aesKey = async (secret: string): Promise<CryptoKey> => {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return globalThis.crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
};

const asBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

/**
 * Short-lived AES-GCM seal of an E.164 number, keyed by `hashSecret`.
 * Stored only on the pending-issue row so verify can run `encrypt` /
 * `onVerified` without a plaintext column. Wiped when the row is consumed
 * or failed. Not a user field and never returned by an endpoint.
 */
export const sealPhone = async (
  phoneE164: string,
  hashSecret: string,
): Promise<string> => {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: asBuffer(iv) },
    await aesKey(hashSecret),
    asBuffer(new TextEncoder().encode(phoneE164)),
  );
  return `${toHex(iv)}.${toHex(new Uint8Array(ciphertext))}`;
};

export const openPhone = async (
  seal: string,
  hashSecret: string,
): Promise<string> => {
  const splitAt = seal.indexOf(".");
  if (splitAt < 1) throw new Error("invalid seal");
  const iv = fromHex(seal.slice(0, splitAt));
  const ciphertext = fromHex(seal.slice(splitAt + 1));
  const plain = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBuffer(iv) },
    await aesKey(hashSecret),
    asBuffer(ciphertext),
  );
  return new TextDecoder().decode(plain);
};

/**
 * Decrypt `user.phoneNumberEncrypted` with the app's own `decrypt`.
 * Returns null when the field is empty. The plugin never decrypts by itself
 * and never logs the result.
 */
export const readEncryptedPhone = async (
  user: { phoneNumberEncrypted?: string | null },
  decrypt: (ciphertext: string) => string | Promise<string>,
): Promise<string | null> => {
  const ciphertext = user.phoneNumberEncrypted;
  if (!ciphertext) return null;
  return decrypt(ciphertext);
};
