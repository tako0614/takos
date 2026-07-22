#!/usr/bin/env -S bun
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

type AuditAdvisory = {
  id: number;
  url: string;
  title: string;
  severity: string;
  vulnerable_versions: string;
};

type AuditOutput = Record<string, AuditAdvisory[]>;

type WaivedAdvisory = {
  package: string;
  id: number;
  url: string;
  title: string;
  severity: string;
  vulnerableVersions: string;
};

type WaiverEvidence = {
  kind: "takos.dependency-audit-waivers@v1";
  reviewedAt: string;
  reviewAfter: string;
  scope: {
    owner: "vitepress";
    ownerVersion: string;
    ownerDependencyRange: string;
    viteVersion: string;
    esbuildVersion: string;
    vulnerableOccurrences: InstalledToolOccurrence[];
    devOnly: true;
    productionReachable: false;
    condition: string;
    upstreamTracking: string;
    removeWhen: string;
  };
  advisories: WaivedAdvisory[];
};

type PackageJson = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

type CanonicalAdvisory = {
  package: string;
  id: number;
  url: string;
  title: string;
  severity: string;
  vulnerableVersions: string;
};

export type InstalledToolOccurrence = {
  package: "vite" | "esbuild";
  version: string;
  path: string;
};

const repoRoot = resolve(import.meta.dir, "..");

export function validateAuditFindings(
  audit: AuditOutput,
  evidence: WaiverEvidence,
): string[] {
  const errors: string[] = [];
  const actual = Object.entries(audit)
    .flatMap(([packageName, advisories]) =>
      advisories.map((advisory) => canonicalAudit(packageName, advisory)),
    )
    .sort(compareAdvisories);
  const expected = evidence.advisories
    .map(canonicalWaiver)
    .sort(compareAdvisories);

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(
      `bun audit findings differ from the reviewed waiver (actual=${JSON.stringify(actual)}, expected=${JSON.stringify(expected)})`,
    );
  }

  const productionHigh = actual.filter(
    (advisory) =>
      advisory.severity === "critical" ||
      (advisory.severity === "high" && advisory.package !== "vite"),
  );
  if (productionHigh.length > 0) {
    errors.push(
      `production/runtime high or critical advisories are not allowed: ${JSON.stringify(productionHigh)}`,
    );
  }

  const waivedHigh = actual.filter((advisory) => advisory.severity === "high");
  if (
    waivedHigh.length !== 1 ||
    waivedHigh[0]?.id !== 1123525 ||
    waivedHigh[0]?.package !== "vite"
  ) {
    errors.push("the only permitted high advisory is Vite GHSA-fx2h-pf6j-xcff");
  }

  return errors;
}

export function validateWaiverScope(
  rootPackage: PackageJson,
  vitepressPackage: PackageJson,
  nestedVitePackage: PackageJson,
  nestedEsbuildPackage: PackageJson,
  evidence: WaiverEvidence,
): string[] {
  const errors: string[] = [];
  const scope = evidence.scope;

  if (rootPackage.dependencies?.vitepress !== undefined) {
    errors.push("vitepress must not be a production dependency");
  }
  if (rootPackage.devDependencies?.vitepress !== `^${scope.ownerVersion}`) {
    errors.push("the waiver must bind the exact VitePress devDependency line");
  }
  if (vitepressPackage.name !== scope.owner) {
    errors.push("the waived dependency owner must be VitePress");
  }
  if (vitepressPackage.version !== scope.ownerVersion) {
    errors.push("the installed VitePress version differs from waiver evidence");
  }
  if (vitepressPackage.dependencies?.vite !== scope.ownerDependencyRange) {
    errors.push("the VitePress-owned Vite range differs from waiver evidence");
  }
  if (
    nestedVitePackage.name !== "vite" ||
    nestedVitePackage.version !== scope.viteVersion
  ) {
    errors.push("the nested Vite version differs from waiver evidence");
  }
  if (
    nestedEsbuildPackage.name !== "esbuild" ||
    nestedEsbuildPackage.version !== scope.esbuildVersion
  ) {
    errors.push("the nested esbuild version differs from waiver evidence");
  }
  if (!scope.devOnly || scope.productionReachable) {
    errors.push("the waiver must remain dev-only and production-unreachable");
  }
  if (!scope.condition.includes("Windows")) {
    errors.push(
      "the waiver must retain its Windows-only high-severity condition",
    );
  }
  if (
    scope.upstreamTracking !== "https://github.com/vuejs/vitepress/releases"
  ) {
    errors.push("the waiver must retain canonical upstream release tracking");
  }
  if (!scope.removeWhen.includes("stable VitePress")) {
    errors.push("the waiver must state its stable-upstream removal condition");
  }

  return errors;
}

export function validateVulnerableToolOccurrences(
  occurrences: InstalledToolOccurrence[],
  evidence: WaiverEvidence,
): string[] {
  const actual = occurrences
    .filter((occurrence) => isVulnerableToolOccurrence(occurrence))
    .sort(compareOccurrences);
  const expected = evidence.scope.vulnerableOccurrences
    .map((occurrence) => ({ ...occurrence }))
    .sort(compareOccurrences);

  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    return [
      `vulnerable Vite/esbuild occurrences escaped the reviewed dev-only subtree (actual=${JSON.stringify(actual)}, expected=${JSON.stringify(expected)})`,
    ];
  }
  return [];
}

export function validateReviewWindow(
  evidence: WaiverEvidence,
  today: string,
): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(evidence.reviewedAt)) {
    return ["the waiver reviewedAt date is invalid"];
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(evidence.reviewAfter)) {
    return ["the waiver reviewAfter date is invalid"];
  }
  if (evidence.reviewedAt > evidence.reviewAfter) {
    return ["the waiver review window ends before it starts"];
  }
  if (today > evidence.reviewAfter) {
    return [
      `the dependency waiver review window expired on ${evidence.reviewAfter}`,
    ];
  }
  return [];
}

function canonicalAudit(
  packageName: string,
  advisory: AuditAdvisory,
): CanonicalAdvisory {
  return {
    package: packageName,
    id: advisory.id,
    url: advisory.url,
    title: advisory.title,
    severity: advisory.severity,
    vulnerableVersions: advisory.vulnerable_versions,
  };
}

function canonicalWaiver(advisory: WaivedAdvisory): CanonicalAdvisory {
  return {
    package: advisory.package,
    id: advisory.id,
    url: advisory.url,
    title: advisory.title,
    severity: advisory.severity,
    vulnerableVersions: advisory.vulnerableVersions,
  };
}

function compareAdvisories(
  left: CanonicalAdvisory,
  right: CanonicalAdvisory,
): number {
  return left.package.localeCompare(right.package) || left.id - right.id;
}

function compareOccurrences(
  left: InstalledToolOccurrence,
  right: InstalledToolOccurrence,
): number {
  return left.path.localeCompare(right.path);
}

function isVulnerableToolOccurrence(
  occurrence: InstalledToolOccurrence,
): boolean {
  return occurrence.package === "vite"
    ? compareVersions(occurrence.version, "6.4.2") <= 0
    : compareVersions(occurrence.version, "0.24.2") <= 0;
}

function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = leftParts[index]! - rightParts[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

function parseVersion(version: string): [number, number, number] {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!match) throw new Error(`unsupported package version: ${version}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function collectInstalledToolOccurrences(): InstalledToolOccurrence[] {
  return collectNodeModules(
    resolve(repoRoot, "node_modules"),
    "node_modules",
    new Set(),
  );
}

function collectNodeModules(
  nodeModulesPath: string,
  logicalPath: string,
  ancestors: Set<string>,
): InstalledToolOccurrence[] {
  if (!existsSync(nodeModulesPath)) return [];
  const occurrences: InstalledToolOccurrence[] = [];
  const entries = readdirSync(nodeModulesPath, { withFileTypes: true }).sort(
    (left, right) => left.name.localeCompare(right.name),
  );

  for (const entry of entries) {
    if (entry.name === ".bin") continue;
    const entryPath = resolve(nodeModulesPath, entry.name);
    const entryLogicalPath = `${logicalPath}/${entry.name}`;
    if (entry.name.startsWith("@")) {
      if (!entry.isDirectory()) continue;
      for (const scopedEntry of readdirSync(entryPath, {
        withFileTypes: true,
      })) {
        occurrences.push(
          ...collectPackage(
            resolve(entryPath, scopedEntry.name),
            `${entryLogicalPath}/${scopedEntry.name}`,
            ancestors,
          ),
        );
      }
      continue;
    }
    occurrences.push(...collectPackage(entryPath, entryLogicalPath, ancestors));
  }

  return occurrences;
}

function collectPackage(
  packagePath: string,
  logicalPath: string,
  ancestors: Set<string>,
): InstalledToolOccurrence[] {
  if (!existsSync(packagePath)) return [];
  const realPath = realpathSync(packagePath);
  if (ancestors.has(realPath)) return [];
  const nextAncestors = new Set(ancestors).add(realPath);
  const occurrences: InstalledToolOccurrence[] = [];
  const packageJsonPath = resolve(packagePath, "package.json");

  if (existsSync(packageJsonPath)) {
    const packageJson = readJson<PackageJson>(packageJsonPath);
    if (
      (packageJson.name === "vite" || packageJson.name === "esbuild") &&
      packageJson.version
    ) {
      occurrences.push({
        package: packageJson.name,
        version: packageJson.version,
        path: `${logicalPath}/package.json`,
      });
    }
  }

  occurrences.push(
    ...collectNodeModules(
      resolve(packagePath, "node_modules"),
      `${logicalPath}/node_modules`,
      nextAncestors,
    ),
  );
  return occurrences;
}

function validateProductionSanitizerBundle(): string[] {
  const build = Bun.spawnSync({
    cmd: ["bun", "run", "web:build"],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (build.exitCode !== 0) {
    return [
      `web production build failed during dependency validation: ${build.stderr.toString().trim()}`,
    ];
  }

  const assetPath = resolve(repoRoot, "dist/assets");
  const javascript = readdirSync(assetPath)
    .filter((name) => name.endsWith(".js"))
    .map((name) => readFileSync(resolve(assetPath, name), "utf8"))
    .join("\n");
  const proof = "takos.monaco-dompurify@3.4.12";
  const proofCount = javascript.split(proof).length - 1;
  if (proofCount !== 1) {
    return [
      `production bundle must contain exactly one secure Monaco sanitizer proof (received ${proofCount})`,
    ];
  }
  if (javascript.includes("DOMPurify 3.2.7")) {
    return [
      "production bundle still contains Monaco's vulnerable DOMPurify 3.2.7",
    ];
  }
  return [];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function main(): void {
  const evidence = readJson<WaiverEvidence>(
    resolve(repoRoot, "security/dependency-audit-waivers.json"),
  );
  if (evidence.kind !== "takos.dependency-audit-waivers@v1") {
    throw new Error("unsupported dependency audit waiver evidence kind");
  }

  const auditResult = Bun.spawnSync({
    cmd: ["bun", "audit", "--json"],
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = auditResult.stdout.toString().trim();
  if (stdout.length === 0) {
    throw new Error(
      `bun audit returned no JSON (exit=${auditResult.exitCode}): ${auditResult.stderr.toString().trim()}`,
    );
  }

  const audit = JSON.parse(stdout) as AuditOutput;
  const errors = [
    ...validateAuditFindings(audit, evidence),
    ...validateReviewWindow(evidence, new Date().toISOString().slice(0, 10)),
    ...validateVulnerableToolOccurrences(
      collectInstalledToolOccurrences(),
      evidence,
    ),
    ...validateProductionSanitizerBundle(),
    ...validateWaiverScope(
      readJson<PackageJson>(resolve(repoRoot, "package.json")),
      readJson<PackageJson>(
        resolve(repoRoot, "node_modules/vitepress/package.json"),
      ),
      readJson<PackageJson>(
        resolve(
          repoRoot,
          "node_modules/vitepress/node_modules/vite/package.json",
        ),
      ),
      readJson<PackageJson>(
        resolve(
          repoRoot,
          "node_modules/vitepress/node_modules/vite/node_modules/esbuild/package.json",
        ),
      ),
      evidence,
    ),
  ];

  if (errors.length > 0) {
    console.error("Dependency security validation failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(
    `Dependency security validation passed: production/runtime high=0 critical=0; ${evidence.advisories.length} exact VitePress dev-only advisories remain fail-closed.`,
  );
}

if (import.meta.main) main();
