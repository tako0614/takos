import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

// The takos.jp marketing site must only deep-link to the Takosumi platform
// worker's real bare origin (app.takosumi.com / app.takosumi.test). Retired
// account-plane hosts and install-wizard query params have shipped as live CTAs
// before and silently produced links that 404.
// This guard fails when any of those forbidden tokens re-enter the takos.jp
// website source or its static assets (CSP allowlist in public/_headers
// included) so a dead CTA or stale connect-src can never reach production.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const retiredAccountsHost = ["accounts", "takosumi", "com"].join(".");
const retiredSharedCellMode = ["mode", "shared-cell"].join("=");
const scanDirs = [
  resolve(repoRoot, "website/src"),
  resolve(repoRoot, "website/public"),
];

// Each rule: a token that must never appear, plus a human reason.
const forbidden = [
  { token: retiredAccountsHost, reason: "dead account-plane host" },
  {
    token: "accounts.takosumi.test",
    reason: "dead host — use app.takosumi.test",
  },
  { token: "shared-cell", reason: "dead install-wizard mode value" },
  { token: retiredSharedCellMode, reason: "dead install-wizard param" },
  {
    token: "/takos/start",
    reason: "dead deep-link path — use /install?git=...",
  },
  { token: "takos_url=", reason: "dead install-wizard param takos_url" },
];

async function collectFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

const files = [];
for (const dir of scanDirs) {
  files.push(...(await collectFiles(dir)));
}
const violations = [];

for (const filePath of files) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    continue;
  }
  const relPath = relative(repoRoot, filePath);
  const lines = text.split("\n");
  for (const rule of forbidden) {
    lines.forEach((line, idx) => {
      if (line.includes(rule.token)) {
        violations.push({ relPath, line: idx + 1, rule });
      }
    });
  }
}

if (violations.length > 0) {
  for (const v of violations) {
    console.error(
      `${v.relPath}:${v.line} forbidden token "${v.rule.token}" (${v.rule.reason})`,
    );
  }
  console.error(
    `\nwebsite host-drift check FAILED: ${violations.length} forbidden token(s) found.`,
  );
  process.exit(1);
}

console.log("website host-drift check passed");
