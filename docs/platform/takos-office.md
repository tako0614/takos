# takos-office

takos-office は、利用者が Takos Workspace に明示的に install できる office アプリです。
文書 (docs)・スライド (slide)・表計算 (sheet) の画面を 1 つの worker にまとめ、
エージェント向けの MCP endpoint を 1 つ公開します。

## Runtime contract

Takos Office は取り外せる普通の Capsule アプリです。UI 画面、file handler、
protocol.mcp.server の publication を公開し、別途 install した takos-storage
Capsule の storage.object publication を利用します。

利用時には files:read / files:write を要求します。Takosumi の bind-time grant
broker が、endpoint を OBJECT_STORAGE_API_URL、prefix 限定の bearer を
OBJECT_STORAGE_ACCESS_TOKEN、割り当てられた object prefix を
OBJECT_STORAGE_KEY_PREFIX として注入します。credential は保護された
takos-storage の署名素材から来るため、公開の OpenTofu Output には出ません。

## 画面

- /docs — .takosdoc
- /slide — .takosslide
- /sheet — .takossheet
- /mcp — 統合 Office MCP server

文書・スライド・表計算のデータは、どれも同じ storage.object publication に
保存します。別々の現行アプリではありません。

## 関連ページ

- [Installable Apps](/platform/featured-apps)
- [Takos App Interface](/architecture/app-interface)
- [Capsule Runtime Projection](/architecture/capsule-runtime-projection)
