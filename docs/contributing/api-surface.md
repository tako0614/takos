# Takosumi API surface

> このページでわかること: Takosumi kernel の公開 API エンドポイント一覧。

`../takosumi/packages/kernel/src/api/openapi.ts` が Takosumi の mounted route を表す依存ゼロの OpenAPI 風 JSON snapshot を保持します。kernel の公開 contract は `POST /v1/deployments`。`/api/public/v1/*` の Takos プロダクト gateway route は `takos/app` 側で管理しており、kernel 公開 API としては扱いません。

snapshot generator は plain TypeScript object として実装してあり、kernel service に docs / runtime 依存を増やさずに API documentation を検証できます。

カバーする route グループ。

- プロセス: `GET /health`, `GET /capabilities`
- kernel deploy API: `POST /v1/deployments`
- Takos に mount された snapshot 用 documentation alias: `/api/spaces`, `/api/groups`, `/api/deploy/plans`, `/api/deploy/applies`
- mount されている public route 定数は `x-takos-mounted-path` / `x-takos-public-mounted-paths` で保持
- internal service API: `/internal/spaces`, `/internal/groups`, `/internal/deploy/plans`, `/internal/deploy/applies`

このスナップショット生成器は route を mount しないため、router の source of truth として扱ってはいけません。route handler は `public_routes.ts` と `internal_routes.ts` にあります。
