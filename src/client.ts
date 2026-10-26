import type { BetterAuthClientPlugin } from "better-auth/client";

import { KOTP_ERROR_CODES } from "./errors";
import type { kotp } from "./plugin";

export type KotpClientPlugin = BetterAuthClientPlugin & {
  id: "k-otp";
  $InferServerPlugin: ReturnType<typeof kotp>;
  $ERROR_CODES: typeof KOTP_ERROR_CODES;
};

/**
 * Client plugin. Infers `authClient.kOtp.issue` and `authClient.kOtp.verify`
 * from the server paths `/k-otp/issue` and `/k-otp/verify`.
 *
 * Import this from `@k-otp/better-auth/client` in browser bundles. The root
 * entry loads the server plugin and `@k-otp/sdk/server`.
 */
export const kotpClient = (): KotpClientPlugin => {
  return {
    id: "k-otp",
    $InferServerPlugin: {} as ReturnType<typeof kotp>,
    $ERROR_CODES: KOTP_ERROR_CODES,
    atomListeners: [
      {
        matcher: (path: string) => path === "/k-otp/verify",
        signal: "$sessionSignal",
      },
    ],
  };
};
