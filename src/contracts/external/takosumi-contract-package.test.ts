import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

/**
 * What takos can check about the contract package it consumes.
 *
 * A published package can ship a module and still make it unimportable, by
 * leaving it out of `exports` — that is how `@takosjp/yurucommu-core@4.1.5`
 * shipped a `./client-api` entry that throws `ERR_MODULE_NOT_FOUND`. The same
 * shape here would break takos at runtime while every local typecheck passed,
 * because TypeScript resolves through `paths` and `node_modules` layout rather
 * than through the export map.
 *
 * So this asserts a relation rather than a list: every specifier takos
 * actually imports must resolve through the installed package's own export
 * map, and the installed major must be the one the range declares.
 */

const root = new URL("../../../", import.meta.url);
const PACKAGE = "@takosjp/takosumi-contract";

const packageJson = JSON.parse(
  await readFile(new URL("package.json", root), "utf8"),
) as { dependencies?: Record<string, string> };

const installed = JSON.parse(
  await readFile(
    new URL(`node_modules/${PACKAGE}/package.json`, root),
    "utf8",
  ),
) as {
  version: string;
  exports?: Record<string, string>;
  files?: string[];
};

/** Tracked source files, minus comments, so prose naming the package is not an import. */
async function importedSpecifiers(): Promise<string[]> {
  const listed = spawnSync(
    "git",
    ["ls-files", "-z", "--", "src", "web/src", "scripts"],
    { cwd: new URL(".", root).pathname, encoding: "utf8" },
  );
  if (listed.status !== 0) throw new Error("could not list repository files");
  const files = listed.stdout
    .split("\0")
    .filter((path) => /\.tsx?$/u.test(path));
  const found = new Set<string>();
  const specifier = new RegExp(
    `(?:from|import\\()\\s*["'](${PACKAGE}(?:/[a-z-]+)?)["']`,
    "gu",
  );
  for (const file of files) {
    const source = (await readFile(new URL(file, root), "utf8"))
      .replaceAll(/\/\*[\s\S]*?\*\//gu, "")
      .replaceAll(/^\s*\/\/.*$/gmu, "");
    for (const match of source.matchAll(specifier)) found.add(match[1]!);
  }
  return [...found].sort();
}

test("the declared range and the installed package share one major", () => {
  const declared = packageJson.dependencies?.[PACKAGE];
  expect(declared, `${PACKAGE} must be a declared dependency`).toBeDefined();
  const declaredMajor = declared!.replace(/^[^0-9]*/u, "").split(".")[0];
  const installedMajor = installed.version.split(".")[0];
  expect(
    installedMajor,
    `${PACKAGE} resolves to ${installed.version}, which is not the major ${declared} declares`,
  ).toBe(declaredMajor);
});

test("every contract module takos imports is exported by the package", async () => {
  const specifiers = await importedSpecifiers();
  expect(
    specifiers.length,
    "no contract import was found; the scan is broken, not the package",
  ).toBeGreaterThan(0);
  const exported = new Set(Object.keys(installed.exports ?? {}));
  const unimportable = specifiers.filter((specifier) => {
    const subpath = specifier.slice(PACKAGE.length);
    return !exported.has(subpath === "" ? "." : `.${subpath}`);
  });
  expect(
    unimportable,
    "these modules are imported but not in the package's export map; they would throw ERR_PACKAGE_PATH_NOT_EXPORTED at runtime",
  ).toEqual([]);
});

test("every exported contract module is actually shipped", () => {
  const files = new Set(installed.files ?? []);
  const missing = Object.entries(installed.exports ?? {})
    .map(([, target]) => target.replace(/^\.\//u, ""))
    .filter((target) => !files.has(target));
  expect(
    missing,
    "the package exports a module it does not ship, which is an ERR_MODULE_NOT_FOUND on first import",
  ).toEqual([]);
});
