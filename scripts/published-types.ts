import { betterAuth } from "better-auth";
import { createAuthClient } from "better-auth/client";
import {
  magicLinkClient,
  organizationClient,
} from "better-auth/client/plugins";

import { kotpClient } from "../dist/client";
import { kotp } from "../dist/index";

/**
 * Checks the published declarations, not the source. `ttsc` emits these
 * after the bundle; oxc would have widened `kotp()` back to `BetterAuthPlugin`.
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
// @ts-expect-error kOtp has no list method
void client.kOtp.list();
// @ts-expect-error provider is required
void client.signIn.social({});
// @ts-expect-error email is required
void client.signIn.magicLink({});

const auth = betterAuth({
  baseURL: "http://localhost:3000",
  secret: "better-auth-secret-that-is-long-enough-for-validation-test",
  plugins: [
    kotp({
      secretKey: "sk_test_example",
      hashSecret: "test-hash-secret-value",
    }),
  ],
});

void auth.api.issue({ body: { phoneNumber: "+821012345678" } });
void auth.api.verify({ body: { code: "123456" } });

// @ts-expect-error phoneNumber is required
void auth.api.issue({ body: {} });
