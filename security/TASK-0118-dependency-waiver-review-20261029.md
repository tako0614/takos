# Bounded review of the expired docs development dependency waiver

Review date: 2026-10-29. Next review: **2026-11-05** (seven days).
Risk owner: the Takos documentation and build-toolchain maintainer.

The TASK-0118 PR portable gate failed only because the previously reviewed
VitePress waiver expired on 2026-10-28: 1,341 tests passed and the committed
review-window regression failed. This review changes only the two review dates
in `dependency-audit-waivers.json`. The four accepted advisory records, logical
occurrences, versions, dev-only restriction and production-unreachable scope
remain identical. No validator, expiry regression, dependency, lockfile or CI
toolchain is changed, and no additional advisory is accepted.

## Reachability and supported repair

`package.json` lists VitePress only in devDependencies. No source under `src`,
`containers` or `web` imports it. The docs deployment contract publishes only
`docs/.vitepress/dist` as prerendered static bytes to Pages, with no VitePress
or Vite development server: see [site and docs deployment](../docs/deploy/site-and-docs.md).
`docs:dev` remains a local development command; it must not be exposed as a
production service. The four retained findings concern development-server
behavior, and the Windows alternate-path condition has not become a static
production-serving path. This is a reachability conclusion from the repository
build/deploy contract, not a claim that the vulnerable tools are fixed.

Current primary-source registry readback confirms stable VitePress **1.6.4**
still declares Vite `^5.4.14`, and the newest Vite 5 is still **5.4.21**.
VitePress `next` is now **2.0.0-alpha.21**, not a stable dependency. Sources:
[VitePress metadata](https://registry.npmjs.org/vitepress/latest),
[Vite metadata](https://registry.npmjs.org/vite), and
[upstream releases](https://github.com/vuejs/vitepress/releases).
The installed docs subtree remains VitePress 1.6.4 / Vite 5.4.21 / esbuild 0.21.5.

CI still pins Bun 1.3.14 and a frozen lockfile. The previous owner review's
[scoped-override evidence](TASK-0020-vitepress-waiver-review.md#override-and-supported-toolchain-evidence)
shows this installer ignores a VitePress-only override and cannot read its
Bun 1.4 lockfile. A global override also changes the Web UI's separate Vite 8
graph. A toolchain migration or unsupported prerelease is therefore outside
this bounded CI repair. The existing review-window procedure permits at most
14 days; this review uses seven and keeps the fixed historical expiry tests.

## Live audit remains rejected

A fresh `bun audit --json` returned **97 findings across 21 packages**:
1 critical, 33 high, 52 moderate and 11 low. The new findings are not added to
the waiver. In particular, the existing Windows alternate-path advisory now
has a different registry id and moderate severity, and new Vite development
advisories exist. The exact-match validator must continue rejecting this
changed audit. Primary sources include
[updated Windows alternate-path advisory](https://github.com/advisories/GHSA-fx2h-pf6j-xcff)
and [new Windows launch-editor advisory](https://github.com/advisories/GHSA-587h-7wmj-h5pm).
This review preserves the old four exact accepted records rather than silently
accepting their changed metadata or the new records.

`bun run validate:dependency-security` **failed**, independently of the PR
portable gate. It rejected the audit mismatch, non-waived high/critical
findings, the changed high-advisory set, the expired review at the time of that
run, and duplicate physical occurrence paths in this worktree's shared-module
symlink layout. The actual logical waived subtree versions and paths remain
unchanged. No production sanitizer build/proof failure was reported. This
result is not converted to success and the standalone validator is unchanged.
A green portable gate therefore does not mean the repository is audit-clean.

## Verification and next action

- `docs:build` passed with the existing supported dependency graph.
- The dependency-security focused tests passed after renewal; the fixed
  historical expiry and advisory/scope expansion regressions remain intact.
- A structural comparison against the parent commit confirmed all JSON fields
  except `reviewedAt` and `reviewAfter` are identical.
- The expired-date CI failure and live-audit evidence are reported separately
  from the TASK-0118 authentication changes and portable CI result.

By **2026-11-05**, the risk owner must recheck stable upstream, the supported
Bun toolchain, docs build and development/HMR compatibility. Remove the waiver
when a patched stable graph or reviewed scoped override is supported. New and
changed advisories require separate dependency remediation; this renewal does
not approve them. No deployment, live credential operation or provider/DB
mutation was performed.
