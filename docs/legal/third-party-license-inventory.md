# Legal: Third-party Dependency Inventory

> このページでわかること: Takosumi / Takos ecosystem の third-party dependency inventory
> source、observed license families、review-required packages。

This inventory is generated from committed lockfiles plus local package metadata
observed during the 2026-05-07 license review. Lockfiles remain the source of
truth for dependency identity; package manager metadata is the source for
license strings where available.

## Lockfile Sources

| Lockfile                              | npm packages | JSR packages | remote modules |
| ------------------------------------- | -----------: | -----------: | -------------: |
| `deno.lock`                           |          177 |            5 |             27 |
| `takos/app/deno.lock`                 |          676 |            7 |              0 |
| `takos/git/deno.lock`                 |            2 |            1 |              0 |
| `takosumi/deno.lock`                  |           16 |           12 |              0 |
| `takosumi/deno.lock`              |            0 |            5 |              0 |
| `takos-cli/deno.lock`                 |            4 |            4 |              0 |
| `takos-apps/takos-computer/deno.lock` |          333 |            2 |              0 |
| `takos-apps/takos-docs/deno.lock`     |          356 |            2 |              0 |
| `takos-apps/takos-slide/deno.lock`    |          302 |            2 |              0 |
| `takos-apps/takos-excel/deno.lock`    |          286 |            2 |              0 |
| `yurucommu/deno.lock`                 |          452 |           12 |              9 |
| `road-to-me/backend/deno.lock`        |          316 |            2 |              0 |
| `road-to-me/app/deno.lock`            |          598 |            3 |              0 |
| `takos-private/deno.lock`             |          700 |            3 |              0 |
| `takos/agent/Cargo.lock`              |  Rust crates |          n/a |            n/a |
| `takos-agent-engine/Cargo.lock`       |  Rust crates |          n/a |            n/a |

`takos/app/deno.lock` is canonical for the Takos app/API package; the `takos/`
shell repo itself does not ship a top-level `deno.lock`, and the ecosystem root
CI must not require one unless the shell starts installing dependencies
directly.

## Observed npm License Families

Local `node_modules` package metadata observed 2,407 npm package instances
during the 2026-05-07 review.

| License family                            |    Observed package instances | Handling                                   |
| ----------------------------------------- | ----------------------------: | ------------------------------------------ |
| `MIT`                                     |                         1,663 | allowed                                    |
| `Apache-2.0`                              |                           523 | allowed                                    |
| `ISC`                                     |                            65 | allowed                                    |
| `BSD-3-Clause`                            |                            36 | allowed                                    |
| `BSD-2-Clause`                            |                            26 | allowed                                    |
| `MIT OR Apache-2.0` / `Apache-2.0 OR MIT` |                            29 | choose permissive option                   |
| `BlueOak-1.0.0`                           |                            13 | allowed                                    |
| `MPL-2.0`                                 |                             9 | allowed with file-level copyleft awareness |
| `CC-BY-4.0` / `CC0-1.0`                   |                            13 | allowed for data / metadata assets         |
| `Unlicense` / `0BSD`                      |                             6 | allowed                                    |
| `LGPL-3.0-or-later`                       | 4 unique native package names | review required; see below                 |
| `GPL-3.0-only`                            |       1 unique direct package | product license aligned; see below         |

## Review-required Packages

| Package                                                             | License                                  | Affected product                                               | Decision                                                                                                                                            |
| ------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Hyperformula` / `hyperformula@2.7.1`                               | `GPL-3.0-only` with commercial option    | `takos-apps/takos-excel`                                       | `takos-excel` is licensed `GPL-3.0-only` and uses `licenseKey: "gpl-v3"`. A commercial license is required before relicensing the app permissively. |
| `@img/sharp-libvips-linux-x64` / `@img/sharp-libvips-linuxmusl-x64` | `LGPL-3.0-or-later`                      | image processing / build pipelines that use `sharp`            | Allowed only as dynamically linked native dependency. Static linking or redistribution changes require review.                                      |
| `jszip@3.10.1`                                                      | `MIT OR GPL-3.0-or-later`                | archive handling transitive dependency                         | Use MIT option.                                                                                                                                     |
| `expand-template@2.0.3`                                             | `MIT OR WTFPL`                           | native package install helper transitive dependency            | Use MIT option.                                                                                                                                     |
| `@prisma/studio-core-licensed`                                      | `UNLICENSED` package metadata            | local development tooling in `road-to-me/backend` node_modules | Do not ship Prisma Studio artifacts in product bundles without separate review.                                                                     |
| `seq-queue@0.0.5`                                                   | missing license metadata in package.json | MySQL transitive dependency                                    | Review package license before introducing it as a direct production dependency.                                                                     |

## Update Rule

When a lockfile changes, the release owner must:

1. identify added direct dependencies and their licenses
2. review new copyleft, source-available, unknown, or unlicensed metadata
3. update this inventory if a new license family or review-required package
   appears
4. keep first-party package license metadata aligned with direct copyleft
   dependencies
5. rerun `deno task check:license-compliance` from the ecosystem root
