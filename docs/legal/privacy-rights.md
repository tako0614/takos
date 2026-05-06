# Privacy Rights and Lawful Bases

> このページでわかること: Takos Web / API で扱う data subject rights
> handler、Cookie / localStorage の consent 境界、GDPR / CCPA 対応の法的根拠。

| Field | Value |
| --- | --- |
| Last reviewed | 2026-05-07 |
| Owner | Takos app / API (`takos/app`) |
| Status | Operational baseline; final legal review remains E-11.1 |

## Scope

Takos の customer-facing privacy surface は `takos/app` が所有します。
Takosumi は generic PaaS kernel、takosumi-git は workflow / git bridge であり、
Takos の個人データ access / export / deletion handler は Takos Web / API の
account boundary に置きます。

## Data Subject Rights Handler

認証済みユーザーは次の API で自身の data subject request を開始できます。

| Right | Method | Path | Behavior |
| --- | --- | --- | --- |
| Access | `GET` | `/api/me/privacy/access` | subject、request status、available actions、lawful basis link を返す |
| Export | `GET` | `/api/me/privacy/export` | account / settings / auth identity metadata / OAuth metadata / billing metadata / repositories / threads / messages / runs / memories / notifications を JSON attachment として返す |
| Deletion | `POST` | `/api/me/privacy/deletion-requests` | deletion request を `account_metadata` に記録し、account を `pending_deletion` にして再ログインを止め、PAT / OAuth token / SQL auth session / OAuth client を即時 revoke する |

Deletion request は即時の credential revocation と account disable を行います。
請求・税務・不正対策・セキュリティ監査で保存義務または正当な利益が残るデータは、
final purge job または手動運用で retention window に従って削除・匿名化します。

## Export Redaction Rules

Export handler はユーザー本人のデータを返しますが、再利用可能な credential
secret は返しません。

| Data | Export handling |
| --- | --- |
| Personal access tokens | token prefix、scope、expiry、last used metadata のみ。token hash / plaintext は返さない |
| OAuth tokens | token type、client、scope、revocation、expiry metadata のみ。token hash は返さない |
| Auth identities | provider、provider subject、email snapshot、linked / last login metadata を返す。refresh token ciphertext は返さない |
| Password credentials | `has_password` boolean のみ。password hash は返さない |
| Billing | processor name、customer / subscription id、plan、status、period metadata を返す。card number は Takos に保存しない |

## Lawful Bases

Takos は processing purpose ごとに lawful basis を分けます。EU / UK GDPR では
Article 6 の contract、legitimate interests、legal obligation、consent を使い、
CCPA / CPRA では business purpose、service-provider processing、consumer request
handling として同じ processing inventory に紐づけます。

| Purpose | Data categories | Lawful basis |
| --- | --- | --- |
| Service delivery | account, profile, spaces, repositories, threads, runs, app deployment metadata | Contract performance |
| Authentication and access control | sessions, auth identities, PAT / OAuth token metadata, IP / user agent security logs | Contract performance; legitimate interests |
| Billing and metering | billing account, plan, usage events, payment processor customer id | Contract performance; legal obligation |
| Security monitoring and abuse response | audit logs, revocation records, moderation / incident metadata | Legitimate interests; legal obligation |
| Product reliability | error logs, performance metadata, aggregate usage | Legitimate interests |
| Optional preferences | cookie consent state, language, theme, local UI preferences | Consent or user-requested preference storage |

## Cookie Consent

Takos Web uses essential session cookies for login. The web app does not use ad
tracking or analytics cookies. A cookie consent banner records whether the user
allows preference storage for language, theme, and device-local UI choices.

| Storage | Purpose | Consent requirement |
| --- | --- | --- |
| `__Host-tp_session` cookie | Authenticated session | Essential; no opt-out while logged in |
| `takos-cookie-consent` localStorage | Consent record | Required to remember consent choice |
| `takos-lang` and theme localStorage | User-selected UI preference | Optional preference storage |
| Analytics / advertising cookies | Not used | Disabled |

## Operational Requirements

- `GET /api/me/privacy/export` must be covered by route tests and must not return
  token hashes or password hashes.
- `POST /api/me/privacy/deletion-requests` must disable account login by setting
  account status to `pending_deletion`.
- Auth middleware must reject non-`active` accounts, so existing cookie sessions
  cannot continue after deletion request acceptance.
- Release validation must include `cd takos/app && deno task test` or narrower
  route tests after privacy handler changes.

## Sources

- GDPR Article 6: https://eur-lex.europa.eu/eli/reg/2016/679/oj
- CCPA / CPRA regulations: https://cppa.ca.gov/regulations/pdf/cppa_regs.pdf
- Cloudflare Data Localization Suite: https://developers.cloudflare.com/data-localization/
- Stripe Privacy Center: https://stripe.com/privacy
