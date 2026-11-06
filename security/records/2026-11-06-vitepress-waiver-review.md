# VitePress dependency review, 2026-11-06

This is a fresh seven-day review of Takos's existing four exact VitePress-owned
development-tool records. The review runs from 2026-11-06 through 2026-11-13.
The current live dependency audit remains **RED: 97 findings**; this record
does not accept those findings or qualify the product for deployment.

The installed graph is still VitePress 1.6.4, its Vite 5.4.21, and that Vite's
esbuild 0.21.5. The [official stable registry entry](https://registry.npmjs.org/vitepress/latest)
still declares VitePress 1.6.4 with Vite `^5.4.14`; the `next` tag is
2.0.0-alpha.21. The [latest upstream release](https://github.com/vuejs/vitepress/releases/tag/v2.0.0-alpha.21)
is an alpha. The stable-upstream removal condition has not been met.

The four upstream advisory pages still cover the installed versions:

- [esbuild development-server disclosure](https://github.com/advisories/GHSA-67mh-4wv8-2f99).
- [Vite optimized-dependency map traversal](https://github.com/advisories/GHSA-4w7w-66w2-5vf9).
- [launch-editor UNC handling](https://github.com/advisories/GHSA-v6wh-96g9-6wx3).
- [Vite Windows alternate paths](https://github.com/advisories/GHSA-fx2h-pf6j-xcff).

The last page now labels the advisory Moderate. The committed record retains
its conservative High classification and exact old identity; its severity,
advisory set and occurrence paths have not been relaxed. Both Bun 1.3.14 and
1.4.2 audits returned 97 findings: 1 critical, 33 high, 52 moderate and 11 low
across 21 packages. Only three of the four legacy numeric advisory IDs appear
in those responses; the last advisory's URL now appears as ID 1243432 with
Moderate severity, rather than the retained ID 1123525/High. The committed
four-record snapshot is not represented as matching the live audit. Changed
audit metadata does not prove that the installed nested Vite is patched. The
installed version and upstream affected range remain the basis for retaining
that conservative record.

The exact-audit validator still rejects these current responses: their
unwaived findings, changed snapshot and high/critical findings have not been
accepted. Runtime reachability of the other findings is not established by
this review. In particular, the DOMPurify critical finding remains unresolved
and is not part of the VitePress waiver. A green portable check is separate
from the live audit and deployment readiness.

VitePress remains a development dependency. The production/static-serving
boundary and the prohibition on publishing its development server are
unchanged. The existing Bun 1.3.14 workflow pin, package manifest, lockfile,
logical package occurrences, validation code and all rejection rules are
unchanged. The earlier supported-toolchain/scoped-override evidence in
[the owning review](../TASK-0020-vitepress-waiver-review.md) is retained as
historical evidence; no new override installation, HMR or data-loader
compatibility result is claimed here.

The existing static documentation build passed on the workflow-pinned Bun
1.3.14 before this metadata change. The fresh independent review is limited
to keeping the same exact development-only exception for seven more days.
The former expired-date CI result remains a failure in its original evidence.
Only the two review dates change in the waiver JSON. Any new advisory or
occurrence still fails closed; the changed source requires its own checks.

No dependencies, deployment, provider resources, credentials, authentication,
database state or publication authority were changed by this review.
