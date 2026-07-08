# Legal: License Compliance

> このページでわかること: Takos / Takosumi ecosystem の first-party
> license inventory、REUSE / SPDX baseline、third-party inventory の更新ルール。

This page is the release-facing compliance artifact. The canonical policy is
`docs/reference/license-policy.md` in the ecosystem root: network services and
control planes use `AGPL-3.0-only`, yurucommu family packages and deployable
network products also use `AGPL-3.0-only`, GPL-dependent apps use
`GPL-3.0-only`, reusable SDKs/contracts/providers/examples/static site code use
`MIT`, and closed/operator-private state uses `UNLICENSED` or no OSS `LICENSE`.

## First-party License Inventory

| Repo or package              | License         | Evidence                                                                         |
| ---------------------------- | --------------- | -------------------------------------------------------------------------------- |
| `takos-ecosystem` root       | `AGPL-3.0-only` | `LICENSE`, `.reuse/dep5`, root package metadata; development/governance checkout |
| `takos/`                     | `AGPL-3.0-only` | `takos/LICENSE`, `takos/.reuse/dep5`, npm / Cargo metadata                       |
| `takos/containers/agent/`    | `AGPL-3.0-only` | nested `LICENSE`, `.reuse/dep5`, Cargo package metadata                          |
| `takosumi/`                  | `AGPL-3.0-only` | `takosumi/LICENSE`, `.reuse/dep5`, service/dashboard/docs/site package metadata  |
| `takosumi/accounts/contract` | `MIT`           | package metadata and `takosumi/.reuse/dep5` stanza                               |
| `takosumi/cli`               | `MIT`           | package metadata and `takosumi/.reuse/dep5` stanza                               |
| `takosumi/mobile-kit`        | `MIT`           | package metadata and `takosumi/.reuse/dep5` stanza                               |
| `takosumi/provider`          | `MIT`           | `provider/LICENSE` and `takosumi/.reuse/dep5` stanza                             |
| `takosumi/examples/*`        | `MIT`           | package metadata and `takosumi/.reuse/dep5` stanza                               |
| `takosumi-cloud/`            | `UNLICENSED`    | private package metadata; no OSS `LICENSE` in the public checkout                |
| `takosumi-private/`          | no OSS license  | operator state only; realized config and secrets evidence remain private         |
| `takos-agent-engine/`        | `MIT`           | `LICENSE`, `.reuse/dep5`, Cargo package metadata                                 |
| `takos-apps/takos-computer/` | `MIT`           | `LICENSE`, `.reuse/dep5`, npm package metadata                                   |
| `takos-apps/takos-office/`   | `GPL-3.0-only`  | `LICENSE`, `.reuse/dep5`, npm metadata; aligned with GPL dependency posture      |
| `road-to-me/`                | `AGPL-3.0-only` | `LICENSE`, `.reuse/dep5`, npm / Cargo metadata                                   |
| `yurucommu-core/`            | `AGPL-3.0-only` | `LICENSE`, `.reuse/dep5`, core package metadata                                  |
| `@takosjp/yurucommu-api`     | `AGPL-3.0-only` | `packages/api/LICENSE`, package metadata                                         |
| `yurucommu/`                 | `AGPL-3.0-only` | `LICENSE`, `.reuse/dep5`, npm metadata                                           |
| `yurumeet/`                  | `AGPL-3.0-only` | `LICENSE`, `.reuse/dep5`, npm metadata                                           |
| `takos.jp/`                  | `MIT`           | `LICENSE`, `.reuse/dep5`, npm package metadata                                   |
| `zenn/`                      | `MIT`           | `LICENSE`, `.reuse/dep5`, package and lockfile metadata                          |

## REUSE / SPDX Baseline

Every public repo in the ecosystem must carry:

- root `LICENSE`
- root `.reuse/dep5` with `Files: *` and the repo default SPDX license id
- package metadata license fields for npm / Cargo packages that are published,
  built, copied, or distributed

Repos with mixed license surfaces keep a default repo license and add narrower
`.reuse/dep5` stanzas. Today that applies to:

- `takosumi/`: default `AGPL-3.0-only`; public contracts, CLI, mobile kit,
  provider, and examples are `MIT`
- Yurucommu family packages: `yurucommu-core`, `@takosjp/yurucommu-api`,
  `yurucommu`, and `yurumeet` are all `AGPL-3.0-only`

Closed packages use `UNLICENSED` in package metadata and do not publish an OSS
`LICENSE` file unless legal review creates an explicit source-available or
commercial license.

## Third-party Inventory

The third-party inventory is published at
`/legal/third-party-license-inventory`. Release owners update it whenever
lockfiles change in a way that adds a new license family, introduces copyleft /
source-available terms, or changes a direct dependency with a known
commercial-license option.

## Release Gate

Run from the ecosystem root:

```sh
bun run check:license-compliance
```

The gate validates:

- public repo `LICENSE` files match the approved first-party license inventory
- `.reuse/dep5` exists and names each expected SPDX license id
- npm / Cargo manifests declare the expected license
- lockfiles with root package license metadata do not contradict package
  metadata
- `takosumi-cloud/` stays `UNLICENSED` and does not publish an OSS `LICENSE`
- `takosumi-private/` remains private and does not publish an OSS `LICENSE`
- legal docs include the first-party and third-party inventory artifacts

## Exceptions

License exceptions require an owner, reason, expiry, and legal review record.
The exception record must name the package, version, license, affected product,
runtime or build-time usage, and whether source distribution obligations apply.
