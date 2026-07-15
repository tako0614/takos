import { expect, test } from "bun:test";

import {
  buildMobilePreflightSourceRefStatus,
  extractPinnedTakosumiSourceRef,
  REQUIRED_TAKOSUMI_MOBILE_PATHS,
} from "../../scripts/check-mobile-preflight-source-ref.mjs";

const pinnedRef = "1".repeat(40);

test("mobile preflight source ref parser requires the immutable workflow default", () => {
  expect(
    extractPinnedTakosumiSourceRef(
      `TAKOSUMI_SOURCE_REF: \${{ inputs.ref || '${pinnedRef}' }}`,
    ),
  ).toBe(pinnedRef);
  expect(
    extractPinnedTakosumiSourceRef("TAKOSUMI_SOURCE_REF: main"),
  ).toBeNull();
});

test("mobile preflight source status reports only local committed parity", () => {
  const status = buildMobilePreflightSourceRefStatus({
    pinnedRef,
    takosumiHead: pinnedRef,
  });

  expect(status).toMatchObject({
    schema: "takos.mobile-preflight-source-ref-status.v1",
    scope: "local-committed-parity",
    status: "local-parity-ready",
    localParityReady: true,
    remoteReachability: {
      status: "not-checked",
      requiredProof: "successful-hosted-actions-checkout",
    },
    blockers: [],
  });
  expect(status).not.toHaveProperty("ready");
  expect(status.requiredPaths).toEqual([...REQUIRED_TAKOSUMI_MOBILE_PATHS]);
});

test("mobile preflight source status exposes one repo-owned pending blocker", () => {
  const head = "2".repeat(40);
  const requiredPath = REQUIRED_TAKOSUMI_MOBILE_PATHS[0];
  const status = buildMobilePreflightSourceRefStatus({
    pinnedRef,
    takosumiHead: head,
    dirtyMobileKitEntries: [`?? ${requiredPath}`],
    missingFromHead: [requiredPath],
    missingFromPinnedRef: [requiredPath],
  });

  expect(status).toMatchObject({
    scope: "local-committed-parity",
    status: "source-ref-pending",
    localParityReady: false,
    remoteReachability: {
      status: "not-checked",
      requiredProof: "successful-hosted-actions-checkout",
    },
    blockers: [
      {
        id: "native_preflight.source_ref_pending",
        actionability: "repo",
        owner: "cross-repo-release-maintainer",
        reasons: [
          { id: "pin_drift" },
          { id: "mobile_kit_uncommitted" },
          { id: "head_missing_required_paths" },
          { id: "pin_missing_required_paths" },
        ],
      },
    ],
  });
});
