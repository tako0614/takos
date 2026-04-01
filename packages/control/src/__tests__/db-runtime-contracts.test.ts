import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assertEquals } from "jsr:@std/assert";

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const bannedPatterns = [
  { label: "legacy spaces.kind column", regex: /\bspaces\.kind\b/ },
  { label: "legacy spaces kind SQL alias", regex: /\b(?:s|sp|w)\.kind\b/ },
  {
    label: "legacy spaces.owner_principal_id column",
    regex: /\bspaces\.owner_principal_id\b/,
  },
  { label: "legacy spaces.owner_id column", regex: /\bspaces\.owner_id\b/ },
  {
    label: "legacy managed_takos_tokens.subject_principal_id column",
    regex: /\bsubject_principal_id\b/,
  },
  {
    label: "legacy threads.project_id column",
    regex: /\bthreads\.project_id\b/,
  },
  { label: "legacy shared Tenant type", regex: /\bexport interface Tenant\b/ },
  {
    label: "legacy shared Project type",
    regex: /\bexport interface Project\b/,
  },
  { label: "legacy project_id placeholder field", regex: /\bproject_id\b/ },
  {
    label: "legacy user.id principal fallback",
    regex: /\bprincipal_id\s*\|\|\s*user\.id\b/,
  },
  {
    label: "legacy targetUser.id principal fallback",
    regex: /\bprincipal_id\s*\|\|\s*targetUser\.id\b/,
  },
];

function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir).sort();
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = resolve(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }
    if (!fullPath.endsWith(".ts") || fullPath.endsWith(".test.ts")) {
      continue;
    }
    files.push(fullPath);
  }

  return files;
}

Deno.test("DB runtime contract guard - does not reference removed legacy schema columns in runtime source", () => {
  const files = collectSourceFiles(srcRoot);
  const offenders: string[] = [];

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const { label, regex } of bannedPatterns) {
      if (regex.test(source)) {
        offenders.push(`${label}: ${file}`);
      }
    }
  }

  assertEquals(offenders, []);
});
