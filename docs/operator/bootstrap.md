# Bootstrap

fresh operator が Takos を立ち上げ、最初の PAT を取得するための Web-first
runbook です。Takos product は基本的に Web で操作し、CLI を primary bootstrap
経路にしません。

## Prerequisites

- `takos-private/` の target deploy が完了している
- `ADMIN_DOMAIN` が public HTTPS で解決できる
- [OAuth Setup](/operator/oauth-setup) の Google OAuth callback が登録済み
- `DB` / `SESSION_DO` / `GOOGLE_CLIENT_SECRET` が production または staging
  profile に入っている
- trusted edge / internal service secret は public internet へ露出していない

`takos/` shell から本番・staging deploy を直接進めません。deploy 設定と secret
操作は `takos-private/` を正本にしてください。

## 1. Admin Web に入る

browser で admin domain を開きます。

```text
https://<ADMIN_DOMAIN>/
```

未ログインなら `/auth/login` へ進み、Google OAuth で認証します。username/password
login を使う環境では `/auth/password` が同じ Web session を作ります。

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

## CLI Boundary

Takos bootstrap の primary path は Web UI です。`takos login` / `takos deploy`
のような Takos product CLI を fresh operator の正本導線として増やしません。

application manifest / workflow / git bridge は `takosumi-git`、kernel の explicit
manifest apply は `takosumi` が扱います。Takos product は Web UI と public API
から multi-tenant / OAuth / billing / catalog を操作する層です。
