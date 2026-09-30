# 初回セットアップ

> このページでわかること: self-host / operator-managed Takos を新規に立ち上げるときの Web ベース確認。

Takos は各自が自分用にデプロイする、所有者1人のソフトウェアです。追加の private Workspace を
作っても所有者は増えません。外部相手への共有や通信は、それぞれの機能のアクセス境界で扱います。

Takos distribution worker は Takos product surface を提供し、Accounts / deploy-control / dashboard は外部 Takosumi
control plane が所有します。self-host では self-hoster または operator が運用する Takosumi Accounts origin が OIDC issuer
です。hosted Takosumi の public platform では `https://app.takosumi.com` が issuer になります。

Takos runtime は外部 hosted Takosumi Accounts を必須にしません。upstream Google / GitHub / enterprise OIDC / passkey は
Takosumi Accounts plane の upstream IdP / credential policy として扱い、Takos product routes は account-plane subject
から app-local profile / session を作ります。

## Prerequisites

- Takos OpenTofu module が product backing resources (D1 / KV / R2 / Queues) を作成済み
- worker artifact が同じ origin に deploy 済み
- `BASE_URL` が Takos worker origin、`TAKOSUMI_ACCOUNTS_URL` / `OIDC_ISSUER_URL` が Takosumi Accounts origin を指す
- `identity.oidc` capability が `TAKOSUMI_ACCOUNTS_URL` / `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` /
  `OIDC_REDIRECT_URI` の4つの公開値を届けている (confidential client の `OIDC_CLIENT_SECRET` は operator が別途 secret store から設定する)
- operator が `OIDC_OWNER_SUBJECT` を設定し、`OIDC_ISSUER_URL` の正確な所有者 subject へ固定済み。未設定では login を有効にしない
- `DB` / `SESSION_DO` などの Takos product bindings が production または staging profile にある
- trusted edge / internal service secret は public internet へ露出していない

`takos/` shell から本番・staging deploy を直接進めません。deploy 設定と secret 操作は operator-local secret store と
Takosumi operations runbook で管理してください。

## Env テーブル

| key                     | secret   | scope                 | 用途                                           |
| ----------------------- | -------- | --------------------- | ---------------------------------------------- |
| `BASE_URL`              | no       | worker origin         | Takos public origin                            |
| `TAKOSUMI_ACCOUNTS_URL` | no       | Accounts plane        | external Takosumi Accounts API / issuer origin |
| `OIDC_ISSUER_URL`       | no       | Takos auth consumer   | Takosumi Accounts issuer                       |
| `OIDC_OWNER_SUBJECT`   | no       | Takos instance owner  | この issuer の正確な所有者 `sub`。first visitor や email から推測しない |
| `OIDC_CLIENT_ID`        | no       | Accounts projection   | Takosumi Accounts plane が発行した client id   |
| `OIDC_CLIENT_SECRET`    | optional | operator secret store | confidential client の場合だけ使う secret      |
| `OIDC_REDIRECT_URI`     | no       | Accounts projection   | `<BASE_URL>/auth/oidc/callback`                |
| `ENCRYPTION_KEY`        | yes      | Takos product DB      | app-local secret と委任OAuth tokenの暗号化     |
| `DB`                    | binding  | Takos product         | app-local persistence                          |
| `SESSION_DO`            | binding  | Takos product session | browser session store                          |

issuer/client/redirect の4値は Takosumi Accounts plane の consumer metadata です。
`OIDC_OWNER_SUBJECT` は別の Takos アプリ設定として operator が指定します。
通常の OpenTofu module では `env = { OIDC_OWNER_SUBJECT = "<exact-owner-sub>" }` に渡します。
Node/self-host でも同名の環境変数を使います。実際の値へ置き換え、同じissuerで所有者を
確認してから公開します。`identity.oidc` の4値に所有者が含まれるとは仮定しません。
subject は既存 Accounts の所有者が、この登録済み Takos client で認証したときの
UserInfo の `sub` から確認します。email、表示名、Workspace ID を代入しません。
token 自体は設定・log・OpenTofu state へ保存しません。client ごとに pairwise subject が
異なる場合は browser/mobile の対応を Accounts 担当へ確認し、自動 alias を作りません。

## 1. Admin Web に入る

browser で worker origin を開きます。

```text
https://<BASE_URL>/
```

未ログインなら `/auth/oidc/login` へ進み、Takosumi Accounts issuer で認証します。Takos は
`/auth/oidc/login` / `/auth/oidc/callback` / `/auth/logout` を consumer route として受けます。upstream IdP は Accounts
plane 側の policy で扱います。

Takos の dynamic client は public PKCE client を標準とし、`openid profile email offline_access capsules:read
capsules:write` を要求します。login は Workspace selector を authorize query や一回限りの state に入れません。Accounts が
Capsule/client と現在の membership から Workspace を解決し、callback は UserInfo の nonempty な
`takosumi.workspace_id` と一意で一致する `workspace_memberships` を検証した場合だけ、access/refresh token と検証済み
Workspace binding を `ENCRYPTION_KEY` で暗号化して app-local DB に保存します。Takos 内の Workspace は product data boundary
であり、membership 配列から Workspace を推測したり、claim のない応答を受け入れたりしません。app launcher の
plan/apply/list/delete は、ログイン時に発行された親 Workspace binding に対して行います。

## 2. 初回 setup を完了する

初回の所有者は `/setup` に送られます。この画面は app-local profile の setup 完了flagを保存します。
公開 username の登録やインスタンス所有者の選択は行いません。ログイン用
credential、upstream IdP、PAT、billing identity は Accounts plane が所有します。

| method | path                  | 用途           |
| ------ | --------------------- | -------------- |
| GET    | `/api/setup/status`   | setup 状態確認 |
| POST   | `/api/setup/complete` | setup 完了flag保存 |

## 3. 所有者の Accounts bearer で API smoke を行う

automation や smoke 用 token は Accounts plane の account settings / PAT flow で発行し、operator secret store に保存します。

```bash
curl -fsS \
  -H "Authorization: Bearer $TAKOS_ACCOUNTS_TOKEN" \
  https://<BASE_URL>/api/me
```

所有者の bearer で setup 済み user が返ることを確認します。別 subject の bearer と
旧別ユーザーの cookie は拒否される必要があります。このAPIだけで browser login、実Runや復旧の成功を証明しません。

## Boundary

Takos bootstrap の primary path は Web UI / public API です。OpenTofu module Source / Capsule / typed Runs、
StateVersion、Output、ProviderConnection / ProviderBinding、billing / OIDC policy は external Takosumi control plane が扱います。
