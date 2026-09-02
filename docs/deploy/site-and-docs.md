# サイトとドキュメントの配置

`takos.jp` (product site) と `docs.takos.jp` (このドキュメント) は、Takos を所有する
repository の deploy entrypoint から公開します。どちらも prerender 済みの静的
bytes を Cloudflare Pages project へ載せるだけの surface です。

```sh
bun run deploy -- takos-site --apply --environment production --execute
bun run deploy -- takos-docs --apply --environment production --execute
```

Takos の Worker 本体は別 surface です。そちらは
[本番デプロイレーン](/deploy/production-lane) を参照してください。

## 2 つの surface

| surface | 公開先 | Pages project | 出力 | build |
| --- | --- | --- | --- | --- |
| `takos-site` | `https://takos.jp` | `takos-landing` | `website/.output/public` | `npm run build` (SolidStart / Vinxi の static prerender) |
| `takos-docs` | `https://docs.takos.jp` | `takos-docs` | `docs/.vitepress/dist` | `bun run docs:build` (VitePress) |

どちらも durable state、server handler、target 側が保持する credential、
利用者が pin する identity を持ちません。したがって trigger は 0 で、負う義務は
provenance / post-conditions / reversal / failure-handling の baseline 4 つだけです。
policy 上は routine の `static` lane です。

### なぜ docs は subdomain なのか

ドキュメントは `takos.jp/docs/` ではなく `docs.takos.jp` の独立 origin に置きます。

- `docs/.vitepress/config.ts` は `base` を宣言していません。VitePress の既定は `/`
  なので、生成される HTML の asset link は `/assets/…` という root 相対です。
  `takos.jp/docs/` で serve すると、その link は landing 側の origin root を指して
  しまいます。path で配るなら `base: "/docs/"` が必要で、それは docs 側の
  出力形状そのものを変える決定です。
- website はすでに `https://docs.takos.jp/` を外向き link として配信しています
  (`website/src/components/Nav.tsx`、`website/src/content/site.ts`)。landing の
  `_headers` の CSP `connect-src` にも同じ origin が入っています。
- 2 つの origin に分けると、片方の publication がもう片方の bytes に触れません。
  landing の typo 修正が docs を再公開しませんし、その逆もありません。

`takos.test` の local-substrate だけは Caddy が同一 origin の `/docs/` を別 root へ
route します。これは開発用の mirror であり、公開先の決定ではありません。

## 必要な入力

| 入力 | 何か | 必須 |
| --- | --- | --- |
| `--environment` | `integration` / `rehearsal` / `production` | 常に |
| `--commit` | HEAD と一致する exact commit | `main` 以外から production を配置するとき |
| `--execute` | 実際に upload する | mutate するとき |
| `CLOUDFLARE_API_TOKEN` | account を選ぶ credential | 常に (環境変数のみ) |
| `CLOUDFLARE_ACCOUNT_ID` | token が複数 account に届くときの選択 | 条件付き |

credential を repository、`.env`、output、deploy 記録へ書きません。entrypoint は
値を読むだけで、記録も echo もしません。

`takos-site` は `website/` の依存を先に install しておく必要があります
(`cd website && npm ci`)。`website/` は root の bun workspace ではなく、独立した
npm package です。

## この surface が所有しないもの

- Pages project の作成、rename、custom domain の紐付け。これは provisioning と DNS
  で、deploy とは別 authority です。project が見えないとき、entrypoint は
  account に触れる前に refuse します。
- `app.takos.jp` の Worker。`takos-cloudflare-production` が所有します。

## Phase

### `--status` (read-only)

account を変更する command は issue そのものを拒否します。

- HEAD の commit / branch / clean か
- Pages project が存在するか、production deployment の id・URL・commit
- build 出力があるか、smoke 対象ファイルの SHA-256
- 公開 URL の実 response と、その bytes が手元の build と一致するか
- 以上から算出した `drift`

### `--apply`

routine な static lane です。次を順に確かめ、どれか 1 つでも欠ければ account に
触れる前に止まります。

1. `CLOUDFLARE_API_TOKEN` があること
2. production は clean な worktree と `main`、または HEAD と一致する `--commit`
   (integration / rehearsal は dirty のままで構いません)
3. Pages project が token から見えること
4. scoped gate が通ること (下記)
5. build 出力が存在し、smoke する page がその中にあること
6. 公開される bytes に credential 形状が無いこと

`--execute` を付けたときだけ upload が 1 回走ります。upload の後は、immutable な
`https://<hash>.<project>.pages.dev` が今 build した bytes を返すことを確認し、
production ではさらに公開 URL の 2 page が同じ digest を返すまで確認します。

### scoped gate

policy は validation を artifact に scope します。prerender された HTML の folder を
Worker の test suite 全体で gate しません。各 surface が回すのは、公開する bytes を
実際に覆う check だけです。

| surface | scoped gate |
| --- | --- |
| `takos-site` | `bun run check:website-host` → `npm run build` (website/) |
| `takos-docs` | `bun run validate:current-docs` → `bun run validate:api-docs` → `bun run docs:build` |

gate の最後が build なので、公開される bytes は gate が今作った bytes です。
disk に転がっていた古い出力を上げることはありません。

## environment と Pages branch

| environment | Pages branch | 公開 alias | worktree |
| --- | --- | --- | --- |
| `integration` | `integration` | 動かない (preview) | dirty 可 |
| `rehearsal` | `rehearsal` | 動かない (preview) | dirty 可 |
| `production` | `main` | 動く | clean `main` または exact commit |

preview は公開 alias を動かさないので、readback も immutable deployment URL だけを
読みます。公開 URL を読むと他人の bytes を読むことになるからです。

## 初回の公開

```sh
# 0. 一度だけ。project 作成と custom domain は deploy とは別 authority です。
wrangler pages project create takos-landing --production-branch main
wrangler pages project create takos-docs --production-branch main
# Cloudflare dashboard の Custom domains で
#   takos.jp / www.takos.jp -> takos-landing
#   docs.takos.jp           -> takos-docs
# を紐付ける。

# 1. credential は環境変数から。
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...   # token が複数 account に届くとき

# 2. website の依存を install する。
cd website && npm ci && cd ..

# 3. 何も変えずに現状を読む。
bun run deploy -- takos-site --status --environment production
bun run deploy -- takos-docs --status --environment production

# 4. preview へ 1 回通す (dirty でも可)。
bun run deploy -- takos-site --apply --environment integration --execute
bun run deploy -- takos-docs --apply --environment integration --execute

# 5. production の plan を読む (upload しません)。
bun run deploy -- takos-site --apply --environment production

# 6. clean な main から公開する。
bun run deploy -- takos-site --apply --environment production --execute
bun run deploy -- takos-docs --apply --environment production --execute
```

## 戻し方

upload の前に、現在の production deployment の id・URL・commit を読み取って印字
します。戻すのは Cloudflare 自身の Pages deployment history です。

- dashboard の該当 deployment で「Rollback to this deployment」
- または `POST /accounts/<account>/pages/projects/<project>/deployments/<id>/rollback`

wrangler には `pages rollback` subcommand がありません。entrypoint は持っていない
command を持っているふりをせず、戻し先の id を出します。初回公開には戻し先が
存在しないので、その旨を出力し、前の commit を build して公開し直すのが forward
repair です。

## 失敗したとき

exit code が、失敗が mutation のどちら側で起きたかを表します。

| exit | 意味 | 次にすること |
| --- | --- | --- |
| 2 | 何も触っていない | 出力された理由を直して再実行する |
| 3 | upload が届いたか不明 | `--status` で authoritative に読んでから判断する |
| 4 | bytes は公開されたが post-condition が失敗 | 印字された戻し先と比較する |

いずれも provider の stdout / stderr をそのまま出します。blind retry はしません。

## 関連ページ

- [本番デプロイレーン](/deploy/production-lane)
- [ロールバック](/deploy/rollback)
- [ルートとドメイン](/deploy/routes)
