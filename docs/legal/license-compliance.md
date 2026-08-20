# Legal: License Compliance

> このページでわかること: Takos / Takosumi ecosystem の first-party
> license inventory、REUSE / SPDX baseline、third-party inventory の更新ルール。

This page is license evidence consumed by product checks and the deploy
entrypoint's owner gate; it is not deploy authority. The canonical policy is
`docs/reference/license-policy.md` in the ecosystem root: network services and
control planes use `AGPL-3.0-only`, yurucommu family packages and deployable
network products also use `AGPL-3.0-only`, GPL-dependent apps use
`GPL-3.0-only`, reusable SDKs/contracts/providers/examples/static site code use
`MIT`, Takoserver explicitly uses `AGPL-3.0-or-later`, and
closed/operator-private state uses `UNLICENSED` or no OSS `LICENSE`.

## First-party License Inventory

| Repo or package              | License         | Evidence                                                                         |
| ---------------------------- | --------------- | -------------------------------------------------------------------------------- |
| `takos-ecosystem` root       | `AGPL-3.0-only` | `LICENSE`, `.reuse/dep5`, root package metadata; development/governance checkout |
| `takos/`                     | `AGPL-3.0-only` | `takos/LICENSE`, `takos/.reuse/dep5`, npm / Cargo metadata                       |
| `takos/containers/agent/`    | `AGPL-3.0-only` | nested `LICENSE`, `.reuse/dep5`, Cargo package metadata                          |
| `takosumi/`                  | `AGPL-3.0-only` | `takosumi/LICENSE`, `.reuse/dep5`, service/dashboard/docs/site package metadata  |
| `takosumi/accounts/contract` | `MIT`           | package metadata and `takosumi/.reuse/dep5` stanza                               |
| `takosumi/cli`               | `MIT`           | package metadata and `takosumi/.reuse/dep5` stanza                               |
| `mobile-kit/`                | `MIT`           | sibling repo `LICENSE`, `.reuse/dep5`, and package metadata                       |
| `takosumi/provider`          | `MIT`           | `provider/LICENSE` and `takosumi/.reuse/dep5` stanza                             |
| `takosumi/examples/*`        | `MIT`           | package metadata and `takosumi/.reuse/dep5` stanza                               |
| `takoserver/`                | `AGPL-3.0-or-later` | public control plane `LICENSE`, `.reuse/dep5`, and package metadata           |
| `takoserver-private/`        | no OSS license  | provider accounts and supply composition remain private                           |
| `takosumi-hosted/`           | `UNLICENSED`    | Hosted marketplace and broker package metadata; no OSS `LICENSE`                 |
| `takosumi-cloud/`            | archived        | historical closed delta with no active runtime authority                          |
| `takosumi-private/`          | no OSS license  | operator state only; realized config and secrets evidence remain private         |
| `takos-agent-engine/`        | `MIT`           | `LICENSE`, `.reuse/dep5`, Cargo package metadata                                 |
| `takos-computer/`            | `MIT`           | sibling repo `LICENSE`, `.reuse/dep5`, npm package metadata                       |
| `takos-office/`              | `GPL-3.0-only`  | sibling repo `LICENSE`, `.reuse/dep5`, npm metadata; aligned with GPL dependencies |
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

- `takosumi/`: default `AGPL-3.0-only`; public contracts, CLI,
  provider, and examples are `MIT`
- `mobile-kit/`: independent `MIT` sibling shared by the four mobile shells
- Yurucommu family packages: `yurucommu-core`, `@takosjp/yurucommu-api`,
  `yurucommu`, and `yurumeet` are all `AGPL-3.0-only`

Closed packages use `UNLICENSED` in package metadata and do not publish an OSS
`LICENSE` file unless legal review creates an explicit source-available or
commercial license.

## Third-party Inventory

The third-party inventory is published at
`/legal/third-party-license-inventory`. The owning repository updates it in the
same dependency-changing change whenever a lockfile adds a new license family,
introduces copyleft / source-available terms, or changes a direct dependency
with a known commercial-license option.

## Candidate Evidence Check

Run the portable owner gate from the Takos root:

```sh
cd takos
bun run check
```

Cross-repository license changes also run the `takos-control` workspace gate.
The deploy entrypoint's owner gate consumes the resulting issuer-bound evidence; the
check itself does not authorize promotion. The validation covers:

- public repo `LICENSE` files match the approved first-party license inventory
- `.reuse/dep5` exists and names each expected SPDX license id
- npm / Cargo manifests declare the expected license
- lockfiles with root package license metadata do not contradict package
  metadata
- `takosumi-hosted/` stays `UNLICENSED` and does not publish an OSS `LICENSE`
- `takoserver-private/` and `takosumi-private/` do not publish an OSS `LICENSE`
- archived `takosumi-cloud/` is not required as an active checkout
- `takosumi-private/` remains private and does not publish an OSS `LICENSE`
- legal docs include the first-party and third-party inventory artifacts

## Exceptions

License exceptions require an owner, reason, expiry, and legal review record.
The exception record must name the package, version, license, affected product,
runtime or build-time usage, and whether source distribution obligations apply.
