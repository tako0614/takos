# Local Shell Runbook

This runbook starts the Takos product shell from a fresh checkout.

## 1. Initialize Submodules

```sh
git submodule update --init --recursive
```

or:

```sh
deno task submodules:update
```

## 2. Run Doctor

```sh
deno task doctor
```

Use strict mode for automation:

```sh
deno task check
```

Doctor verifies required tools, submodule initialization, the local compose service set, expected ports, internal URL
environment, and forbidden shell-level deploy/runtime service names.

## 3. Inspect Compose

```sh
deno task local:config
```

By default this reads `.env.local.example`. Override with:

```sh
TAKOS_LOCAL_ENV_FILE=.env.local deno task local:config
```

## 4. Start and Stop

```sh
deno task local:up
deno task local:logs
deno task local:down
```

The shell starts `takos-app`, `takos-paas`, `takos-git`, `takos-agent`, Postgres, and Redis. Product implementation
changes still happen inside each product root.

## Product Root Commands

Use each submodule for product-specific checks:

- `cd app && deno task ...`
- `cd paas && deno task ...`
- `cd git && deno task ...`
- `cd agent && cargo ...`
