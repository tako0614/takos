# Router config smoke script

`scripts/router-config-smoke.ts` is a no-external-services smoke entrypoint for
router config rendering and adapter persistence.

## Run

```sh
deno run --config deno.json --allow-read --allow-write scripts/router-config-smoke.ts
```

The script constructs a sample `RouteProjection`, applies it through both
`InMemoryRouterConfigAdapter` and `FileRouterConfigAdapter`, writes the file
adapter output to a temporary JSON file, verifies the rendered content matches
between adapters and the file, prints a summary, and removes the temporary
directory on exit.

## Expected output

A successful run prints:

- `Router config smoke passed.`
- projection id
- route count
- memory and file adapter apply timestamps
- temporary config path used during the smoke
