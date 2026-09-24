# 内部トラスト境界 (正とする仕組み)

**前提: Takos は provider 中立のリソース契約と、runtime 固有の adapter を持ちます。**
Takosumi は選択された普通の OpenTofu module を install / apply します
(Capsule → `plan` Run → `apply` Run → StateVersion / Output)。provider の
credential と state の扱いは **ProviderConnection / ProviderBinding / policy** が
所有します。ここで説明するトラスト境界は、その Takosumi が適用した topology の
性質であり、手書きの deploy ファイル 1 つに依存せず、それが所有するものでも
ありません。契約は `deploy/product-resources.json` に宣言され、現在の
`deploy/opentofu/cloudflare` adapter が product graph を Cloudflare へ写像します。
adapter の provider-gap bridge は既定で無効なので、通常の production apply は
未対応の差分を未解決のまま残します。使い捨ての E2E は reviewed な bridge mode を
明示的に選びます。旧 Provider 1.x の Takoform projection は現在の install 経路
ではありません。`takosumi-private/platform/wrangler.toml` と repo 外の
operator-local secret が、同じ topology の暫定的な参照実体化です。

runtime では Takos は **Worker 1 つ** としてデプロイされます
(`src/worker/cloudflare-entrypoint.ts` が既定の面を `src/worker/index.ts` へ
委譲)。1 つの worker が公開インターネットの edge (admin ドメインへの
`web.fetch`) と自分自身 / binding の通信の両方を受けるため、「このリクエストは
内部か」をヘッダーで判定することは **できません**。外部クライアントはどんな
ヘッダーでも偽造できます。このページは、isolate / プロセス境界を越えるすべての
呼び出しでトラストをどう確立するかの、正とする判断です。

## ルール: ヘッダーではなく本物の境界で分類する

境界を越える呼び出しはちょうど **3 種類** あり、それぞれ仕組みは 1 つです。

### 1. 信頼できる worker 内呼び出し → アプリケーション認証なし (transport が境界)

worker のコードが **自分の Durable Objects** (`SessionDO`、`RunNotifierDO`、
`NotificationNotifierDO`、`RateLimiterDO`、`RoutingDO`、container-host の DO)
や **egress proxy** (`runtime/worker/egress.ts`、`TAKOS_EGRESS` service
binding 経由でのみ到達。`runtime-factory.ts`: "service-binding only, no public
routes") を呼ぶ場合です。

Durable Object の stub / service binding は、**binding を持つコード**、つまり
worker 自身のコードからしか到達できません。外部クライアントは stub を取得
できません。したがって binding / stub そのものがトラスト境界であり、
**目印も secret も署名も不要であり、付けてはいけません。** ここにヘッダー認証を
足すのは、偽造可能ヘッダーのバグを招くだけの形だけの対策です。

- 状態: **完了。** `X-Takos-Internal-Marker` はもうどこでも認証の関門では
  ありません。`validateContainerAuth` (audit #10) は削除済み、
  `notifier-base.isAuthorizedHttp` は `true` を返します (binding 境界)。
  **egress** proxy (`runtime/worker/egress.ts`) も marker を要求しません。
  実際の deploy は `TAKOS_EGRESS` を別の binding 専用 operator egress worker
  (`workers_dev = false`) に束縛するため、binding が境界であり、egress 自身の
  SSRF guard (private IP / port / protocol / redirect / credential の遮断) が
  外向きの安全性を担います。残る `X-Takos-Internal-Marker` の参照は防御的な
  受信側の除去 (`dispatch.ts:79`、ヘッダー除去リスト) だけで、それを信頼として
  読むものはありません。
- **受容済みの残存リスク — egress の DNS-rebinding TOCTOU。** `egress.ts` は
  DoH で対象を解決して private / internal IP を拒否しますが、続く `fetch()` は
  Workers プラットフォームの resolver でホスト名を再解決し、検証済み IP に
  **ピンされません**。Workers runtime には、正しい Host / SNI を保ちながら
  fetch をリテラル IP にピンする移植可能な方法がありません。DoH への問い合わせに
  公開 IP を返し、edge の resolver には private IP (または短い TTL の切り替え) を
  返すホスト名は、private-IP の関門を回避し得ます。両方の lookup は Cloudflare
  自身の resolver を通るため、広く開いた穴ではなく短い TTL 切り替えの競争に
  絞られます。**実施済みの緩和:** DoH 結果への private-IP 関門、
  `redirect: 'manual'`、space ごとの egress rate limit (rebinding の時間窓を
  縮小)。**Operator の緩和 (強い分離に必須):** egress を RFC1918・link-local・
  metadata endpoint の宛先を自分で遮断する network egress DMZ / firewall の後ろに
  置き、worker 内の関門が競争で抜かれても rebind が内部アドレスへ届かないように
  します。Workers が任意ホスト名への IP-pinned fetch を公開したら、worker 内の
  pinning を再検討します。
- **デプロイの不変条件 — Takos は provider 中立で OpenTofu-native。** Takos の
  deploy topology は product 所有の契約と、選択された plain な OpenTofu adapter
  です。外部の Takosumi deploy-control がそれを Capsule として install / apply
  し (Capsule → `plan` Run → `apply` Run → StateVersion / Output)、
  ProviderConnection が credential の参照を持ち、ProviderBinding が provider
  ごとに接続を解決し、policy が provider の許可リスト・state backend・runtime
  実行要件を解決します。秘密でない service URL / binding map は **Output** と
  して記録されます。したがって以下のトラスト境界の不変条件は、手入れされた
  wrangler のものではなく、**reviewed plan で検証される module の性質**です。
  (`takosumi-private/platform/wrangler.toml` と repo 外の operator-local
  secret は同じ topology の暫定的な参照実体化であり、Takosumi が適用する
  module に収束します。別の正とする情報として扱わないでください。)
  - **egress** service は binding 専用でなければなりません。公開 route なし
    (`workers_dev = false`)。tier 1: `TAKOS_EGRESS` binding を持つのは
    worker のコードだけなので、binding が境界です。
    - **profile の適用範囲。** 「binding が境界」という主張が成り立つのは
      **Cloudflare profile** で、そこでは `TAKOS_EGRESS` が service binding
      です。**node-postgres / self-host profile** では、worker は egress に
      **URL で** 到達します (`TAKOS_EGRESS_URL`、
      `node-platform/resolvers/dispatch-resolver.ts` で解決)。binding はなく、
      marker 削除後はその hop にアプリケーション層の認証もありません。したがって
      その境界は **deploy のネットワーク分離の不変条件** です。egress の URL は
      信頼できないネットワークから到達できてはならず (worker プロセスだけが
      到達できる)、egress 自身の SSRF guard が裏付けです。この不変条件は
      deploy の実体化 (`takosumi-private` / operator-local 設定) が所有し、
      そこで表明しなければなりません (egress URL が公開経路可能でないこと)。
      worker のコードが強制するものではありません。staging で検証されるまでは、
      node-profile の egress は URL 到達可能として扱い、ネットワーク分離を
      保ってください。
  - 単一 worker が公開する **container callback endpoint** は、信頼できない
    agent 実行コンテナから URL で到達できる状態を保つ必要があります。コンテナは
    URL で呼び戻します (`PROXY_BASE_URL`、`TAKOS_AGENT_CONTROL_RPC_BASE_URL`)。
    Cloudflare Container は service binding を持てないからです。これらの境界は
    binding ではなく **実行ごとの token (tier 2)** です。binding 専用にすると
    container の呼び戻しが壊れます。tier 1 (binding 境界) が適用できない場所に
    tier 2 (本物の credential) がある理由がまさにこれで、container の実行と
    credential を持つのは別の runtime service ではなく Takosumi の
    ProviderConnection / ProviderBinding / policy です。
- 不変条件: worker 内呼び出しを「信頼できる」に変換するヘッダーを再導入
  しないこと。将来の DO が呼び出し元を区別する必要があるなら、偽造可能な
  ヘッダーではなく型付きの引数で表してください。

### 2. 信頼できない実行コンテナ → worker → 実行ごとの capability token (信頼できない相手の認証)

**agent 実行コンテナは信頼できない / 利用者供給のコードを実行し**、
`/api/internal/v1/agent-control/*` → `/internal/executor-rpc/*` 経由で
呼び戻します。これは「内部認証」ではなく、信頼できない相手を認証するものなので、
本物の credential を維持します。

- 発行元ホストで検証する **実行ごとの proxy token** (`executor-host.ts` の
  `verifyProxyToken`)。`body.runId` / `serviceId` は検証済み token から
  **上書き** し、`claimsMatchRequestBody` は安全側に失敗します。
- すべての control-RPC handler は、**request body ではなく token に束縛された
  run から tenant・thread・identity を導きます** (`resolveRunThreadTenant`、
  `getRunBootstrap`、TIER A binding)。侵害されたコンテナが別の tenant を狙えない
  ようにします。
- 最小権限: 実行コンテナへ転送する secret は、その job が参照するものに限定
  します (`collectReferencedSecretNames`)。
- 対象の hardening (追跡中・未実施): 単一の粗い `ProxyCapability="control"` を
  用途ごとの scope に分割し、実行 run には agent run より小さい集合を与え、
  実行コンテナの egress を既定拒否にします。

### 3. サービス間の実装呼び出し → worker → 1 つの署名付き envelope

Takos には、scheduled job、featured-app カタログ確認、agent-control の backend
呼び出しのような、product 内部の実装呼び出しが残っています。これらは Takosumi
正規の `/internal/*` 公開 route 族ではありません。Takosumi は `/internal/*`
HTTP route を、各 worker 内の runner / executor コンテナの呼び戻し用に予約して
います。閉じた hosted deploy には、OSS / Takos self-host の公開モデルの外側に
provider endpoint bridge があることがありますが、それらの route は Takos の
product route ではなく、Takosumi OSS の customer API でもありません。Takos の
product コードが本物の service / trust-domain の境界を越えるときは、route 名や
ヘッダーの目印ではなく、署名付きリクエスト envelope を使わなければなりません。

- **正とする仕組み: `takos-internal-v3` HMAC 署名付きリクエスト envelope**
  (`verifyTakosumiInternalRequestFromHeaders`)。method + path + body への署名に、
  `caller` / `audience` / `capabilities` / nonce / timestamp (replay 防止)
  を含みます。既に `/internal/executor-rpc` (signed-backend mode) と
  `/api/internal/v1/agent-control-backend` を支えています。
- **判断:** 署名付き envelope が、Takos の HTTP サービス呼び出しのための
  唯一のサービス間プリミティブです。agent コンテナの `/start` entrypoint は
  `TAKOS_AGENT_START_TOKEN` が守る、より狭い private-container の境界です。
  その後の agent-control RPC は別の、実行ごとの乱数 token と scope を使います。

## 「内部認証は不要」の正確な意味

**tier 1** (worker 内) では正しく、marker があったのはそこで、今は除去済みです。
tier 2 / 3 では **誤り** です。そこは本物のトラスト境界 (信頼できないコード、
または別のサービス) を越えるため、credential を維持します。きれいな終状態は
「認証ゼロ」ではなく、「**ヘッダーの目印なし。binding がある場所では binding が
境界、本物のトラスト境界を越える場所では単一の署名付き envelope / 実行ごとの
token**」です。

## 実行状況と残る契約

- tier 1: **Cloudflare profile で完了** (marker 除去、binding 境界、audit #10 は
  削除で完了)。注意点: **node-postgres / self-host profile** では worker →
  egress の hop は binding ではなく URL 到達可能なので、その境界は deploy の
  ネットワーク分離の不変条件 (egress URL が公開経路可能でないこと) であり、
  `takosumi-private` の staging evidence で表明する必要があります。上記の
  egress の profile 適用範囲の注記を参照してください。
- tier 2: tenant 横断の binding と最小権限の secret は **完了**。capability の
  分割と workflow egress の関門は追跡中です。
- tier 3: 署名付き envelope は **存在し、Takos product のサービス間実装呼び出しの
  正とする仕組み** です。平文 secret の関門をこれへ畳むには、cross-repo の
  operator 側呼び出し元が envelope を送り、そのうえで `/internal/*` と egress
  が binding / entrypoint 経由でのみ到達できるよう topology を調整する必要が
  あります。これらは worker 内の編集ではなく **deploy 環境の変更** で、
  `takosumi-private` の staging evidence で検証します。
- 任意の transport 更新: tier 1 / 2 は、将来的に binding 経由の
  `.fetch(Request)` からネイティブの Cloudflare RPC (WorkerEntrypoint /
  DO RPC) へ移し、型付きでヘッダーなしの呼び出しにできます。これは整頓の
  ためだけのもので、marker は既にないため残る security 上の利益はなく、
  `bun test` で local エミュレーションの同等性を証明したうえで、一まとめの
  変更として行う必要があります。
