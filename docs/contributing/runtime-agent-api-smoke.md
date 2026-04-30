# Runtime agent API smoke script

`scripts/runtime-agent-api-smoke.ts` is a no-external-server smoke entrypoint
for runtime agent API wiring.

## Run

```sh
deno run --config deno.json scripts/runtime-agent-api-smoke.ts
```

The script builds the Hono API in-process with `createApiApp`, disables default
internal/public routes, and mounts runtime agent routes via
`registerRuntimeAgentRoutes` backed by `InMemoryRuntimeAgentRegistry`.

## Coverage

The smoke verifies the runtime agent lifecycle without opening a socket:

- enroll a local runtime agent through the API
- send a heartbeat through the API
- enqueue one work item directly in the in-memory registry
- lease that work through the API
- report the lease as completed through the API
- request drain through the API
- confirm a draining agent receives no additional lease

## Expected output

A successful run prints:

- `Runtime agent API smoke passed.`
- agent id
- work id
- lease id
- lifecycle flow summary
