---
task: TASK-0020
slice: VitePress dev-only dependency waiver review
reviewedAt: 2026-10-14
reviewAfter: 2026-10-28
repos:
  - takos
requiredFor:
  - security_or_authority
grantsMutationAuthority: false
---

# VitePress waiver review

This is the Takos-local evidence for the dependency slice of
`takos-control/tasks/TASK-0020-takos-quality-hardening.md`. The canonical task
records a 2026-08-23 deadline; the repository waiver still contained
2026-08-05. Both deadlines had expired. Only this Takos worktree is changed;
the canonical ledger and sibling repositories are not edited.

## Decision

Retain the four exact VitePress-owned Vite/esbuild advisories, reviewed on
2026-10-14 with the next review due 2026-10-28. The dependency versions,
logical package paths, dev-only restriction, production-unreachable claim,
and advisory identities remain unchanged. This renewal does not accept
any other audit findings.

The current stable VitePress release is still **1.6.4**, whose Vite dependency
is `^5.4.14`. The newest published Vite 5 is **5.4.21**, which uses
esbuild `^0.21.3` and leaves the waived graph vulnerable. The `next` VitePress
tag is **2.0.0-alpha.20**, not a stable dependency. These were checked against
the [VitePress registry](https://registry.npmjs.org/vitepress/latest) and
[Vite registry](https://registry.npmjs.org/vite) on the review date.

Vite's current latest stable is **8.3.4** and esbuild's is **0.28.2**. For
the VitePress override candidate, the stable **Vite 6.4.4** line is closer
to the declared dependency and uses esbuild `^0.25.0`. The installed
`@vitejs/plugin-vue@5.2.4` declares Vite `^5.0.0 || ^6.0.0` compatibility.
Sources: [Vite 6.4.4](https://registry.npmjs.org/vite/6.4.4),
[esbuild latest](https://registry.npmjs.org/esbuild/latest),
[plugin-vue 5.2.4](https://registry.npmjs.org/@vitejs%2fplugin-vue/5.2.4).

The four waived advisories require esbuild newer than 0.24.2 and Vite newer
than 6.4.2. Thus Vite 6.4.4 with esbuild 0.25.12 clears these four findings.
Sources: [esbuild development server](https://github.com/advisories/GHSA-67mh-4wv8-2f99),
[Vite optimized-deps maps](https://github.com/advisories/GHSA-4w7w-66w2-5vf9),
[UNC handling](https://github.com/advisories/GHSA-v6wh-96g9-6wx3), and
[Windows alternate paths](https://github.com/advisories/GHSA-fx2h-pf6j-xcff).
An esbuild-only override cannot clear the three Vite advisories.

## Override and supported toolchain evidence

The CI owner gate in `.github/workflows/release-artifacts.yml` pins Bun
**1.3.14** and installs with `--frozen-lockfile`. Scoped overrides were
introduced in [Bun 1.4](https://bun.sh/blog/bun-v1.4); the
[override documentation](https://bun.com/docs/pm/overrides) says they write
lockfile version 3, which older Bun versions cannot read.

Isolated `/tmp` probes used exact dev dependencies `vite: 8.1.5` and
`vitepress: 1.6.4`, with `bun install --ignore-scripts`. They did not modify
the repository manifest, lockfile, installed dependencies, or other worktrees.

| Override | Installer | Root Vite | VitePress Vite | Its esbuild | Lockfile version |
| --- | --- | --- | --- | --- | --- |
| `vitepress>vite: 6.4.4` | Bun 1.4.2 | 8.1.5 | 6.4.4 | 0.25.12 | 3 |
| `vitepress>vite: 6.4.4` | Bun 1.3.14 | 8.1.5 | 5.4.21 | 0.21.5 | 1 |
| `vite: 6.4.4` | Bun 1.3.14 | 6.4.4 | 6.4.4 | 0.25.12 | 1 |

Running Bun 1.3.14 with `install --frozen-lockfile --ignore-scripts` on the
version-3 scoped-override probe exited 1 with `UnknownLockfileVersion` and
`lockfile had changes, but lockfile is frozen`. The old installer silently
ignores the parent-scoped rule when resolving a fresh manifest. The global
override applies, but downgrades the Web UI's Vite 8 as well.

Consequently there is no supported scoped override on the current CI
toolchain. Adopting it requires a deliberate Bun toolchain upgrade. It also
requires VitePress compatibility validation beyond installation: upstream's
[Vite 6 upgrade](https://github.com/vuejs/vitepress/pull/4504) changed the
data-loader HMR implementation and tests, while VitePress 1.6.4 does not
declare Vite 6 support. A maintainer's tentative compatibility comment in
[discussion 5072](https://github.com/vuejs/vitepress/discussions/5072) is useful
evidence, but does not replace those checks. This slice renews the waiver
instead of changing the release toolchain or the Web UI build tool.

## Validation and residual findings

- Regression first: the new repository-waiver test failed on the expired
  2026-08-05 deadline; the calendar-date regression showed that the previous
  validator accepted `2026-02-30`.
- The validator now rejects impossible calendar dates, future review dates,
  reversed windows, and windows longer than 14 days. The deadline remains
  inclusive, and the following day fails closed. The test reads the actual
  repository waiver as well as a fixed historical expiry fixture.
- Dependency-security tests: **4 pass, 0 fail, 16 assertions**.
- `bun run docs:build`: **pass** with the existing supported dependency graph.
- `bun run validate:dependency-security`: **fail (exit 1)** on the 58
  non-waived findings below. The prior expired-review error is gone; the
  exact-audit and high/critical rejection remains intact. The production
  sanitizer build/proof and the VitePress occurrence/scope checks passed.
- `bun run check`: **pass (exit 0)** after the small CTA regression repair,
  with **1,305 pass, 0 fail, 6,320 assertions across 225 files**. Format,
  migration projections/safety, website release-ref generation, queue
  topology, runtime-secret declarations, lint, full root/Web types,
  OpenTofu secret policy, all 20 OpenTofu tests, architecture validation,
  and the final Web/Worker production builds passed.
- The predecessor reproduced **1,304 pass, 1 fail, 6,314 assertions** at
  `the repository source and website CTA use one exact Takos release`.
  HEAD expected one single-line OpenTofu plan command, while the existing
  `website/src/components/InstallCTA.tsx` renders shell line continuations.
  The repaired assertion requires all three command fragments in order;
  the release-identity and installation-sequence checks remain intact.
  The focused dependency/manifest suite passes **13 tests / 174 assertions**.
- `bun run validate:current-docs`: **pass** after aligning one line of
  `docs/deploy/rollback.md` with the validator's required data-boundary
  wording. The rollback guarantee is unchanged; the previous Japanese
  conjunction was a literal-marker mismatch already present at HEAD.
- `bun run validate:api-docs`: **pass** (16 required markers).
- `bun run validate:patch-management`: **pass** for both Dockerfiles;
  the optional sibling-private runbook check explicitly reports unavailable
  in this isolated worktree and is not claimed as verified.

The baseline live audit returned **62 findings across 19 packages**:
2 critical, 23 high, 31 moderate, and 6 low. Four are the existing waiver;
the other **58**, including 2 critical and 22 high findings, are not accepted
by this renewal. They include packages outside VitePress's Vite/esbuild
subtree. A differential check of the HEAD and candidate audit validators
against the same live audit returned three identical rejection errors.
The manifest and lockfile are unchanged. The dependency validator already
rejected these findings before this change, separately from the expired
date. They require their own
dependency-remediation slice; this review does not claim an audit-clean
repository.

The predecessor's read-only review found no advisory or occurrence-scope
expansion and recorded the upstream/toolchain probes. Its local logs were
in `/tmp/takos-TASK-0020-docs-build-final.log`,
`/tmp/takos-TASK-0020-security-final.log`,
`/tmp/takos-TASK-0020-check-final.log`, and
`/tmp/takos-TASK-0020-existing-gate-failure.log`. The takeover independently
rechecked the registry metadata, unchanged audit rejection, scope, docs
build, and complete gate. Its command logs are
`/tmp/TASK-0020-check.log`, `/tmp/TASK-0020-docs-build.log`,
`/tmp/TASK-0020-dependency-security.log`, and `/tmp/TASK-0020-audit.json`.
The original four uncommitted files were copied to
`/tmp/TASK-0020-handoff-kj2wa5xx` before edits. These are local evidence,
not repository artifacts. PR/CI and staging results are reported with the
PR. This slice does not authorize production deployment, credential
changes, data destruction, or modifications to another worktree.

The current `bun run check` invokes the dependency-security regression via
the portable test runner, but does not invoke the live dependency validator.
The standalone validator result must therefore be reported separately from
the owner gate. The added regression ensures the committed waiver cannot
expire silently even when only the owner gate is run.

## Next review

By 2026-10-28, recheck stable VitePress and the supported Bun toolchain.
Remove the waiver when a stable release accepts a patched Vite/esbuild
graph, or when a reviewed scoped override passes frozen installation,
`docs:build`, and development/data-loader HMR checks on the supported
toolchain while retaining the Web UI's Vite 8. Any new advisory or changed
logical occurrence remains a validation failure.
