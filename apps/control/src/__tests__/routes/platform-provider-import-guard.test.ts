import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertEquals } from "jsr:@std/assert";

const thisDir = dirname(fileURLToPath(import.meta.url));
const controlSrcRoot = resolve(
  thisDir,
  "..",
  "..",
  "..",
  "..",
  "..",
  ["packages", "control", "src"].join("/"),
);
const routesRoot = resolve(controlSrcRoot, "server/routes");
const forbiddenImportPatterns = [
  /application\/services\/wfp(?=['"])/,
  /application\/services\/cloudflare\//,
  /@cloudflare\/containers/,
];

function collectTypeScriptFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(entryPath));
      continue;
    }
    if (entry.isFile() && extname(entry.name) === ".ts") {
      files.push(entryPath);
    }
  }
  return files;
}

Deno.test("server routes provider import guard - does not import cloudflare service internals or container runtime directly", () => {
  const offenders = collectTypeScriptFiles(routesRoot)
    .map((filePath) => {
      const source = readFileSync(filePath, "utf8");
      const matches = forbiddenImportPatterns
        .filter((pattern) => pattern.test(source))
        .map((pattern) => pattern.source);
      return matches.length > 0 ? { filePath, matches } : null;
    })
    .filter((value): value is { filePath: string; matches: string[] } =>
      value !== null
    );

  assertEquals(offenders, []);
});
