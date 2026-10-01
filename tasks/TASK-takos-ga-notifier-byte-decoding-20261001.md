# Takos GA: bounded notifier byte decoding

Date: 2026-10-01 UTC
Status: focused checks, actual local OCI, complete owner gate and independent
review passed; committed CI pending
Owner: Takos dedicated session
Required for: production_or_release
Grants production mutation authority: false
Repository mutation scope: `takos` only
Source base: `503c01d85d31e855caeadd1ff7774ca7b37c622c`

## Failure and scope

CI36878878002 failed the existing notification refresh replay-window test at
5000.52ms (1,632 pass/one fail); the wrapper/build phases were not reached.
The matching complete local gate and actual local OCI usage composition passed
and remain separate successes. Preserve the original1,000 real emitted events,
100-event replay window, cold reload, receipt identities and retired cursor
assertions, and the unchanged5s deadline. No blind CI rerun qualifies the fix.

The exact original journey locally passed in2.158s and a standalone copy of
its full assertions in2.253s. Its CPU profile shows typed-array iteration and
conversion among the hot operations. A controlled32KiB decode comparison,
1,000 iterations/three alternating rounds, preserves all256 byte values and
checksums: prior conversion249.95–276.25ms, indexed conversion19.19–22.36ms.
This supports a narrow runtime optimization rather than reducing the fixture.
The CI host's precise slowdown remains unconfirmed.

Only `fromBase64` byte copying changes: retain the same size/alphabet/padding
guards, `atob`, hashes, chunk/blob/head readbacks, closure and garbage-collection
validation. Allocate the exact binary-string length and copy each charCode
into its corresponding byte. Persisted bytes/schema/keys/contracts are unchanged.
No common-backend change, grant, deploy, publication, deletion or other tree edit.

## Acceptance and evidence

- Existing1,000-event test and5s deadline remain byte-for-byte unchanged.
- Exercise all256 byte values, all padding lengths and a split chunk through
  production staging and authenticated reading; preserve corruption/fault tests.
- Independently review runtime/test diff and repeat the required owner gate.
  Requalify current Worker/retained OCI usage composition after this runtime edit.
- Commit/push only the assigned runtime/test/task/handoff files and read back
  CI for the new head, keeping503c failure separate from later success.

Evidence root: `tmp/ga-container-current-20261001/`; source profile, benchmark,
503c CI raw log/status/failure evidence and focused/final qualification logs.
The first profiler CLI mistakenly selected the repo portable-test script;
that extra test run is not the focused profile. The direct profile executes
only the original notification journey. Neither proves a CI runtime defect.

Native target quota, storage durability, production alarms, shared SQL, real
owner/client/Container lifecycle, published artifacts and instance restore/
monitoring remain unqualified. Main owns shared contracts and integration.

## Local qualification

The focused journal/notification suite passed16 tests/two files in1.51s;
the unchanged1,000-event notification test passed in1.404s. Missing/corrupt
chunk rejection, ambiguous writes, head readbacks and cleanup tests passed.
Original notification test bytes match503c exactly.

The current runtime with the retained OCI manifest4fba7740.../binary2b62e7d1...
passed the real restart and usage recovery composition (process29401 exit0):
UID/GID10001, both native init identities/runc states absent after cleanup,
tool2 attempts/one effect, full checkpoint/lease/terminal/stale-RPC assertions,
dispatch0/1/0, revisions3/4, witness attempts2, and canonical input0.024/
output0.008. All1,040 frozen runtime hashes matched; own runtime tmp was empty.
This did not rebuild or publish the retained f5207eb image.

Raw OCI log SHA: `47cfb80b707b0c7476970ddb523fa504f0b3632b75b4f9e33c8072e4d68296c7`.
Source SHA: journal `9ec39c0ade73f283fa2507103a976a3ddda49497385b15fcb7641bb44b29da6b`;
test `839e5a59e6002389232e870a3e5ec4dc9cb0df17c6fdc9b3c9b532eb08ec9ae4`.
The matching503c CI tested mergeb9a4155c with the same Git tree61791145...
as503c; its failure remains an actual failure, not an observation error.

The final pinned Bun1.3.14 owner gate exited0 (process91297): 1,634 tests,
252 files, 11,819 assertions in81.03s; 20 OpenTofu tests/plans; all Rust
format/check/Clippy/default96/mock aggregate169/build; real Worker/full-SQLite/
process recovery and Web/Worker dry-run builds passed. Notification refresh
passed in1.601s; capacity0.805s under the unchanged5s limit; native guard43.656s.
Types98/lint111 remained declared with zero undeclared diagnostics. Mandatory
debug recovery also passed the real usage dispatch0/1/0 and authority checks.
No required phase was skipped or deadline relaxed.

- Full-check raw log SHA: `7104be8e18798bae983c1314f61578448f6df7230d8dd220ba1a8150e65527a1`.
- Local debug binary SHA: `cc498e5cf90b8bdb34d6555470150796136c70341f07d8d2809bf694d13ccb22`.

All1,040 runtime hashes and four protected original/other-owner hashes matched.
Independent final review found no concrete P1/P2 and matched both changed-file
hashes plus the unchanged original notification test. Profile/bench gains are
local evidence; committed CI must still qualify the new head. Exact new
commit/PR/CI readback belongs in the dedicated HDD result.
