# Legal: License Compliance

> このページでわかること: Takosumi / Takos ecosystem の first-party license
> inventory、 REUSE / SPDX baseline、third-party license inventory
> の更新ルール。

This page is a compliance artifact for GA readiness. It documents the
first-party license posture and the release gate that prevents license metadata
drift across the ecosystem checkout.

## First-party License Inventory

| Repo                         | License               | Evidence                                                                        |
| ---------------------------- | --------------------- | ------------------------------------------------------------------------------- |
| `takos-ecosystem` root       | `AGPL-3.0-only`       | `LICENSE`, `.reuse/dep5`                                                        |
| `takos/` shell               | `AGPL-3.0-only`       | `takos/LICENSE`, `takos/.reuse/dep5`                                            |
| `takos/`                 | `AGPL-3.0-only`       | `LICENSE`, `.reuse/dep5`, npm package metadata                           |
| `takos/containers/git/`                 | `AGPL-3.0-only`       | `LICENSE`, `.reuse/dep5`, npm package metadata                                 |
| `takos/containers/agent/`               | `AGPL-3.0-only`       | `LICENSE`, `.reuse/dep5`, Cargo package metadata                                |
| `takosumi/`                  | `AGPL-3.0-only`       | `LICENSE`, `.reuse/dep5`, npm package metadata                                  |
| `takos-agent-engine/`        | `MIT`                 | `LICENSE`, `.reuse/dep5`, Cargo package metadata                                |
| `takos-apps/takos-computer/` | `MIT`                 | `LICENSE`, `.reuse/dep5`, npm package metadata                                 |
| `takos-apps/takos-docs/`     | `MIT`                 | `LICENSE`, `.reuse/dep5`, npm metadata                                         |
| `takos-apps/takos-slide/`    | `MIT`                 | `LICENSE`, `.reuse/dep5`, npm metadata                                         |
| `takos-apps/takos-excel/`    | `GPL-3.0-only`        | `LICENSE`, `.reuse/dep5`, npm metadata; aligns with HyperFormula GPLv3 use     |
| `yurucommu/`                 | `GPL-3.0-only`        | `LICENSE`, `.reuse/dep5`, npm metadata                                         |
| `road-to-me/`                | `AGPL-3.0-only`       | `LICENSE`, `.reuse/dep5`, npm / Cargo metadata                                 |
| `takos-private/`             | private / unpublished | no public OSS license; deploy configuration and secrets evidence remain private |

## REUSE / SPDX Baseline

Every public repo in the ecosystem must carry:

- root `LICENSE`
- root `.reuse/dep5` with `Files: *` and the repo SPDX license id
- package metadata license fields for npm / Cargo packages that are
  published, built, or distributed

New source files should keep using repo-wide `.reuse/dep5` unless a file has a
different license or third-party origin. Files with a different license must add
file-level SPDX headers or a narrower `.reuse/dep5` stanza before merge.

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
- `.reuse/dep5` exists and names the expected SPDX license id
- npm / Cargo manifests declare the expected license
- `takos-private/` remains private and does not publish an OSS license from the
  public tree without legal review
- legal docs include the first-party and third-party inventory artifacts

## Exceptions

License exceptions require an owner, reason, expiry, and legal review record.
The exception record must name the package, version, license, affected product,
runtime or build-time usage, and whether source distribution obligations apply.
