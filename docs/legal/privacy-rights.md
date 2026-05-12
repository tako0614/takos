# Privacy Rights and Lawful Bases

> このページでわかること: Takos Web / API で扱う data subject rights handler、Cookie / localStorage の consent
> 境界、GDPR / CCPA 対応の法的根拠。

| Field         | Value                                                   |
| ------------- | ------------------------------------------------------- |
| Last reviewed | 2026-05-12                                              |
| Owner         | Takos app / API (`takos/app`)                           |
| Status        | Operational baseline; final legal review remains E-11.1 |

## Scope

Takos の app-local profile (chat / memory / preferences) は `takos/app` が 所有します。一方で **Takosumi Account の
identity-level privacy (OIDC subject / authentication / billing identity) は Takosumi Accounts が所有**します。 Takosumi
kernel は generic PaaS の JSON-LD Shape manifest / resource graph / provider materialization surface、takosumi-git は
installer / workflow / git bridge であり、Takos の個人データ access
/ export / deletion handler は Takos Web / API の app-local boundary を扱い、identity-level の data subject request は
Takosumi Accounts へ forward します。

## Data Subject Rights Handler

認証済みユーザーは次の API で自身の data subject request を開始できます。

| Right    | Method | Path                                | Behavior                                                                                                                                                                                                                    |
| -------- | ------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access   | `GET`  | `/api/me/privacy/access`            | subject、request status、available actions、lawful basis link を返す                                                                                                                                                        |
| Export   | `GET`  | `/api/me/privacy/export`            | account / settings / auth identity metadata / app-local usage events and rollups / repositories / threads / messages / runs / memories / notifications を JSON attachment として返す                                       |
| Deletion | `POST` | `/api/me/privacy/deletion-requests` | deletion request を `account_metadata` に記録し、account を `pending_deletion` にして再ログインを止め、Takos app-local SQL auth session を即時 revoke する。Accounts PAT / OIDC token は Takosumi Accounts 側で revoke する |

Deletion request は即時の credential revocation と account disable を行います。
請求・税務・不正対策・セキュリティ監査で保存義務または正当な利益が残るデータは、 final purge job または手動運用で
retention window に従って削除・匿名化します。

> **Usage / billing metadata の正本分担**: Export API が返す usage metadata は **Takos app-local の
> `app_usage_events` / `app_usage_rollups` mirror** に限定されます。Takosumi Account level の billing account /
> Stripe customer / subscription / invoice の **正本は Takosumi Accounts / operator BillingPort** が所有しており、
> これらに対する SAR (access / export / deletion / rectification) は **operator 側の DPA / privacy-rights handler**
> が受け付けます。Takos は受領後 **5 営業日以内** に Takosumi Accounts へ forward し、forward 完了を data subject
> に通知する SLA を負います。

**Region 制約**: Export API は AppInstallation の **residency profile** を尊重し、 profile が定める primary region
内でのみ data を回収します。cross-region replication は profile の例外 ([data-residency](/legal/data-residency) 参照)
として 記録され、export bundle は AppInstallation の primary region で生成されます。 Takosumi Account level の identity
export は `operator.identity.oidc` namespace export で resolve される Takosumi Accounts 側の別 SAR endpoint
で処理されます。

## Export Redaction Rules

Export handler はユーザー本人のデータを返しますが、再利用可能な credential secret は返しません。

| Data            | Export handling                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| Auth identities | provider、provider subject、email snapshot、linked / last login metadata を返す。refresh token ciphertext は返さない |
| App usage       | app-local usage event / rollup metadata を返す。Accounts billing account / Stripe identifiers は Takos 側では返さない |

## Lawful Bases

Takos は processing purpose ごとに lawful basis を分けます。EU / UK GDPR では Article 6 の contract、legitimate
interests、legal obligation、consent を使い、 CCPA / CPRA では business purpose、service-provider processing、consumer
request handling として同じ processing inventory に紐づけます。

| Purpose                                | Data categories                                                                                  | Lawful basis                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Service delivery                       | account, profile, spaces, repositories, threads, runs, app deployment metadata                   | Contract performance                         |
| Authentication and access control      | sessions, auth identities, Accounts bearer introspection metadata, IP / user agent security logs | Contract performance; legitimate interests   |
| Usage metering and billing handoff     | app-local usage events / rollups, Accounts billing handoff metadata                              | Contract performance; legal obligation       |
| Security monitoring and abuse response | audit logs, revocation records, moderation / incident metadata                                   | Legitimate interests; legal obligation       |
| Product reliability                    | error logs, performance metadata, aggregate usage                                                | Legitimate interests                         |
| Optional preferences                   | cookie consent state, language, theme, local UI preferences                                      | Consent or user-requested preference storage |

## Cookie Consent

Takos Web uses essential session cookies for login. The web app does not use ad tracking or analytics cookies. A cookie
consent banner records whether the user allows preference storage for language, theme, and device-local UI choices.

| Storage                             | Purpose                     | Consent requirement                   |
| ----------------------------------- | --------------------------- | ------------------------------------- |
| `__Host-tp_session` cookie          | Authenticated session       | Essential; no opt-out while logged in |
| `takos-cookie-consent` localStorage | Consent record              | Required to remember consent choice   |
| `takos-lang` and theme localStorage | User-selected UI preference | Optional preference storage           |
| Analytics / advertising cookies     | Not used                    | Disabled                              |

## Operational Requirements

- `GET /api/me/privacy/export` must be covered by route tests and must not return token hashes or password hashes.
- `POST /api/me/privacy/deletion-requests` must disable account login by setting account status to `pending_deletion`.
- Auth middleware must reject non-`active` accounts, so existing cookie sessions cannot continue after deletion request
  acceptance.
- Release validation must include `cd takos/app && deno task test` or narrower route tests after privacy handler
  changes.

## Sources

- GDPR Article 6: https://eur-lex.europa.eu/eli/reg/2016/679/oj
- CCPA / CPRA regulations: https://cppa.ca.gov/regulations/pdf/cppa_regs.pdf
- Cloudflare Data Localization Suite: https://developers.cloudflare.com/data-localization/
- Stripe Privacy Center: https://stripe.com/privacy
