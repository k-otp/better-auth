import type { BetterAuthClientPlugin } from "@better-auth/core";

import { KOTP_ERROR_CODES } from "./errors";
import type { kotp } from "./plugin";

/**
 * Client plugin. Infers `authClient.kOtp.issue` and `authClient.kOtp.verify`
 * from the server paths `/k-otp/issue` and `/k-otp/verify`.
 *
 * Import this from `@k-otp/better-auth/client` in browser bundles. The root
 * entry loads the server plugin and `@k-otp/sdk/server`.
 *
 * `satisfies` (not a `BetterAuthClientPlugin` return annotation) keeps
 * `$InferServerPlugin` concrete. Annotating the return widens endpoints to
 * an index signature and drops inference for this plugin and its siblings.
 */
export const kotpClient = () => {
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
  } satisfies BetterAuthClientPlugin;
};

export type KotpClientPlugin = ReturnType<typeof kotpClient>;
