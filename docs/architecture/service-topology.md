# Service Topology

`takos` は product shell です。実装は `app/`、`git/`、`agent/` の各 submodule と、 sibling
repository の `../takosumi/` が持ち、この shell はローカル起動、境界検証、全体 docs を持ちます。

## Local Services

| Service       |    Port | Owner         | Responsibility                                                                                          |
| ------------- | ------: | ------------- | ------------------------------------------------------------------------------------------------------- |
| `takos-app`   |  `8787` | `app/`        | account、auth、profile、billing、public/browser/CLI API gateway                                         |
| `takosumi`  |  `8788` | `../takosumi/` | tenant/platform management、deploy/runtime lifecycle、routing、entitlement、canonical agent-control RPC |
| `takos-agent` |  `8789` | `agent/`      | agent execution service。Takosumi-owned `/api/internal/v1/agent-control/*` を呼ぶ                       |
| `takos-git`   |  `8790` | `git/`        | Git hosting、Smart HTTP、refs、objects、source resolution                                               |
| `postgres`    | `15432` | shell compose | local persistence for app、Takosumi、Git                                                                |
| `redis`       | `16379` | shell compose | local queue/cache backing for Takosumi                                                                  |

## Internal Calls

- Browser and CLI traffic enters through `takos-app`.
- `takos-app` calls `takosumi` and `takos-git` with the canonical
  `takosumi-contract/internal-rpc` envelope, actor context, caller/audience,
  and route capabilities.
- Git Smart HTTP is public at `takos-app`; `takos-git` only accepts signed
  internal Smart HTTP requests.
- `takos-agent` calls `takosumi` through the canonical
  `/api/internal/v1/agent-control/*` control surface and can read Git internal
  endpoints when needed.
- `takos-app` may remain a backend or compatibility bridge for app-owned data,
  but it does not own the canonical agent-control RPC surface.
- Local service discovery falls back to `TAKOSUMI_INTERNAL_URL`,
  `TAKOS_GIT_INTERNAL_URL`, and `TAKOS_AGENT_INTERNAL_URL`.
- Internal services share `TAKOS_INTERNAL_SERVICE_SECRET` only in local compose;
  the app trusted-proxy edge also gets `TAKOS_INTERNAL_API_SECRET`, and
  Takosumi receives the same value as `TAKOSUMI_INTERNAL_API_SECRET`.

## Boundary Rules

- Deploy and runtime lifecycle semantics are canonical in the sibling Takosumi kernel.
- Shell compose must not introduce standalone deploy or runtime services.
- `takos-private` owns production and staging deploy configuration; this shell
  only models local composition.
- Shared behavior must remain service-local unless it becomes a named domain
  library with a clear owner.
