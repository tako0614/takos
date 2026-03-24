import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

type ValidationResult = {
  errors: string[];
  warnings: string[];
};

type ProductConfig = {
  name: string;
  repoDir?: string;
  allowReferenceGitDir: boolean;
};

const PLAN_SOFT_LINE_LIMIT = 220;
const PLAN_HARD_LINE_LIMIT = 300;
const PLAN_CODE_BLOCK_HARD_LINE_LIMIT = 120;

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

function resolveDocsDir(): string {
  const configured = process.env.TAKOS_DOCS_DIR;
  if (!configured) {
    throw new Error(
      "TAKOS_DOCS_DIR is required. Point it at the external docs repo root."
    );
  }

  const resolved = path.resolve(configured);
  if (!isDirectory(resolved) || !isFile(path.join(resolved, "shared", "products.json"))) {
    throw new Error(
      "docs repository not found. Set TAKOS_DOCS_DIR to the external docs repo root."
    );
  }

  return resolved;
}

function resolveTakosRepoRoot(): string {
  const configured = process.env.TAKOS_REPO_DIR;
  const candidates = [
    configured,
    process.cwd(),
    path.resolve(process.cwd(), ".."),
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

const productsConfig = JSON.parse(
  readFileSync(path.join(resolveDocsDir(), "shared", "products.json"), "utf-8"),
) as { products: { id: string; allowReferenceGitDir: boolean }[] };

const PRODUCTS: ProductConfig[] = productsConfig.products.map((p) => ({
  name: p.id,
  repoDir: "repoDir" in p ? (p as { repoDir?: string }).repoDir : undefined,
  allowReferenceGitDir: p.allowReferenceGitDir,
}));

const PRODUCT_NAMES = PRODUCTS.map((p) => p.name);
const SUPPORTED_DOCS_HINT = PRODUCT_NAMES.join(", ");
const PLAN_SPEC_LINK_PATTERN = new RegExp(
  `ARCHITECTURE\\.md|reference\\/|architecture\\/|docs\\/(${PRODUCT_NAMES.join("|")})\\/`
);

const REQUIRED_DOCS_TOP_LEVEL_FILES = ["README.md"];
const REQUIRED_DOCS_TOP_LEVEL_DIRS = PRODUCTS.map((p) => p.name);
const ALLOWED_DOCS_TOP_LEVEL_DIRS = [...REQUIRED_DOCS_TOP_LEVEL_DIRS, "shared"];

const REQUIRED_PRODUCT_TOP_LEVEL_FILES = [
  "README.md",
  "VISION.md",
  "ARCHITECTURE.md",
  "CONVENTIONS.md",
  "DOCS-OPERATIONS.md",
];

const REQUIRED_PRODUCT_TOP_LEVEL_DIRS = ["reference", "architecture", "plans", "issues", "status"];

function listDirEntries(dir: string): string[] {
  if (!isDirectory(dir)) return [];
  return readdirSync(dir);
}

function walkFiles(dir: string): string[] {
  if (!isDirectory(dir)) return [];

  const out: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
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

      if (target === "" || target === "#") continue;
      if (target.startsWith("#")) continue;
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) continue;
      if (target.startsWith("//")) continue;

      const noQuery = target.split("?")[0] ?? target;
      const linkPath = (noQuery.split("#")[0] ?? noQuery).trim();
      if (linkPath === "") continue;

      const resolved = path.resolve(path.dirname(file), linkPath);
      if (!existsSync(resolved)) {
        result.warnings.push(
          `[docs] broken link target in ${path.relative(docsDir, file)}: ${linkPath}`
        );
      }
    }
  }
}

function validateDocsScriptRefs(repoRoot: string, docsDir: string, result: ValidationResult): void {
  const files = walkFiles(docsDir).filter((file) => file.endsWith(".md"));
  const refPattern =
    /\b(?:apps|packages|scripts)\/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|mjs|cjs|sh|bash|py)\b/g;
  const seen = new Set<string>();

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    const matches = content.match(refPattern) ?? [];
    for (const ref of matches) {
      const fileLabel = path.relative(docsDir, file);
      const dedupeKey = `${fileLabel}::${ref}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      if (ref.includes("/dist/") || ref.includes("/build/")) continue;
      if (ref.includes("/node_modules/")) continue;

      const candidates =
        ref.startsWith("scripts/")
          ? [
              path.resolve(repoRoot, ref),
              path.resolve(repoRoot, "apps/control", ref),
            ]
          : [path.resolve(repoRoot, ref)];

      if (candidates.some((p) => existsSync(p))) continue;

      if (ref.startsWith("scripts/")) {
        result.warnings.push(
          `[docs] script reference not found: ${ref} (referenced by ${fileLabel})`
        );
      }
    }
  }
}

function validateRootDocsOnly(repoRoot: string, docsDir: string, result: ValidationResult): void {
  const allowedDocsDir = path.resolve(docsDir);
  const stack: string[] = [repoRoot];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (SKIP_SCAN_DIRS.has(entry.name)) continue;

      const full = path.join(current, entry.name);
      if (entry.name === "docs") {
        const resolved = path.resolve(full);
        if (resolved !== allowedDocsDir) {
          result.errors.push(
            `[docs] only repository-root docs/ is allowed. found: ${path.relative(repoRoot, resolved)}`
          );
        }
        continue;
      }

      if (existsSync(path.join(full, ".git"))) continue;

      stack.push(full);
    }
  }
}

function validateDocsTopLevelLayout(docsDir: string, result: ValidationResult): void {
  for (const file of REQUIRED_DOCS_TOP_LEVEL_FILES) {
    const full = path.join(docsDir, file);
    if (!isFile(full)) {
      result.errors.push(`[docs] required file is missing: ${file}`);
    }
  }

  for (const dir of REQUIRED_DOCS_TOP_LEVEL_DIRS) {
    const full = path.join(docsDir, dir);
    if (!isDirectory(full)) {
      result.errors.push(`[docs] required directory is missing: ${dir}/`);
    }
  }

  const allowedFileSet = new Set(REQUIRED_DOCS_TOP_LEVEL_FILES);
  const allowedDirSet = new Set(ALLOWED_DOCS_TOP_LEVEL_DIRS);
  const entries = readdirSync(docsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && !allowedDirSet.has(entry.name)) {
      result.errors.push(
        `[docs] unsupported top-level directory: ${entry.name}/ (use ${SUPPORTED_DOCS_HINT} only)`
      );
    }

    if (entry.isFile() && entry.name.endsWith(".md") && !allowedFileSet.has(entry.name)) {
      result.errors.push(
        `[docs] unsupported top-level markdown file: ${entry.name} (keep docs/ as index-only)`
      );
    }
  }
}

function validateProductTopLevelLayout(productDir: string, productName: string, result: ValidationResult): void {
  for (const file of REQUIRED_PRODUCT_TOP_LEVEL_FILES) {
    const full = path.join(productDir, file);
    if (!isFile(full)) {
      result.errors.push(`[${productName}] required file is missing: ${file}`);
    }
  }

  for (const dir of REQUIRED_PRODUCT_TOP_LEVEL_DIRS) {
    const full = path.join(productDir, dir);
    if (!isDirectory(full)) {
      result.errors.push(`[${productName}] required directory is missing: ${dir}/`);
    }
  }

  const allowedFileSet = new Set(REQUIRED_PRODUCT_TOP_LEVEL_FILES);
  const allowedDirSet = new Set(REQUIRED_PRODUCT_TOP_LEVEL_DIRS);
  const entries = readdirSync(productDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && !allowedDirSet.has(entry.name)) {
      result.errors.push(
        `[${productName}] unsupported top-level directory: ${entry.name}/`
      );
    }

    if (entry.isFile() && entry.name.endsWith(".md") && !allowedFileSet.has(entry.name)) {
      result.errors.push(
        `[${productName}] unsupported top-level markdown file: ${entry.name}`
      );
    }
  }
}

function validateArchitectureCanon(productDir: string, productName: string, result: ValidationResult): void {
  const architecturePath = path.join(productDir, "ARCHITECTURE.md");
  if (!isFile(architecturePath)) {
    result.errors.push(`[${productName}] ARCHITECTURE.md is required.`);
    return;
  }

  const content = readFileSync(architecturePath, "utf8");
  if (!/^#\s+.+$/m.test(content)) {
    result.errors.push(`[${productName}] ARCHITECTURE.md must contain H1 (# title).`);
  }
}

function validateCategoryStructure(
  productDir: string,
  productName: string,
  rootName: "reference" | "architecture",
  allowReferenceGitDir: boolean,
  result: ValidationResult
): void {
  const rootDir = path.join(productDir, rootName);
  if (!isDirectory(rootDir)) return;

  const entries = readdirSync(rootDir, { withFileTypes: true });
  const markdownFiles: string[] = [];

  for (const entry of entries) {
    const full = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      const isAllowedGitDir =
        rootName === "reference" && allowReferenceGitDir && entry.name === "git";

      if (!isAllowedGitDir) {
        result.errors.push(
          `[${productName}/${rootName}] nested subdirectory is not allowed: ${entry.name}/`
        );
        continue;
      }

      const gitEntries = readdirSync(full, { withFileTypes: true });
      for (const gitEntry of gitEntries) {
        if (gitEntry.isDirectory()) {
          result.errors.push(
            `[${productName}/reference] nested subdirectory is not allowed: git/${gitEntry.name}/`
          );
          continue;
        }
        if (!gitEntry.isFile() || !gitEntry.name.endsWith(".md")) continue;
        if (gitEntry.name !== "README.md" && !/^[a-z0-9-]+\.md$/.test(gitEntry.name)) {
          result.errors.push(
            `[${productName}/reference] invalid filename in git/: ${gitEntry.name} (must be kebab-case .md)`
          );
        }
      }
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    markdownFiles.push(entry.name);

    if (!/^[a-z0-9-]+\.md$/.test(entry.name) && entry.name !== "README.md") {
      result.errors.push(
        `[${productName}/${rootName}] invalid filename: ${entry.name} (must be kebab-case .md)`
      );
    }
  }

  if (markdownFiles.length === 0) {
    result.warnings.push(`[${productName}/${rootName}] has no markdown files.`);
  }
}

function validatePlans(productDir: string, productName: string, result: ValidationResult): void {
  const plansDir = path.join(productDir, "plans");
  const entries = listDirEntries(plansDir);

  for (const entry of entries) {
    const full = path.join(plansDir, entry);
    if (isDirectory(full)) {
      result.errors.push(`[${productName}/plans] subdirectory is not allowed: ${entry}`);
    }
  }

  const planFiles = entries.filter((entry) => isFile(path.join(plansDir, entry)));
  for (const entry of planFiles) {
    if (entry === "README.md") continue;
    if (!/^\d{4}-\d{2}-[a-z0-9-]+\.md$/.test(entry)) {
      result.errors.push(
        `[${productName}/plans] invalid filename: ${entry} (must be YYYY-MM-kebab.md)`
      );
    }

    const full = path.join(plansDir, entry);
    const content = readFileSync(full, "utf8");
    const lineCount = content.split(/\r?\n/).length;
    const checklistLines = content.match(/^\s*(?:[-*]|\d+\.)\s*\[[ xX]\].*$/gm) ?? [];
    const hasOverview = /^##\s*(概要|Overview)(?:\s|$)/m.test(content);
    const hasArchitectureAlignment =
      /^##\s*(ARCHITECTURE整合|Architecture Alignment)(?:\s|$)/m.test(content);
    const hasSpecLinks = /^##\s*(仕様リンク|Spec Links)(?:\s|$)/m.test(content);

    if (lineCount > PLAN_SOFT_LINE_LIMIT) {
      result.warnings.push(
        `[${productName}/plans] ${entry} is ${lineCount} lines (soft limit: ${PLAN_SOFT_LINE_LIMIT}).`
      );
    }

    if (lineCount > PLAN_HARD_LINE_LIMIT) {
      result.errors.push(
        `[${productName}/plans] ${entry} exceeds hard line limit (${PLAN_HARD_LINE_LIMIT}).`
      );
    }

    if (!hasOverview) {
      result.errors.push(
        `[${productName}/plans] missing required overview section in ${entry} (## 概要 or ## Overview)`
      );
    }

    if (!hasArchitectureAlignment) {
      result.errors.push(
        `[${productName}/plans] missing required architecture alignment section in ${entry} (## ARCHITECTURE整合 or ## Architecture Alignment)`
      );
    }

    if (!hasSpecLinks) {
      result.errors.push(
        `[${productName}/plans] missing required spec links section in ${entry} (## 仕様リンク or ## Spec Links)`
      );
    }

    if (!PLAN_SPEC_LINK_PATTERN.test(content)) {
      result.errors.push(
        `[${productName}/plans] ${entry} must include at least one spec link to ARCHITECTURE.md, reference/, or architecture/.`
      );
    }

    if (checklistLines.length === 0) {
      result.errors.push(
        `[${productName}/plans] missing checklist in ${entry} (add - [ ] / - [x] items)`
      );
      continue;
    }

    const hasUnchecked = checklistLines.some((line) => /\[\s\]/.test(line));
    if (!hasUnchecked) {
      result.errors.push(
        `[${productName}/plans] completed plan must be deleted: ${entry} (all checklist items are checked)`
      );
    }

    const fencedBlocks = Array.from(content.matchAll(/```[^\n]*\n([\s\S]*?)```/g));
    for (const block of fencedBlocks) {
      const blockBody = block[1] ?? "";
      const blockLineCount = blockBody.split(/\r?\n/).length;
      if (blockLineCount <= PLAN_CODE_BLOCK_HARD_LINE_LIMIT) continue;

      result.errors.push(
        `[${productName}/plans] ${entry} contains oversized code block (${blockLineCount} lines). hard limit is ${PLAN_CODE_BLOCK_HARD_LINE_LIMIT}.`
      );
    }
  }
}

function validateIssues(productDir: string, productName: string, result: ValidationResult): void {
  const issuesDir = path.join(productDir, "issues");
  const entries = listDirEntries(issuesDir);

  for (const entry of entries) {
    if (entry === "README.md") continue;
    if (!/^\d{3}-[a-z0-9-]+\.md$/.test(entry)) {
      result.errors.push(
        `[${productName}/issues] invalid filename: ${entry} (must be NNN-kebab.md)`
      );
    }

    const full = path.join(issuesDir, entry);
    if (!isFile(full)) continue;

    const content = readFileSync(full, "utf8");
    const severity = content.match(/^\*\*Severity:\*\*\s*(CRITICAL|HIGH|MEDIUM|LOW)\s*$/m);
    if (!severity) {
      result.errors.push(
        `[${productName}/issues] missing or invalid severity in ${entry} (CRITICAL/HIGH/MEDIUM/LOW)`
      );
    }

    const hasDescription = /^##\s*(Description|概要|問題|詳細)(?:\s|$)/m.test(content);
    const hasSteps = /^##\s*(Steps to Reproduce|再現手順)(?:\s|$)/m.test(content);
    const hasFix = /^##\s*(Fix|修正|対応方針)(?:\s|$)/m.test(content);

    if (!hasDescription) {
      result.errors.push(`[${productName}/issues] missing required section in ${entry}: ## Description`);
    }
    if (!hasSteps) {
      result.errors.push(
        `[${productName}/issues] missing required section in ${entry}: ## Steps to Reproduce`
      );
    }
    if (!hasFix) {
      result.errors.push(`[${productName}/issues] missing required section in ${entry}: ## Fix`);
    }

    const status = content.match(/^\*\*Status:\*\*\s*(.+)\s*$/m);
    if (status && !/^(Open|未解決)$/i.test(status[1].trim())) {
      result.errors.push(
        `[${productName}/issues] invalid status in ${entry}: ${status[1].trim()} (only Open/未解決 allowed)`
      );
    }
  }
}

function validateIssueReadmeSync(productDir: string, productName: string, result: ValidationResult): void {
  const issuesDir = path.join(productDir, "issues");
  const readmePath = path.join(issuesDir, "README.md");
  if (!isFile(readmePath)) {
    result.errors.push(`[${productName}/issues] README.md is missing.`);
    return;
  }

  const actual = listDirEntries(issuesDir)
    .filter((entry) => entry.endsWith(".md") && entry !== "README.md")
    .sort();

  const readme = readFileSync(readmePath, "utf8");
  const listed = Array.from(readme.matchAll(/^- `([^`]+\.md)`/gm))
    .map((match) => match[1])
    .sort();

  for (const file of actual) {
    if (!listed.includes(file)) {
      result.errors.push(`[${productName}/issues] README.md is missing open issue entry: ${file}`);
    }
  }

  for (const file of listed) {
    if (!actual.includes(file)) {
      result.errors.push(`[${productName}/issues] README.md contains non-existent issue entry: ${file}`);
    }
  }
}

function validateStatus(productDir: string, productName: string, result: ValidationResult): void {
  const statusDir = path.join(productDir, "status");
  const entries = listDirEntries(statusDir).filter((entry) =>
    isFile(path.join(statusDir, entry))
  );

  for (const entry of entries) {
    if (entry !== "current.md") {
      result.errors.push(`[${productName}/status] only current.md is allowed. found: ${entry}`);
    }
  }
}

function validateNoRoadmap(docsDir: string, result: ValidationResult): void {
  const roadmapDir = path.join(docsDir, "roadmap");
  if (isDirectory(roadmapDir)) {
    result.errors.push("[docs] roadmap/ is deprecated and must not exist.");
  }

  for (const product of PRODUCTS) {
    const productRoadmapDir = path.join(docsDir, product.name, "roadmap");
    if (isDirectory(productRoadmapDir)) {
      result.errors.push(`[${product.name}] roadmap/ is deprecated and must not exist.`);
    }
  }
}

function validateH1(docsDir: string, result: ValidationResult): void {
  const files = walkFiles(docsDir).filter((file) => file.endsWith(".md"));
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    if (!/^#\s+.+$/m.test(content)) {
      result.errors.push(
        `[docs] missing H1 (# title): ${path.relative(docsDir, file)}`
      );
    }
  }
}

function validateReferenceAndArchitectureContent(
  productDir: string,
  productName: string,
  result: ValidationResult
): void {
  const targets = [
    path.join(productDir, "reference"),
    path.join(productDir, "architecture"),
  ];

  for (const dir of targets) {
    const files = walkFiles(dir).filter((file) => file.endsWith(".md"));
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      if (/\[[ xX]\]/.test(content)) {
        result.errors.push(
          `[${productName}/${path.relative(productDir, dir)}] checklist marker is forbidden outside plans/: ${path.relative(productDir, file)}`
        );
      }

      if (/\b(?:TODO|FIXME|TBD)\b/.test(content)) {
        result.errors.push(
          `[${productName}/${path.relative(productDir, dir)}] TODO/FIXME/TBD is forbidden: ${path.relative(productDir, file)}`
        );
      }
    }
  }
}

function main(): void {
  const docsDir = resolveDocsDir();
  const repoRoot = resolveTakosRepoRoot();
  const result: ValidationResult = { errors: [], warnings: [] };

  if (path.resolve(repoRoot, "docs") === docsDir) {
    validateRootDocsOnly(repoRoot, docsDir, result);
  }
  validateDocsTopLevelLayout(docsDir, result);
  validateH1(docsDir, result);
  validateDocsInternalLinks(docsDir, result);
  validateDocsScriptRefs(repoRoot, docsDir, result);
  validateNoRoadmap(docsDir, result);

  for (const product of PRODUCTS) {
    const productDir = path.join(docsDir, product.name);

    validateProductTopLevelLayout(productDir, product.name, result);
    validateArchitectureCanon(productDir, product.name, result);
    validateCategoryStructure(productDir, product.name, "reference", product.allowReferenceGitDir, result);
    validateCategoryStructure(productDir, product.name, "architecture", product.allowReferenceGitDir, result);
    validatePlans(productDir, product.name, result);
    validateIssues(productDir, product.name, result);
    validateIssueReadmeSync(productDir, product.name, result);
    validateStatus(productDir, product.name, result);
    validateReferenceAndArchitectureContent(productDir, product.name, result);
  }

  for (const warning of result.warnings) {
    console.warn(`WARN: ${warning}`);
  }

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      console.error(`ERROR: ${error}`);
    }
    process.exit(1);
  }

  console.log("docs validation passed.");
}

main();
