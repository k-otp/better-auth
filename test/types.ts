import type { BetterAuthPluginRegistry } from "@better-auth/core";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthClient } from "better-auth/client";
import {
  magicLinkClient,
  organizationClient,
} from "better-auth/client/plugins";
import { magicLink, organization } from "better-auth/plugins";

import { kotpClient } from "../src/client";
import { kotp } from "../src/index";

/**
 * Type-level checks only. Not a `*.test.ts` file, so `bun test` does not run
 * it; `ttsc -p tsconfig.test.json` does. A widened `BetterAuthPlugin` return
 * used to erase `kOtp.issue` and, via an index-signature intersection, sibling
 * client methods too.
 */
const client = createAuthClient({
  plugins: [organizationClient(), magicLinkClient(), kotpClient()],
});

void client.kOtp.issue({ phoneNumber: "010-1234-5678" });
void client.kOtp.verify({ code: "123456" });
void client.organization.list();
void client.signIn.social({ provider: "google" });
void client.signIn.magicLink({ email: "user@example.com" });

// @ts-expect-error phoneNumber is required
void client.kOtp.issue({});
// @ts-expect-error phoneNumber must be a string
void client.kOtp.issue({ phoneNumber: 1 });
// @ts-expect-error code is required
void client.kOtp.verify({});
// @ts-expect-error code must be a string
void client.kOtp.verify({ code: 123456 });
// @ts-expect-error kOtp has no list method
void client.kOtp.list();
// @ts-expect-error provider is required
void client.signIn.social({});
// @ts-expect-error provider must be a string
void client.signIn.social({ provider: 1 });
// @ts-expect-error email is required
void client.signIn.magicLink({});
// @ts-expect-error email must be a string
void client.signIn.magicLink({ email: 1 });

const auth = betterAuth({
  baseURL: "http://localhost:3000",
  secret: "better-auth-secret-that-is-long-enough-for-validation-test",
  database: memoryAdapter({
    user: [],
    session: [],
    account: [],
    verification: [],
    kotpIssue: [],
  }),
  plugins: [
    organization(),
    magicLink({
      sendMagicLink: async () => {},
    }),
    kotp({
      secretKey: "sk_test_example",
      hashSecret: "test-hash-secret-value",
    }),
  ],
});

void auth.api.issue({ body: { phoneNumber: "+821012345678" } });
void auth.api.verify({ body: { code: "123456" } });
void auth.api.listOrganizations({ headers: new Headers() });
void auth.api.signInMagicLink({
  body: { email: "user@example.com" },
  headers: new Headers(),
});
void auth.api.signInSocial({
  body: { provider: "google", callbackURL: "http://localhost:3000" },
});

// @ts-expect-error phoneNumber is required
void auth.api.issue({ body: {} });
// @ts-expect-error phoneNumber must be a string
void auth.api.issue({ body: { phoneNumber: 1 } });
// @ts-expect-error code is required
void auth.api.verify({ body: {} });
// @ts-expect-error code must be a string
void auth.api.verify({ body: { code: 1 } });

void client.getSession().then((session) => {
  const hash: string | null | undefined = session.data?.user.phoneNumberHash;
  const verifiedAt: Date | null | undefined =
    session.data?.user.phoneVerifiedAt;
  void hash;
  void verifiedAt;
});

type Plugin = ReturnType<typeof kotp>;
type Registry = BetterAuthPluginRegistry<unknown, unknown>;
type OldRegistryKey = "kotp" extends keyof Registry ? true : false;

const _issuePath: Plugin["endpoints"]["issue"]["path"] = "/k-otp/issue";
const _verifyPath: Plugin["endpoints"]["verify"]["path"] = "/k-otp/verify";
const _pluginId: Plugin["id"] = "k-otp";
const _registered: "k-otp" extends keyof Registry ? true : never = true;
const _notOldKey: OldRegistryKey = false;

void _issuePath;
void _verifyPath;
void _pluginId;
void _registered;
void _notOldKey;
