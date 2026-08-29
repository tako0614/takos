#!/usr/bin/env -S bun
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

import {
  computeArtifactDigest,
  digestFiles,
  trackedWebInputs,
  WEB_BUILD_KIND,
  WEB_BUILD_MANIFEST,
  type WebBuildManifest,
} from "./build-web.ts";

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
  overrides?: Record<string, string>;
};

type BunLockfile = {
  overrides?: Record<string, string>;
  packages?: Record<string, unknown>;
};

type CanonicalAdvisory = {
  package: string;
  id: number;
  url: string;
  title: string;
  severity: string;
  vulnerableVersions: string;
};

export type DependencySecurityOptions = {
  artifactRoot: string;
  buildArtifact: boolean;
};

export type InstalledToolOccurrence = {
  package: "vite" | "esbuild";
  version: string;
  path: string;
};

export type InstalledPackageOccurrence = {
  package: string;
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

/**
 * Keep all security overrides bound to one exact dependency graph. The
 * package manifest is the requested policy, bun.lock is the resolved policy,
 * and node_modules is the physical graph actually consumed by build/tests.
 */
export function validateSecurityOverrides(
  rootPackage: PackageJson,
  lockfile: BunLockfile,
  installed: readonly InstalledPackageOccurrence[],
): string[] {
  const errors: string[] = [];
  const manifestOverrides = rootPackage.overrides ?? {};
  const lockOverrides = lockfile.overrides ?? {};
  if (JSON.stringify(sortRecord(manifestOverrides)) !== JSON.stringify(sortRecord(lockOverrides))) {
    errors.push("bun.lock override map does not match package.json overrides");
  }

  const lockPackages = lockfile.packages ?? {};
  for (const [packageName, expectedVersion] of Object.entries(manifestOverrides).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    if (!expectedVersion || typeof expectedVersion !== "string") {
      errors.push(`security override ${packageName} must declare an exact version`);
      continue;
    }

    const lockVersions = lockPackageVersions(packageName, lockPackages);
    if (lockVersions.length === 0) {
      errors.push(`bun.lock has no resolved package for security override ${packageName}`);
    } else if (lockVersions.some((version) => version !== expectedVersion)) {
      errors.push(
        `bun.lock resolves ${packageName} to ${JSON.stringify(lockVersions)} instead of ${expectedVersion}`,
      );
    }

    // Every physical copy must obey the override. A nested copy is not an
    // exception: a stale duplicate can be selected by a transitive consumer
    // even when the hoisted root package is current.
    const physical = installed.filter(
      (occurrence) => occurrence.package === packageName,
    );
    if (physical.length === 0) {
      errors.push(
        `node_modules has no physical package for security override ${packageName}`,
      );
    } else if (physical.some((occurrence) => occurrence.version !== expectedVersion)) {
      errors.push(
        `node_modules resolves ${packageName} to ${JSON.stringify(
          physical.map((occurrence) => ({ version: occurrence.version, path: occurrence.path })),
        )} instead of ${expectedVersion}`,
      );
    }
  }
  return errors;
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

function sortRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function lockPackageVersions(
  packageName: string,
  packages: Record<string, unknown>,
): string[] {
  const versions: string[] = [];
  for (const value of Object.values(packages)) {
    if (!Array.isArray(value) || typeof value[0] !== "string") continue;
    const descriptor = value[0];
    const prefix = `${packageName}@`;
    // Bun encodes nested packages as `parent/package` keys (and scoped
    // variants as `parent/@scope/package`) while retaining the resolved
    // package descriptor in the tuple. Match that descriptor rather than
    // relying on the root key so every nested resolution is checked.
    if (descriptor.startsWith(prefix)) {
      versions.push(descriptor.slice(prefix.length));
    }
  }
  return versions.sort((left, right) => left.localeCompare(right));
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
  return collectInstalledPackageOccurrences(new Set(["vite", "esbuild"])).filter(
    (occurrence): occurrence is InstalledToolOccurrence =>
      occurrence.package === "vite" || occurrence.package === "esbuild",
  );
}

function collectInstalledPackageOccurrences(
  packageNames: Set<string>,
): InstalledPackageOccurrence[] {
  return collectNodeModules(
    resolve(repoRoot, "node_modules"),
    "node_modules",
    new Set(),
    packageNames,
  );
}

function collectNodeModules(
  nodeModulesPath: string,
  logicalPath: string,
  ancestors: Set<string>,
  packageNames: Set<string>,
): InstalledPackageOccurrence[] {
  if (!existsSync(nodeModulesPath)) return [];
  const occurrences: InstalledPackageOccurrence[] = [];
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
            packageNames,
          ),
        );
      }
      continue;
    }
    occurrences.push(
      ...collectPackage(entryPath, entryLogicalPath, ancestors, packageNames),
    );
  }

  return occurrences;
}

function collectPackage(
  packagePath: string,
  logicalPath: string,
  ancestors: Set<string>,
  packageNames: Set<string>,
): InstalledPackageOccurrence[] {
  if (!existsSync(packagePath)) return [];
  const realPath = realpathSync(packagePath);
  const occurrences: InstalledPackageOccurrence[] = [];
  const packageJsonPath = resolve(packagePath, "package.json");

  if (existsSync(packageJsonPath)) {
    const packageJson = readJson<PackageJson>(packageJsonPath);
    const packageName = packageJson.name;
    if (packageName && packageNames.has(packageName) && packageJson.version) {
      occurrences.push({
        package: packageName,
        version: packageJson.version,
        path: `${logicalPath}/package.json`,
      });
    }
  }

  // A nested node_modules entry can be a symlink to an already visited
  // hoisted package. Count that physical resolution, but do not recurse into
  // its dependencies again (which would otherwise loop forever).
  if (ancestors.has(realPath)) return occurrences;
  const nextAncestors = new Set(ancestors).add(realPath);

  occurrences.push(
    ...collectNodeModules(
      resolve(packagePath, "node_modules"),
      `${logicalPath}/node_modules`,
      nextAncestors,
      packageNames,
    ),
  );
  return occurrences;
}

export function parseDependencySecurityArgs(
  args: string[],
): DependencySecurityOptions {
  let artifactRoot = resolve(repoRoot, "dist");
  let buildArtifact = true;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--artifact") {
      const value = args[index + 1];
      if (!value) throw new Error("--artifact requires a directory");
      artifactRoot = resolve(repoRoot, value);
      buildArtifact = false;
      index += 1;
    } else if (argument?.startsWith("--artifact=")) {
      const value = argument.slice("--artifact=".length);
      if (!value) throw new Error("--artifact requires a directory");
      artifactRoot = resolve(repoRoot, value);
      buildArtifact = false;
    } else if (argument === "--build") {
      buildArtifact = true;
    } else if (argument === "--no-build") {
      buildArtifact = false;
    } else {
      throw new Error(`unknown dependency security option: ${argument}`);
    }
  }
  return { artifactRoot, buildArtifact };
}

export function validateWebBuildArtifact(
  artifactRoot: string,
  root = repoRoot,
): string[] {
  const manifestPath = resolve(artifactRoot, WEB_BUILD_MANIFEST);
  if (!existsSync(manifestPath)) {
    return [`Web build manifest is missing: ${manifestPath}`];
  }

  let manifest: WebBuildManifest;
  try {
    manifest = readJson<WebBuildManifest>(manifestPath);
  } catch (error) {
    return [
      `Web build manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  if (manifest.kind !== WEB_BUILD_KIND) {
    return [`Web build manifest kind is unsupported: ${String(manifest.kind)}`];
  }
  if (!Array.isArray(manifest.sourceFiles) || manifest.sourceFiles.length === 0) {
    return ["Web build manifest must record its source files"];
  }

  let expectedSourceFiles: string[];
  try {
    expectedSourceFiles = trackedWebInputs(root);
  } catch (error) {
    return [
      `unable to verify Web build source inventory: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  if (JSON.stringify(manifest.sourceFiles) !== JSON.stringify(expectedSourceFiles)) {
    return ["Web build source file inventory is stale; rebuild the artifact"];
  }
  let sourceDigest: string;
  try {
    sourceDigest = digestFiles(root, expectedSourceFiles);
  } catch (error) {
    return [
      `unable to read Web build source inputs: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  if (manifest.sourceDigest !== sourceDigest) {
    return ["Web build source digest is stale; rebuild the artifact"];
  }
  let artifactDigest: string;
  try {
    artifactDigest = computeArtifactDigest(artifactRoot);
  } catch (error) {
    return [
      `unable to read Web build artifact: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  if (manifest.artifactDigest !== artifactDigest) {
    return ["Web build artifact digest does not match its manifest"];
  }
  return [];
}

export function validateProductionSanitizerBundle(
  artifactRoot = resolve(repoRoot, "dist"),
): string[] {
  const assetPath = resolve(artifactRoot, "assets");
  if (!existsSync(assetPath)) {
    return [`Web production assets are missing: ${assetPath}`];
  }
  const javascript = readdirSync(assetPath)
    .filter((name) => name.endsWith(".js"))
    .map((name) => readFileSync(resolve(assetPath, name), "utf8"))
    .join("\n");
  const proof = "takos.monaco-dompurify@3.4.13";
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

function readLockfile(path: string): BunLockfile {
  return Bun.JSON5.parse(readFileSync(path, "utf8")) as BunLockfile;
}

export function buildWebArtifactForStandaloneValidation(): string[] {
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
  return [];
}

function main(): void {
  const options = parseDependencySecurityArgs(process.argv.slice(2));
  const buildErrors = options.buildArtifact
    ? buildWebArtifactForStandaloneValidation()
    : [];
  if (buildErrors.length > 0) {
    console.error("Dependency security validation failed:");
    for (const error of buildErrors) console.error(`- ${error}`);
    process.exit(1);
  }

  const rootPackage = readJson<PackageJson>(resolve(repoRoot, "package.json"));
  const lockfile = readLockfile(resolve(repoRoot, "bun.lock"));
  const securityOverrideNames = new Set(Object.keys(rootPackage.overrides ?? {}));
  const installedSecurityOverrides = collectInstalledPackageOccurrences(
    securityOverrideNames,
  );

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
    ...validateSecurityOverrides(
      rootPackage,
      lockfile,
      installedSecurityOverrides,
    ),
    ...validateWebBuildArtifact(options.artifactRoot),
    ...validateProductionSanitizerBundle(options.artifactRoot),
    ...validateWaiverScope(
      rootPackage,
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
