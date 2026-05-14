# Security Policy

Please do not disclose vulnerabilities through public issues before maintainers
have had time to assess impact and prepare a fix.

Report Takos product vulnerabilities to `security@takos.jp`. The public
disclosure policy is maintained at `/legal/security-disclosure` in the docs site
and in `docs/legal/security-disclosure.md`.

Include the affected app/package, reproduction steps, impact, and any temporary
mitigation you already validated.

Never commit production secrets, private keys, or real infrastructure IDs while
preparing a report.

## Per-route rate limiting

Takos applies rate limits at two layers:

1. **Operator tier (required for self-host)**: a CDN / WAF / reverse-proxy
   limiter in front of the app. This is the primary defense against generic
   request flooding and abusive replay.
2. **Per-route limiter (`InMemoryRateLimiter` / `RateLimiters`)**: applied
   only to a small set of endpoints with specific cost / abuse profiles
   (today: `routes/index`, `routes/public-share`, `routes/spaces/storage-operations`).

Other auth-adjacent and high-cost mutation endpoints currently rely on the
operator-tier limiter only. The most security-relevant ones are annotated
inline with a `// SECURITY: ...` comment so operators auditing self-host
configuration can find them quickly:

- `POST /auth/logout` (`server/routes/auth/session.ts`)
- `POST /api/auth/logout` (`server/routes/auth-api.ts`)
- `POST /api/auth/setup-username` (`server/routes/auth-api.ts`)
- `GET  /auth/oidc/login` (`server/routes/auth/oidc.ts`)
- `GET  /auth/oidc/callback` (`server/routes/auth/oidc.ts`)
- `POST /spaces/:spaceId/threads` (`server/routes/threads/space.ts`)

If you operate Takos without an upstream CDN / WAF limiter, treat these
endpoints as the highest priority for a self-hosted limiter (e.g. an Nginx
`limit_req` zone keyed on client IP + cookie).
