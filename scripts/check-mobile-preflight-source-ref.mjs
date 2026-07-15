#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const takosRoot = fileURLToPath(new URL("..", import.meta.url));

export const REQUIRED_TAKOSUMI_MOBILE_PATHS = Object.freeze([
  "mobile-kit/scripts/init-tauri-mobile-native.mjs",
  "mobile-kit/scripts/mobile-release-evidence-validation.mjs",
  "mobile-kit/scripts/mobile-release-versions.mjs",
  "mobile-kit/src/push-navigation.ts",
]);

export function extractPinnedTakosumiSourceRef(workflowSource) {
  return (
    workflowSource.match(/TAKOSUMI_SOURCE_REF:[^\n]*'([0-9a-f]{40})'/u)?.[1] ??
    null
  );
}

export function buildMobilePreflightSourceRefStatus({
  pinnedRef,
  takosumiHead,
  dirtyMobileKitEntries = [],
  missingFromWorkingTree = [],
  missingFromHead = [],
  missingFromPinnedRef = [],
}) {
  const reasons = [];
  if (pinnedRef !== takosumiHead) {
    reasons.push({
      id: "pin_drift",
      detail: `workflow pin ${pinnedRef} does not match checked-out Takosumi HEAD ${takosumiHead}`,
    });
  }
  if (dirtyMobileKitEntries.length > 0) {
    reasons.push({
      id: "mobile_kit_uncommitted",
      detail: `${dirtyMobileKitEntries.length} mobile-kit path(s) differ from Takosumi HEAD`,
    });
  }
  if (missingFromWorkingTree.length > 0) {
    reasons.push({
      id: "working_tree_missing_required_paths",
      detail: `working tree is missing ${missingFromWorkingTree.join(", ")}`,
    });
  }
  if (missingFromHead.length > 0) {
    reasons.push({
      id: "head_missing_required_paths",
      detail: `Takosumi HEAD does not contain ${missingFromHead.join(", ")}`,
    });
  }
  if (missingFromPinnedRef.length > 0) {
    reasons.push({
      id: "pin_missing_required_paths",
      detail: `workflow pin does not contain ${missingFromPinnedRef.join(", ")}`,
    });
  }

  const localParityReady = reasons.length === 0;
  return {
    schema: "takos.mobile-preflight-source-ref-status.v1",
    scope: "local-committed-parity",
    status: localParityReady ? "local-parity-ready" : "source-ref-pending",
    localParityReady,
    remoteReachability: {
      status: "not-checked",
      requiredProof: "successful-hosted-actions-checkout",
    },
    pinnedRef,
    takosumiHead,
    requiredPaths: [...REQUIRED_TAKOSUMI_MOBILE_PATHS],
    blockers: localParityReady
      ? []
      : [
          {
            id: "native_preflight.source_ref_pending",
            label: "Local mobile preflight Takosumi source parity is pending.",
            detail: reasons.map((reason) => reason.detail).join("; "),
            action:
              "Commit and push the required Takosumi mobile-kit changes and update the workflow default to that immutable 40-character commit. This offline check does not verify public-origin reachability; require a successful hosted actions/checkout before treating the preflight as runnable.",
            actionability: "repo",
            owner: "cross-repo-release-maintainer",
            reasons,
          },
        ],
  };
}

export function inspectMobilePreflightSourceRef({
  workflowPath = resolve(
    takosRoot,
    ".github/workflows/mobile-native-preflight.yml",
  ),
  takosumiDir = resolve(takosRoot, "..", "takosumi"),
} = {}) {
  if (!existsSync(workflowPath)) {
    throw new Error(
      `mobile native preflight workflow is missing: ${workflowPath}`,
    );
  }
  if (!existsSync(takosumiDir)) {
    throw new Error(
      `adjacent Takosumi checkout is missing: ${takosumiDir}. Set --takosumi-dir when using another checkout layout.`,
    );
  }

  const pinnedRef = extractPinnedTakosumiSourceRef(
    readFileSync(workflowPath, "utf8"),
  );
  if (!pinnedRef) {
    throw new Error(
      `${workflowPath} must default TAKOSUMI_SOURCE_REF to an immutable 40-character commit.`,
    );
  }

  const takosumiHead = git(takosumiDir, ["rev-parse", "HEAD"]);
  const dirtyMobileKitEntries = git(takosumiDir, [
    "status",
    "--short",
    "--untracked-files=all",
    "--",
    "mobile-kit",
  ])
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const missingFromWorkingTree = REQUIRED_TAKOSUMI_MOBILE_PATHS.filter(
    (relativePath) => !existsSync(resolve(takosumiDir, relativePath)),
  );
  const missingFromHead = REQUIRED_TAKOSUMI_MOBILE_PATHS.filter(
    (relativePath) => !gitObjectExists(takosumiDir, takosumiHead, relativePath),
  );
  const missingFromPinnedRef = REQUIRED_TAKOSUMI_MOBILE_PATHS.filter(
    (relativePath) => !gitObjectExists(takosumiDir, pinnedRef, relativePath),
  );

  return buildMobilePreflightSourceRefStatus({
    pinnedRef,
    takosumiHead,
    dirtyMobileKitEntries,
    missingFromWorkingTree,
    missingFromHead,
    missingFromPinnedRef,
  });
}

function git(repoDir, args) {
  return execFileSync("git", ["-C", repoDir, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitObjectExists(repoDir, ref, relativePath) {
  try {
    execFileSync(
      "git",
      ["-C", repoDir, "cat-file", "-e", `${ref}:${relativePath}`],
      {
        stdio: "ignore",
      },
    );
    return true;
  } catch {
    return false;
  }
}

function parseArgs(argv) {
  const parsed = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--workflow" || arg === "--takosumi-dir") {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value.`);
      parsed[arg === "--workflow" ? "workflowPath" : "takosumiDir"] = resolve(
        process.cwd(),
        value,
      );
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return parsed;
}

function printHuman(report) {
  if (report.localParityReady) {
    console.log(
      `OK ${report.status}: mobile native preflight source ref ${report.pinnedRef} matches the local committed Takosumi mobile-kit.`,
    );
    console.log(
      "NOTE remote-reachability: not checked by this offline gate; require the hosted workflow's public Takosumi actions/checkout to succeed.",
    );
    return;
  }
  const blocker = report.blockers[0];
  console.error(`BLOCK ${report.status}: ${blocker.label}`);
  console.error(`  workflow pin: ${report.pinnedRef}`);
  console.error(`  Takosumi HEAD: ${report.takosumiHead}`);
  for (const reason of blocker.reasons) {
    console.error(`  - ${reason.id}: ${reason.detail}`);
  }
  console.error(
    "  remote-reachability: not checked by this offline gate; hosted public-origin actions/checkout is the required proof",
  );
  console.error(`  action: ${blocker.action}`);
}

if (import.meta.main) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = inspectMobilePreflightSourceRef(args);
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else printHuman(report);
    if (!report.localParityReady) process.exitCode = 1;
  } catch (error) {
    console.error(
      `BLOCK source-ref-pending: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
