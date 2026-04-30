# PaaS in-process smoke script

`./scripts/paas-smoke.ts` is a no-server, no-Docker smoke check for the Takos
PaaS manifest lifecycle.

It exercises the current app/service modules in-process:

- registers the public route handlers against a tiny local route harness;
- creates a space and app group through the public handlers;
- plans and applies a simple manifest with the deploy services;
- runs the noop runtime vertical slice from the resulting activation;
- prints a JSON summary suitable for CLI/HTTP smoke inspection.

Default command:

```sh
deno run --no-config --allow-read --allow-env scripts/paas-smoke.ts
```

The script intentionally avoids starting servers, Docker, and external services
by default.
