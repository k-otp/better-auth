# @k-otp/better-auth

[English](./README.md) | [한국어](./README_ko.md)

[K-OTP](https://k-otp.dev)용 Better Auth 플러그인입니다. 인증번호는 카카오
알림톡으로 전달되고, 알림톡 실패 시 SMS 대체가 기본으로 켜져 있습니다. 코드는
앱에 반환되지 않고 로그에도 남지 않습니다.

피어 의존성: `better-auth` `>=1.7.0 <2`. Cloudflare Workers, Bun, Node.js 20+
에서 동작합니다 (Web Crypto와 `fetch`만 사용).

## 설치

```bash
npm install @k-otp/better-auth better-auth
```

`@k-otp/sdk`는 일반 의존성입니다. 서버 플러그인은 `@k-otp/sdk/server`
(`sk_` 키, fetch만 사용, Node.js 내장 모듈 없음)를 씁니다.

## 서버

```ts
import { betterAuth } from "better-auth";
import { kotp } from "@k-otp/better-auth";

export const auth = betterAuth({
  plugins: [
    kotp({
      secretKey: process.env.KOTP_SECRET_KEY!, // sk_... pk_ 키는 안 됩니다
      hashSecret: process.env.KOTP_HASH_SECRET!, // HMAC 키, 16자 이상
    }),
  ],
});
```

기본 모드는 `verify`입니다. 로그인한 사용자가 계정에 인증된 전화번호를
추가합니다. 두 엔드포인트 모두 세션이 필요합니다.

| 메서드 | 경로 | 본문 | 클라이언트 |
| --- | --- | --- | --- |
| POST | `/k-otp/issue` | `{ phoneNumber }` | `authClient.kOtp.issue({ phoneNumber })` |
| POST | `/k-otp/verify` | `{ code }` | `authClient.kOtp.verify({ code })` |

Better Auth 베이스 경로(기본 `/api/auth`) 아래이므로 실제 HTTP 경로는
`/api/auth/k-otp/issue`, `/api/auth/k-otp/verify`입니다. Better Auth 내장
phone-number 플러그인과 경로가 겹치지 않도록 `kotp` 접두사를 씁니다.

`issue`는 `Idempotency-Key`(UUID)를 만들고, 대기 중인 발급(issue id, 번호
해시, 사용자 id, 만료)을 서버에 저장하며 코드는 반환하지 않습니다. 네트워크
오류나 HTTP 5xx는 `KOTP_UNAVAILABLE`(`retryable: true`)입니다. 같은 사용자·
번호로 다시 `issue`하면 그 멱등 키를 재사용합니다. HTTP 402는
`KOTP_CREDITS_EXHAUSTED`(상태 402)라서 크레딧 소진만 따로 알릴 수 있습니다.

`verify`는 세션이 소유한 대기 발급만 확인하고, K-OTP `reasonCode`를 Better
Auth `APIError`로 바꿉니다.

| `reasonCode` | `error.code` | HTTP |
| --- | --- | --- |
| `MISMATCH` | `KOTP_CODE_MISMATCH` | 400 |
| `MAX_ATTEMPTS` | `KOTP_MAX_ATTEMPTS` | 403 |
| `EXPIRED` | `KOTP_EXPIRED` | 400 |
| `ALREADY_VERIFIED` | 이 세션 소유이면 성공으로 처리 | — |
| `REPLACED` | `KOTP_REPLACED` | 409 |
| `NOT_FOUND` | `KOTP_NOT_FOUND` | 404 |

다른 세션은 코드를 검증할 수 없습니다. 조회가 세션 사용자로 한정되고 K-OTP는
호출되지 않습니다 (`KOTP_PENDING_ISSUE_NOT_FOUND`).

## 클라이언트

```ts
import { createAuthClient } from "better-auth/client";
import { kotpClient } from "@k-otp/better-auth/client";

export const authClient = createAuthClient({
  plugins: [kotpClient()],
});

await authClient.kOtp.issue({ phoneNumber: "010-1234-5678" });
await authClient.kOtp.verify({ code: "123456" });
```

브라우저에서는 `@k-otp/better-auth/client`만 가져오세요. 루트 엔트리는 서버
플러그인을 로드합니다.

## 옵션

| 옵션 | 기본값 | |
| --- | --- | --- |
| `secretKey` | 필수 | `sk_` / `sk_test_` 키. |
| `hashSecret` | 필수 | `phoneNumberHash`용 HMAC 키. 바꾸면 저장된 해시가 무효가 됩니다. |
| `baseUrl` | `https://api.k-otp.dev/v1` | `/v1`을 포함해야 합니다. |
| `purpose` | `phone_verify` 또는 `phone_sign_in` | 같은 번호 + purpose는 이전 코드를 대체합니다. |
| `template` | 생략 | K-OTP `templateId`. |
| `smsFallback` | 생략 (K-OTP 기본: 켜짐) | `false`면 알림톡만. |
| `ttlSeconds` | K-OTP 기본 180 | 30–600. |
| `maxAttempts` | K-OTP 기본 5 | 1–10. |
| `mode` | `"verify"` | `"signIn"`은 비밀번호 없는 로그인을 옵트인합니다. |
| `uniquePhone` | `false` | `phoneNumberHash` 유니크 제약. 로그인 모드에서는 `true`를 쓰세요. |
| `encrypt` | 생략 | 성공 시에만 E.164 번호로 호출됩니다. 암호문이 저장됩니다. |
| `normalizePhone` | 한국 `+82` 헬퍼 | E.164를 반환해야 합니다. |
| `cooldownSeconds` | `60` | 번호당, 발급 성공 이후. `0`이면 끕니다. |
| `rateLimit` | issue 5/60초, verify 10/60초 | Better Auth 경로 제한 (`window`는 초). `false`면 해당 규칙을 뺍니다. |
| `onVerified` | 생략 | `{ user, phoneHash, phone, mode }`. `phone`을 로그하지 마세요. |
| `fetch` | `globalThis.fetch` | 테스트, 프록시. |
| `signIn.getTempEmail` | `${hash}@users.phone.k-otp.invalid` | 받을 수 있는 메일이 아닙니다. |
| `signIn.getTempName` | `K-OTP user` | 이름에 번호가 들어가지 않습니다. |

## 로그인 모드

```ts
kotp({
  secretKey: process.env.KOTP_SECRET_KEY!,
  hashSecret: process.env.KOTP_HASH_SECRET!,
  mode: "signIn",
  uniquePhone: true,
})
```

기본은 꺼져 있습니다. 트레이드오프:

- 전화번호는 안정적인 신원이 아닙니다. 통신사가 번호를 재할당합니다. 나중에
  그 번호를 받은 사람이 계정에 로그인할 수 있으므로, 이메일·패스키 같은
  추가 확인이나 전화 신뢰 만료를 직접 두어야 합니다.
- 복구용 이메일이 없습니다. 저장되는 이메일은 해시에서 만든 합성 주소
  (`…@users.phone.k-otp.invalid`)이며 전송되지 않습니다. `emailVerified`는
  false입니다.
- `uniquePhone: true`를 켜세요. 없으면 같은 해시를 가진 행이 둘일 때
  `KOTP_PHONE_AMBIGUOUS`로 실패합니다.
- 대기 발급의 소유는 세션이 아니라 httpOnly 서명 쿠키 (`kotp_pending`)입니다.
  쿠키만으로는 코드를 알 수 없고, 검증에는 K-OTP가 보낸 코드가 필요합니다.

`verify` 모드는 사용자를 만들지 않습니다. 계정이 이미 있을 때 쓰세요.

## 스키마

플러그인을 넣은 뒤 Better Auth CLI로 마이그레이션을 생성하세요.

```bash
npx @better-auth/cli@latest generate
```

사용자 필드 (`input: false`, 클라이언트가 직접 넣을 수 없음):

| 필드 | 저장 | 세션 응답 |
| --- | --- | --- |
| `phoneNumberHash` | `phone:` + E.164의 HMAC-SHA256 hex (`hashSecret`) | 예 |
| `phoneVerifiedAt` | 날짜 | 예 |
| `phoneNumberEncrypted` | `encrypt`를 넘긴 경우에만 | 아니오 |

`uniquePhone: true`는 `phoneNumberHash`에 유니크 제약을 둡니다. 미인증
사용자는 해시가 null이라 충돌하지 않습니다. `uniquePhone`을 바꾸면 생성되는
마이그레이션도 바뀝니다.

대기 발급은 `kotpIssue` 테이블입니다 (`issueId`, `phoneHash`, `userId`,
`ownerTokenHash`, `idempotencyKey`, `purpose`, `status`, `expiresAt`,
`createdAt`, 그리고 짧은 `phoneSeal`). seal은 정규화된 번호를 `hashSecret`으로
AES-GCM한 값이라, 평문 컬럼 없이 verify 시점에 `encrypt` / `onVerified`를
호출할 수 있습니다. 행이 소비되거나 실패하면 지워지고, 어떤 엔드포인트도
반환하지 않습니다.

앱이 저장한 암호문 읽기:

```ts
import { readEncryptedPhone } from "@k-otp/better-auth";

const phone = await readEncryptedPhone(user, decrypt);
```

`hashPhoneNumber(e164, hashSecret)`는 `phoneNumberHash`와 같습니다.
`normalizeKoreanE164`가 기본 정규화입니다 (`010-1234-5678`,
`+82 10 1234 5678` → `+821012345678`).

## 개인정보

기본은 해시만 저장하세요. 원문을 남기려면 `encrypt`를 넘기고, 전화번호에 대한
적법한 근거(한국에서는 개인정보 보호법상 동의 또는 다른 근거)가 있을 때만
하세요.

발송 구간의 처리자는 K-OTP, 카카오(알림톡), SMS 대체 통신사입니다. 이를
고지하세요. K-OTP는 번호를 해시로만 저장하고 코드를 반환하지 않습니다. 이
플러그인도 같습니다. 요청 본문을 로그하지 마세요. `hashSecret`은 충분히
길어야 합니다. 시크릿이 유출되면 해시 컬럼으로 한국 휴대폰 번호 대역을
전수 대조할 수 있습니다.

테스트 키 (`sk_test_`)는 문자를 보내지 않고 크레딧을 쓰지 않습니다.
[테스트 모드](https://k-otp.dev/docs/guides/test-mode)를 보세요.

## Workers

[docs/workers.md](./docs/workers.md). Wrangler는 `@k-otp/sdk/server`를
`workerd` 조건으로 해석하므로 실제 클라이언트가 로드됩니다.

## 알림을 걸 오류

`KOTP_CREDITS_EXHAUSTED`(HTTP 402)는 조직 지갑이 발송할 수 없다는 뜻입니다.
`KOTP_UNAVAILABLE`(`retryable: true`)는 결과가 불명확할 수 있습니다. `issue`를
다시 호출하세요. 멱등 키는 플러그인이 보관하므로 직접 만들지 마세요.

## 배포

메인테이너: [docs/releasing.md](./docs/releasing.md). Release 워크플로는
저장소 시크릿 `NPM_TOKEN`이 있을 때만 npm provenance와 함께 게시합니다.
