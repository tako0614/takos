import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

type ValidationResult = {
  errors: string[];
  warnings: string[];
};

const REQUIRED_SITE_FILES = [
  "index.md",
  "overview/index.md",
  "concepts/index.md",
  "concepts/spaces-and-workspaces.md",
  "concepts/repos-services-workers.md",
  "concepts/resources-and-bindings.md",
  "concepts/threads-and-runs.md",
  "specs/index.md",
  "specs/app-manifest.md",
  "specs/deployment-model.md",
  "specs/cli-and-auth.md",
  "architecture/index.md",
  "architecture/control-plane.md",
  "architecture/tenant-runtime.md",
  "architecture/compatibility-and-limitations.md",
  "architecture/release-system.md",
  "architecture/resource-governance.md",
  "operations/index.md",
  "reference/index.md",
  "reference/glossary.md",
  "reference/commands.md",
  ".vitepress/config.ts",
  ".vitepress/theme/index.ts",
  ".vitepress/theme/custom.css",
];

const SKIP_SCAN_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  ".wrangler",
  ".tmp",
  "tmp",
  "target",
  "artifacts",
]);

function isFile(targetPath: string): boolean {
  return existsSync(targetPath) && statSync(targetPath).isFile();
}

function isDirectory(targetPath: string): boolean {
  return existsSync(targetPath) && statSync(targetPath).isDirectory();
}

function resolveTakosRepoRoot(): string {
  const configured = process.env.TAKOS_REPO_DIR;
  const candidates = [
    configured,
    path.resolve(process.cwd(), ".."),
    process.cwd(),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (
      isFile(path.join(candidate, "package.json")) &&
      isFile(path.join(candidate, "pnpm-workspace.yaml"))
    ) {
      return candidate;
    }
  }

  throw new Error("Takos repo root not found. Run from takos/ or set TAKOS_REPO_DIR.");
}

function resolveDocsDir(repoRoot: string): string {
  const docsDir = path.join(repoRoot, "apps", "docs-site", "docs");
  if (!isDirectory(docsDir)) {
    throw new Error("Takos docs site not found. Expected apps/docs-site/docs.");
  }
  return docsDir;
}

function walkFiles(dir: string): string[] {
  if (!isDirectory(dir)) return [];

  const out: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_SCAN_DIRS.has(entry.name)) continue;
      out.push(...walkFiles(full));
      continue;
    }
    if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function stripFencedCodeBlocks(content: string): string {
  return content.replace(/```[\s\S]*?```/g, "");
}

function resolveDocsLinkPath(docsDir: string, file: string, linkPath: string): string | null {
  const base = linkPath.startsWith("/")
    ? path.join(docsDir, linkPath.slice(1))
    : path.resolve(path.dirname(file), linkPath);

  const candidates = [base, `${base}.md`, path.join(base, "index.md")];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function validateRequiredSiteFiles(docsDir: string, result: ValidationResult): void {
  for (const file of REQUIRED_SITE_FILES) {
    const full = path.join(docsDir, file);
    if (!existsSync(full)) {
      result.errors.push(`[docs] required file is missing: ${file}`);
    }
  }
}

function validateDocsInternalLinks(docsDir: string, result: ValidationResult): void {
  const files = walkFiles(docsDir).filter((file) => file.endsWith(".md"));

  for (const file of files) {
    const raw = readFileSync(file, "utf8");
    const content = stripFencedCodeBlocks(raw);
    const targets: string[] = [];

    for (const match of content.matchAll(/\[[^\]]*?\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (target) targets.push(target);
    }

    for (const match of content.matchAll(/^\[[^\]]+\]:\s*(\S+)/gm)) {
      const target = match[1];
      if (target) targets.push(target);
    }

    for (const rawTarget of targets) {
      let target = rawTarget.trim();
      if (target.startsWith("<") && target.endsWith(">")) {
        target = target.slice(1, -1).trim();
      }
      if (/\s/.test(target)) {
        target = target.split(/\s+/)[0] ?? target;
      }
      if (
        target === "" ||
        target === "#" ||
        target.startsWith("#") ||
        target.startsWith("//") ||
        /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)
      ) {
        continue;
      }

      const noQuery = target.split("?")[0] ?? target;
      const linkPath = (noQuery.split("#")[0] ?? noQuery).trim();
      if (linkPath === "") continue;

      const resolved = resolveDocsLinkPath(docsDir, file, linkPath);
      if (!resolved) {
        result.warnings.push(
          `[docs] broken link target in ${path.relative(docsDir, file)}: ${linkPath}`,
        );
      }
    }
  }
}

function validateDocsScriptRefs(repoRoot: string, docsDir: string, result: ValidationResult): void {
  const files = walkFiles(docsDir).filter((file) => file.endsWith(".md"));
  const refPattern =
    /\b(?:apps|packages|scripts)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|mjs|cjs|sh|bash|py|sql)\b/g;

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const refs = new Set(content.match(refPattern) ?? []);
    for (const ref of refs) {
      const full = path.resolve(repoRoot, ref);
      if (!existsSync(full)) {
        result.warnings.push(
          `[docs] script or source reference not found: ${ref} (referenced by ${path.relative(docsDir, file)})`,
        );
      }
    }
  }
}

function validateSelfContainedDocs(docsDir: string, result: ValidationResult): void {
  const files = walkFiles(docsDir).filter((file) => file.endsWith(".md"));
  const forbiddenLinkPattern =
    /\[[^\]]*?\]\((?:\/)?(?:README\.md|CONTRIBUTING\.md|AGENTS\.md|CLAUDE\.md)(?:#[^)]+)?\)/g;
  const forbiddenRepoPathPattern =
    /\b(?:apps|packages|scripts)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|mjs|cjs|md|json|sql|yml|yaml)\b/g;

  for (const file of files) {
    const content = stripFencedCodeBlocks(readFileSync(file, "utf8"));
    const rel = path.relative(docsDir, file);

    if (forbiddenLinkPattern.test(content)) {
      result.errors.push(
        `[docs] primary docs must not depend on README/CONTRIBUTING/AGENTS links: ${rel}`,
      );
    }

    const repoPathMatches = content.match(forbiddenRepoPathPattern) ?? [];
    for (const match of new Set(repoPathMatches)) {
      result.warnings.push(
        `[docs] avoid implementation path reference in primary docs: ${match} (in ${rel})`,
      );
    }
  }
}

function validateRepoDocsPolicy(repoRoot: string, result: ValidationResult): void {
  const disallowed = path.join(repoRoot, "docs");
  if (isDirectory(disallowed)) {
    result.errors.push("[docs] repository-root docs/ is not allowed. Use apps/docs-site/docs.");
  }
}

function main(): void {
  const repoRoot = resolveTakosRepoRoot();
  const docsDir = resolveDocsDir(repoRoot);
  const result: ValidationResult = { errors: [], warnings: [] };

  validateRequiredSiteFiles(docsDir, result);
  validateDocsInternalLinks(docsDir, result);
  validateDocsScriptRefs(repoRoot, docsDir, result);
  validateSelfContainedDocs(docsDir, result);
  validateRepoDocsPolicy(repoRoot, result);

  for (const warning of result.warnings) {
    console.warn(warning);
  }

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      console.error(error);
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `[docs] ok: validated ${path.relative(repoRoot, docsDir)} (${result.warnings.length} warnings)`
  );
}

main();
