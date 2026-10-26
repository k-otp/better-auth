# Cloudflare Workers

`kotp()` calls K-OTP with `fetch` only (`@k-otp/sdk/server`). It does not use
Node.js built-ins. Web Crypto (`crypto.subtle`, `crypto.randomUUID`) is the
only crypto.

```ts
import { betterAuth } from "better-auth";
import { kotp } from "@k-otp/better-auth";

type Env = {
  KOTP_SECRET_KEY: string;
  KOTP_HASH_SECRET: string;
};

export const createAuth = (env: Env) =>
  betterAuth({
    database: /* D1 / Postgres / your Workers adapter */,
    secret: env.BETTER_AUTH_SECRET,
    plugins: [
      kotp({
        secretKey: env.KOTP_SECRET_KEY, // sk_... server only
        hashSecret: env.KOTP_HASH_SECRET,
        // mode: "verify" is the default
      }),
    ],
  });

export default {
  async fetch(request: Request, env: Env) {
    return createAuth(env).handler(request);
  },
};
```

Wrangler sets the `workerd` / `worker` export conditions, so
`@k-otp/sdk/server` resolves to the real client (not the browser stub that
throws). If you build a Worker with Vite and `ssr.target: "webworker"` but
without the Cloudflare plugin, add those conditions:

```ts
export default defineConfig({
  ssr: {
    target: "webworker",
    resolve: { conditions: ["workerd", "worker", "module", "browser"] },
  },
});
```

Import `@k-otp/better-auth/client` only in the browser. The root entry loads
the server plugin and must not be bundled for the client.
