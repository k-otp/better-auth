import type { BetterAuthPlugin } from "better-auth";

import type { KotpOptions } from "./types";

/** Pending-issue model. Better Auth CLI migrations create this table. */
export const KOTP_ISSUE_MODEL = "kotpIssue";

export const PENDING_COOKIE = "kotp_pending";

type PluginSchema = NonNullable<BetterAuthPlugin["schema"]>;

export const kotpSchema = (options: {
  uniquePhone: boolean;
}): PluginSchema => ({
  user: {
    fields: {
      phoneNumberHash: {
        type: "string",
        required: false,
        unique: options.uniquePhone,
        input: false,
        returned: true,
      },
      phoneVerifiedAt: {
        type: "date",
        required: false,
        input: false,
        returned: true,
      },
      /**
       * Ciphertext from the app's `encrypt` hook. Not returned on session
       * responses; read it server-side and pass it to `readEncryptedPhone`.
       */
      phoneNumberEncrypted: {
        type: "string",
        required: false,
        input: false,
        returned: false,
      },
    },
  },
  [KOTP_ISSUE_MODEL]: {
    fields: {
      issueId: {
        type: "string",
        required: false,
        unique: true,
      },
      phoneHash: {
        type: "string",
        required: true,
      },
      userId: {
        type: "string",
        required: false,
        references: {
          model: "user",
          field: "id",
          onDelete: "cascade",
        },
      },
      ownerTokenHash: {
        type: "string",
        required: false,
      },
      idempotencyKey: {
        type: "string",
        required: true,
        unique: true,
      },
      purpose: {
        type: "string",
        required: true,
      },
      fingerprint: {
        type: "string",
        required: true,
      },
      /**
       * AES-GCM seal of the normalized number (see `sealPhone`). Wiped when
       * the row is consumed or failed. Never returned by an endpoint.
       */
      phoneSeal: {
        type: "string",
        required: false,
        returned: false,
        input: false,
      },
      status: {
        type: "string",
        required: true,
      },
      expiresAt: {
        type: "date",
        required: false,
      },
      createdAt: {
        type: "date",
        required: true,
      },
      consumedAt: {
        type: "date",
        required: false,
      },
    },
  },
});

export const issueFingerprint = (
  options: Pick<
    KotpOptions,
    "template" | "smsFallback" | "ttlSeconds" | "maxAttempts"
  >,
  purpose: string,
): string =>
  [
    purpose,
    options.template ?? "",
    options.smsFallback === false ? "0" : "1",
    options.ttlSeconds === undefined ? "" : String(options.ttlSeconds),
    options.maxAttempts === undefined ? "" : String(options.maxAttempts),
  ].join("\n");
