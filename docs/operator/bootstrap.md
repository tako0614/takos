# Bootstrap

fresh operator が Takos を立ち上げ、最初の PAT を取得するための Web-first
runbook です。Takos product は基本的に Web で操作し、CLI を primary bootstrap
経路にしません。

Installable App Model における Takos は **OIDC consumer** として bootstrap
します。issuer は Takosumi Accounts (`accounts.takosumi.cloud`) に集約され、
fresh operator は Takosumi Accounts 側で AppInstallation 用の OIDC client
を取得し、Takos に `OIDC_*` env として注入します。

## Prerequisites

- `takos-private/` の target deploy が完了している
- `ADMIN_DOMAIN` が public HTTPS で解決できる
- [OIDC Setup](/operator/oidc-setup) の Google OAuth callback (operator
  login) が登録済み
- AppInstallation の domain が `<TENANT_HOST>` として確定している
- Takosumi Accounts (`accounts.takosumi.cloud`) で AppInstallation 用の
  OIDC client (`OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI`)
  が発行済み
- `DB` / `SESSION_DO` / `GOOGLE_CLIENT_SECRET` (operator login) /
  `OIDC_CLIENT_SECRET` (Takosumi Accounts 連携) が production または staging
  profile に入っている
- trusted edge / internal service secret は public internet へ露出していない

`takos/` shell から本番・staging deploy を直接進めません。deploy 設定と secret
操作は `takos-private/` を正本にしてください。

## Env table (current model)

operator が bootstrap 時に確認する env は次の通りです。Takos 自身は OAuth
provider を立ち上げず、Takosumi Accounts に登録した OIDC client の情報を
注入するだけで OIDC consumer として動きます。

| key                    | secret  | scope                 | 用途                                                          |
| ---------------------- | ------- | --------------------- | ------------------------------------------------------------- |
| `ADMIN_DOMAIN`         | no      | both                  | Takos admin Web の host                                       |
| `GOOGLE_CLIENT_ID`     | no      | operator login        | Google OAuth client ID (operator が admin Web に入るため)     |
| `GOOGLE_CLIENT_SECRET` | yes     | operator login        | Google OAuth client secret                                    |
| `OIDC_ISSUER_URL`      | no      | Takosumi Accounts     | endpoint URL example: `https://accounts.takosumi.cloud` (`${imports.account-auth.endpoints.oidc-issuer.url}` 経由 anchor resolve、 operator-injected hostname、 詳細は [cross-instance service binding](/architecture/cross-instance-service-binding)) |
| `OIDC_CLIENT_ID`       | no      | Takosumi Accounts     | AppInstallation 用の client id                                |
| `OIDC_CLIENT_SECRET`   | yes     | Takosumi Accounts     | confidential client secret                                    |
| `OIDC_REDIRECT_URI`    | no      | Takosumi Accounts     | `<TENANT_HOST>/auth/oidc/callback`                            |
| `BASE_URL`             | no      | Takos runtime         | Takos public URL                                              |
| `TAKOS_INSTALLATION_ID`| no      | Takos runtime         | AppInstallation id (app-local profile の FK)                  |
| `DB`                   | binding | both                  | persistence                                                   |
| `SESSION_DO`           | binding | both                  | browser session store                                         |

## 1. Admin Web に入る (operator login)

browser で admin domain を開きます。

```text
https://<ADMIN_DOMAIN>/
```

未ログインなら `/auth/login` へ進み、**operator login** (Google OAuth)
で認証します。これは Installable App Model でも維持される upstream IdP
経路です。username/password login を使う環境では `/auth/password` が同じ
Web session を作ります。

end user 向けの login (Takos chat への入口) はここでは扱いません。end
user は Takosumi Accounts (`accounts.takosumi.cloud`) 経由の OIDC で
ログインし、Takos 側は `/auth/oidc/login` + `/auth/oidc/callback` で
受けます ([/apps/oidc-consumer](/apps/oidc-consumer))。

## 2. 初回 setup を完了する

初回ユーザーは `/setup` に送られます。この画面は次の API で username と任意の
password credential を保存します。

| method | path                        | 用途                         |
| ------ | --------------------------- | ---------------------------- |
| GET    | `/api/setup/status`         | setup 状態確認               |
| POST   | `/api/setup/check-username` | username availability check  |
| POST   | `/api/setup/complete`       | username と任意 password 保存 |

Web 画面で username を決めて `continue` します。完了後、Takos Web の main app
に入れることを確認します。

## 3. PAT を Web UI で発行する

automation や API smoke に使う PAT は Web UI から発行します。

1. Takos Web の account settings を開く
2. OAuth settings を開く
3. Personal Access Tokens tab を開く
4. token 名を入力する
5. access level を選ぶ
6. 生成された `tak_pat_...` を secret store に保存する

PAT の access level は bucket です。

| bucket  | 用途                                      |
| ------- | ----------------------------------------- |
| `read`  | 読み取り API / smoke check                |
| `write` | deploy automation / repository automation |
| `admin` | 管理操作。短い TTL と厳格な secret 管理が必要 |

token value は作成時に一度だけ表示されます。再表示できないため、発行直後に
operator secret store へ移してください。

## 4. PAT で API smoke を行う

保存した PAT で `/api/me` を確認します。

```bash
curl -fsS \
  -H "Authorization: Bearer $TAKOS_PAT" \
  https://<ADMIN_DOMAIN>/api/me
```

レスポンスに setup 済み user が返れば、browser session と PAT の基本経路は動いています。

## 5. Automation へ渡す

PAT は operator が管理する secret store に保存し、必要な automation にだけ渡します。

- local shell や CI に直書きしない
- `TAKOS_INTERNAL_API_SECRET` / `TAKOS_INTERNAL_SERVICE_SECRET` を user token
  として使わない
- `admin` bucket は短命にし、作業後に削除する
- Git Smart HTTP などの automation には必要最小限の bucket を使う

## 6. Takosumi Accounts 連携を設定する

end user 向けの OIDC issuer は Takosumi Accounts に置きます。fresh operator
は次を完了させてください。

1. Takosumi Accounts (`accounts.takosumi.cloud`) で対象 AppInstallation
   の OIDC client を発行する (managed deploy では install pipeline が
   自動発行。self-host では手動登録)
2. 取得した `clientId` / `clientSecret` / `redirectUris` を
   `takos-private/` の secret store に保存する
3. Takos runtime に env として注入する。具体的な secret store / runtime
   の wiring (Cloudflare Workers profile の `wrangler.toml` `[vars]` /
   `wrangler secret put` 等) は **bootstrap runbook の scope 外** であり、
   `takos-private/` の deploy pipeline と secret 管理を正本にしてください
4. `<TENANT_HOST>/auth/oidc/login` にアクセスして Takosumi Accounts へ
   redirect されること、callback で session が作られることを確認する

## CLI Boundary

Takos bootstrap の primary path は Web UI です。`takos login` / `takos deploy`
のような Takos product CLI を fresh operator の正本導線として増やしません。

application manifest / workflow / git bridge は `takosumi-git`、kernel の explicit
manifest apply は `takosumi` が扱います。Takos product は Web UI と public API
から multi-tenant / OAuth / billing / catalog を操作する層です。
