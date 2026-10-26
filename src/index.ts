import { kotpClient } from "./client";
import { KOTP_ERROR_CODES, type KotpError, type KotpErrorCode } from "./errors";
import {
  hashPhoneNumber,
  InvalidPhoneNumberError,
  normalizeKoreanE164,
  readEncryptedPhone,
} from "./phone";
import { kotp } from "./plugin";
import { KOTP_ISSUE_MODEL } from "./schema";
import type { KotpMode, KotpOptions, KotpRateRule } from "./types";

export {
  hashPhoneNumber,
  InvalidPhoneNumberError,
  KOTP_ERROR_CODES,
  KOTP_ISSUE_MODEL,
  type KotpError,
  type KotpErrorCode,
  type KotpMode,
  type KotpOptions,
  type KotpRateRule,
  kotp,
  kotpClient,
  normalizeKoreanE164,
  readEncryptedPhone,
};

declare module "@better-auth/core" {
  interface BetterAuthPluginRegistry<AuthOptions, Options> {
    kotp: {
      creator: typeof kotp;
    };
  }
}
