# Takosumi API surface

> このページでわかること: Takosumi kernel の公開 API エンドポイント一覧。

`../takosumi/packages/kernel/src/api/openapi.ts` owns a dependency-free
OpenAPI-ish JSON snapshot for the Takosumi mounted route surface. The current
kernel public contract is `POST /v1/deployments`; older `/api/public/v1/*` paths
are migration compatibility routing and should not be described as the current
kernel public API. The generator is intentionally a plain TypeScript object
generator so API documentation can be checked without adding a docs/runtime
dependency to the kernel service.

Covered route groups:

- process: `GET /health`, `GET /capabilities`
- kernel deploy API: `POST /v1/deployments`
- migration compatibility documentation aliases: `/api/spaces`, `/api/groups`,
  `/api/deploy/plans`, `/api/deploy/applies`
- current mounted public route constants are preserved under
  `x-takos-mounted-path` / `x-takos-public-mounted-paths`
- internal service API: `/internal/spaces`, `/internal/groups`,
  `/internal/deploy/plans`, `/internal/deploy/applies`

The generator does not mount routes and must not be treated as router source of
truth. Route handlers remain in `public_routes.ts` and `internal_routes.ts`.
