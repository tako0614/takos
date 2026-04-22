# takos-common

Shared utility library used across all Takos services. Provides foundational
building blocks: ID generation, input validation, structured logging, a
comprehensive error hierarchy, environment variable parsing, abort signal
handling, and Hono middleware for service-to-service JWT authentication and
error handling.

## Architecture

```
src/
  index.ts              -- barrel re-exports for the default entrypoint
  id.ts                 -- cryptographic random ID generation
  validation.ts         -- localhost / private IP detection
  logger.ts             -- zero-dependency structured JSON logger
  errors.ts             -- AppError hierarchy (4xx/5xx) + utilities
  env-parse.ts          -- environment variable parsing (int, float)
  abort.ts              -- AbortSignal helpers
  jwt.ts                -- RS256 JWT verification (internal)
  middleware/
    hono.ts             -- Hono middleware: JWT auth, error handler, 404
```

## Subpath Exports

The package exposes multiple subpath imports so consumers can import only what
they need:

| Import Specifier               | Module                   | Description                 |
| ------------------------------ | ------------------------ | --------------------------- |
| `takos-common`                 | `src/index.ts`           | All utilities (barrel)      |
| `takos-common/id`              | `src/id.ts`              | ID generation               |
| `takos-common/validation`      | `src/validation.ts`      | IP/hostname validation      |
| `takos-common/abort`           | `src/abort.ts`           | AbortSignal utilities       |
| `takos-common/errors`          | `src/errors.ts`          | Error classes and utilities |
| `takos-common/middleware/hono` | `src/middleware/hono.ts` | Hono middleware             |
| `takos-common/logger`          | `src/logger.ts`          | Structured logger           |
| `takos-common/env-parse`       | `src/env-parse.ts`       | Env variable parsing        |

## Key Exports

### ID Generation (`takos-common/id`)

```typescript
import { generateId } from "takos-common/id";

const id = generateId(); // 12-char alphanumeric, e.g. "a1b2c3d4e5f6"
const long = generateId(24); // custom length
```

Uses `crypto.getRandomValues()` for cryptographic safety. Character set:
`a-z0-9` (36 chars).

### Validation (`takos-common/validation`)

```typescript
import { isLocalhost, isPrivateIP } from "takos-common/validation";

isLocalhost("localhost"); // true
isLocalhost("app.localhost"); // true
isLocalhost("example.com"); // false

isPrivateIP("192.168.1.1"); // true
isPrivateIP("10.0.0.1"); // true
isPrivateIP("8.8.8.8"); // false
isPrivateIP("::ffff:10.0.0.1"); // true (IPv4-mapped IPv6)
```

`isPrivateIP` covers RFC 1918 ranges, loopback, link-local, carrier-grade NAT
(100.64/10), documentation ranges (TEST-NET-1/2/3), multicast, and IPv4-mapped
IPv6 addresses.

### Structured Logger (`takos-common/logger`)

```typescript
import { createLogger } from "takos-common/logger";

const logger = createLogger({ service: "my-service", level: "info" });
logger.info("Request handled", { path: "/api/v1", status: 200 });
// => {"level":"info","msg":"Request handled","ts":"...","service":"my-service","path":"/api/v1","status":200}

const child = logger.child({ requestId: "abc123" });
child.warn("Slow query", { durationMs: 1500 });
```

Zero-dependency JSON logger designed for Cloudflare Workers observability.
Supports `debug`, `info`, `warn`, `error` levels with minimum-level filtering.
Error values are automatically serialized to `{ name, message, stack }`.

### Error Handling (`takos-common/errors`)

A structured error hierarchy where every error carries an HTTP status code,
machine-readable error code, and safe user-facing message.

| Error Class               | Status | Code                  |
| ------------------------- | ------ | --------------------- |
| `BadRequestError`         | 400    | `BAD_REQUEST`         |
| `AuthenticationError`     | 401    | `UNAUTHORIZED`        |
| `PaymentRequiredError`    | 402    | `PAYMENT_REQUIRED`    |
| `AuthorizationError`      | 403    | `FORBIDDEN`           |
| `NotFoundError`           | 404    | `NOT_FOUND`           |
| `ConflictError`           | 409    | `CONFLICT`            |
| `GoneError`               | 410    | `GONE`                |
| `PayloadTooLargeError`    | 413    | `PAYLOAD_TOO_LARGE`   |
| `ValidationError`         | 422    | `VALIDATION_ERROR`    |
| `RateLimitError`          | 429    | `RATE_LIMITED`        |
| `InternalError`           | 500    | `INTERNAL_ERROR`      |
| `NotImplementedError`     | 501    | `NOT_IMPLEMENTED`     |
| `BadGatewayError`         | 502    | `BAD_GATEWAY`         |
| `ServiceUnavailableError` | 503    | `SERVICE_UNAVAILABLE` |
| `GatewayTimeoutError`     | 504    | `GATEWAY_TIMEOUT`     |

All extend `AppError` which provides `toResponse()` for safe API serialization.

Utilities:

| Function                             | Description                                         |
| ------------------------------------ | --------------------------------------------------- |
| `isAppError(error)`                  | Type guard for `AppError` instances                 |
| `normalizeError(error, logger?)`     | Convert unknown errors to `AppError`                |
| `getErrorMessage(error, fallback?)`  | Extract human-readable message from any error value |
| `logError(error, context?, logger?)` | Log error with structured metadata                  |

### Environment Variable Parsing (`takos-common/env-parse`)

```typescript
import {
  parseFloatEnv,
  parseIntEnv,
  parseIntEnvRequired,
} from "takos-common/env-parse";

const port = parseIntEnv("PORT", 8080, { min: 1, max: 65535 });
const timeout = parseFloatEnv("TIMEOUT_SEC", 30.0, { min: 0 });
const required = parseIntEnvRequired("WORKER_COUNT", { min: 1 });
```

| Function                                     | Description                              |
| -------------------------------------------- | ---------------------------------------- |
| `parseIntEnv(name, default, opts?)`          | Optional int env var with fallback       |
| `parseIntEnvRequired(name, opts?)`           | Required int env var (throws if missing) |
| `parseIntValue(name, raw, default, opts?)`   | Parse int from string (non-Deno.env)     |
| `parseFloatEnv(name, default, opts?)`        | Optional float env var with fallback     |
| `parseFloatValue(name, raw, default, opts?)` | Parse float from string                  |

All support `min`/`max` boundary checks and emit warnings for invalid values.

### Abort Signal Utilities (`takos-common/abort`)

```typescript
import { throwIfAborted } from "takos-common/abort";

throwIfAborted(signal, "agent-step");
// throws AppError if signal is aborted
```

### Hono Middleware (`takos-common/middleware/hono`)

**Service Token Authentication** -- RS256 JWT verification for
service-to-service calls:

```typescript
import {
  createServiceTokenMiddleware,
  type ServiceTokenEnv,
} from "takos-common/middleware/hono";

const app = new Hono<ServiceTokenEnv>();
app.use(
  "*",
  createServiceTokenMiddleware({
    jwtPublicKey: "-----BEGIN PUBLIC KEY-----...",
    expectedIssuer: "takos-control",
    expectedAudience: "takos-runtime",
    skipPaths: ["/health"],
    clockToleranceSeconds: 30,
  }),
);
```

**Error Handler** -- structured error responses for `app.onError`:

```typescript
import {
  createErrorHandler,
  notFoundHandler,
} from "takos-common/middleware/hono";

app.onError(createErrorHandler({ includeStack: !isProduction }));
app.notFound(notFoundHandler);
```

**Route Helpers** -- convenience response builders:

| Function                           | Status | Description             |
| ---------------------------------- | ------ | ----------------------- |
| `badRequest(c, msg?, details?)`    | 400    | Bad request response    |
| `notFound(c, msg?, details?)`      | 404    | Not found response      |
| `forbidden(c, msg?, details?)`     | 403    | Forbidden response      |
| `internalError(c, msg?, details?)` | 500    | Internal error response |

## Dependencies

- `hono` -- HTTP framework (for middleware)

## Commands

```bash
cd takos && deno test --allow-all packages/common/src/
```
