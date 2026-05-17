# P0 local-substrate readiness evidence (FIXTURE)

**This is NOT a real launch evidence document.** It exists solely as a deterministic file whose SHA-256 the
local-substrate test bed can hash into `TAKOSUMI_ACCOUNTS_MANAGED_OFFERING_READINESS_DIGEST` so the managed-offering
policy gate accepts the local worker as "approved" for testing purposes. Real launches use evidence documents tracked in
`takos-private/docs/launch-readiness/`, signed off by a human reviewer, and pinned via commit SHA — not by mutable file
hash.

## What this file replaces

Before this file existed, the local-substrate set:

```
TAKOSUMI_ACCOUNTS_MANAGED_OFFERING_READINESS_DIGEST=\
    sha256(b"local-substrate-readiness-v1")
```

That string was hard-coded in two places (env file + a comment) and did not correspond to anything reviewable. The
digest was "evidence" in name only.

## What the local-substrate uses this for

The cloud worker's managed-offering policy
(`takosumi-cloud/deploy/cloudflare/src/handler.ts::parseManagedOfferingAccess`) expects:

| env var                                               | meaning                                                   |
| ----------------------------------------------------- | --------------------------------------------------------- |
| `TAKOSUMI_ACCOUNTS_MANAGED_OFFERING_ACCESS`           | `open` / `closed` access status users see at sign-in time |
| `TAKOSUMI_ACCOUNTS_MANAGED_OFFERING_READINESS_DIGEST` | sha256 of the evidence file the operator reviewed         |
| `TAKOSUMI_ACCOUNTS_MANAGED_OFFERING_EVIDENCE_REF`     | `git+<repo>#<path>` pointer to the evidence file          |
| `TAKOSUMI_ACCOUNTS_MANAGED_OFFERING_APPROVAL_REF`     | `git+<repo>#<path>` pointer to the approval record        |

In production all four must be set to non-fixture values pulled from the operator's launch checklist. In local-substrate
we want the same code path to be exercised end-to-end (so the gate logic itself is smoke-tested), but the evidence and
approval refs can point at local fixture files because the local worker is never user-reachable
(`prove-no-public-leak.sh` keeps it on the docker network only).

## How to regenerate the digest

```bash
cd takos/deploy/local-substrate
sha256sum docs/launch-readiness/p0-local-evidence.md
# → <hash>  docs/launch-readiness/p0-local-evidence.md
# Then update TAKOSUMI_ACCOUNTS_MANAGED_OFFERING_READINESS_DIGEST in
# env/takosumi-cloud-worker.env with `sha256:<hash>`.
```

The substrate's `scripts/up.sh` does NOT auto-recompute this digest — that's intentional, because the whole point of
pinning a digest is that the operator chose it deliberately at the moment they reviewed the file. If you change this
file you must also update the env file by hand; otherwise the worker's managed-offering gate will refuse with
`readiness_digest_mismatch`.
