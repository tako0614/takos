import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  validateAuditFindings,
  validateReviewWindow,
  validateWaiverScope,
  validateVulnerableToolOccurrences,
} from "../validate-dependency-security.ts";

// Keep the historical fixture fixed so renewals cannot move the expiry regression.
const evidence = {
  kind: "takos.dependency-audit-waivers@v1" as const,
  reviewedAt: "2026-07-22",
  reviewAfter: "2026-08-05",
  scope: {
    owner: "vitepress" as const,
    ownerVersion: "1.6.4",
    ownerDependencyRange: "^5.4.14",
    viteVersion: "5.4.21",
    esbuildVersion: "0.21.5",
    vulnerableOccurrences: [
      {
        package: "esbuild" as const,
        version: "0.21.5",
        path: "node_modules/vitepress/node_modules/vite/node_modules/esbuild/package.json",
      },
      {
        package: "vite" as const,
        version: "5.4.21",
        path: "node_modules/vitepress/node_modules/vite/package.json",
      },
    ],
    devOnly: true as const,
    productionReachable: false as const,
    condition: "Windows development server only",
    upstreamTracking: "https://github.com/vuejs/vitepress/releases",
    removeWhen: "Remove after a stable VitePress release accepts a fixed Vite.",
  },
  advisories: [
    {
      package: "vite",
      id: 1123525,
      url: "https://github.com/advisories/GHSA-fx2h-pf6j-xcff",
      title: "vite: `server.fs.deny` bypass on Windows alternate paths",
      severity: "high",
      vulnerableVersions: "<=6.4.2",
    },
  ],
};

const audit = {
  vite: [
    {
      id: 1123525,
      url: "https://github.com/advisories/GHSA-fx2h-pf6j-xcff",
      title: "vite: `server.fs.deny` bypass on Windows alternate paths",
      severity: "high",
      vulnerable_versions: "<=6.4.2",
    },
  ],
};

describe("dependency security gate", () => {
  test("rejects impossible calendar dates, future reviews, and unbounded renewals", () => {
    expect(
      validateReviewWindow(
        { ...evidence, reviewedAt: "2026-02-30" },
        "2026-07-22",
      ),
    ).toEqual(["the waiver reviewedAt date is invalid"]);
    expect(
      validateReviewWindow(
        { ...evidence, reviewAfter: "2026-08-32" },
        "2026-07-22",
      ),
    ).toEqual(["the waiver reviewAfter date is invalid"]);
    expect(validateReviewWindow(evidence, "2026-07-21")).toEqual([
      "the waiver reviewedAt date is in the future",
    ]);
    expect(
      validateReviewWindow(
        { ...evidence, reviewAfter: "2026-08-06" },
        "2026-07-22",
      ),
    ).toEqual(["the waiver review window must not exceed 14 days"]);
    expect(
      validateReviewWindow(
        { ...evidence, reviewAfter: "2026-07-21" },
        "2026-07-22",
      ),
    ).toEqual(["the waiver review window ends before it starts"]);
    expect(validateReviewWindow(evidence, evidence.reviewAfter)).toEqual([]);
  });

  test("keeps the repository waiver current and confined to the reviewed dev-only scope", () => {
    const reviewed = JSON.parse(
      readFileSync(
        new URL("../../security/dependency-audit-waivers.json", import.meta.url),
        "utf8",
      ),
    ) as typeof evidence;
    expect(
      validateReviewWindow(reviewed, new Date().toISOString().slice(0, 10)),
    ).toEqual([]);
    const rootPackage = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(
      validateWaiverScope(
        rootPackage,
        {
          name: "vitepress",
          version: "1.6.4",
          dependencies: { vite: "^5.4.14" },
        },
        { name: "vite", version: "5.4.21" },
        { name: "esbuild", version: "0.21.5" },
        reviewed,
      ),
    ).toEqual([]);
  });

  test("accepts only the exact reviewed dev-only advisory", () => {
    expect(validateAuditFindings(audit, evidence)).toEqual([]);
    expect(validateReviewWindow(evidence, "2026-07-22")).toEqual([]);
    expect(
      validateVulnerableToolOccurrences(
        evidence.scope.vulnerableOccurrences,
        evidence,
      ),
    ).toEqual([]);
    expect(
      validateWaiverScope(
        { devDependencies: { vitepress: "^1.6.4" } },
        {
          name: "vitepress",
          version: "1.6.4",
          dependencies: { vite: "^5.4.14" },
        },
        { name: "vite", version: "5.4.21" },
        { name: "esbuild", version: "0.21.5" },
        evidence,
      ),
    ).toEqual([]);
  });

  test("rejects a new advisory and a changed dependency path", () => {
    const changedAudit = {
      ...audit,
      unexpected: [
        {
          id: 1,
          url: "https://example.invalid/advisory",
          title: "unexpected production issue",
          severity: "critical",
          vulnerable_versions: "*",
        },
      ],
    };
    expect(
      validateAuditFindings(changedAudit, evidence).length,
    ).toBeGreaterThan(0);
    expect(validateReviewWindow(evidence, "2026-08-06")).toEqual([
      "the dependency waiver review window expired on 2026-08-05",
    ]);
    expect(
      validateVulnerableToolOccurrences(
        [
          ...evidence.scope.vulnerableOccurrences,
          {
            package: "vite",
            version: "5.4.21",
            path: "node_modules/production-server/node_modules/vite/package.json",
          },
        ],
        evidence,
      ).length,
    ).toBeGreaterThan(0);
    expect(
      validateWaiverScope(
        { dependencies: { vitepress: "^1.6.4" } },
        {
          name: "vitepress",
          version: "1.6.4",
          dependencies: { vite: "^5.4.14" },
        },
        { name: "vite", version: "6.4.3" },
        { name: "esbuild", version: "0.21.5" },
        evidence,
      ).length,
    ).toBeGreaterThan(0);
  });
});
