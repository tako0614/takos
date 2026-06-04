import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";

const nodeBuiltinAliases = Object.fromEntries(
  [...new Set(builtinModules.map((name) => name.replace(/^node:/, "")))]
    .filter((name) => name && !name.startsWith("_"))
    .map((name) => [name, `node:${name}`]),
);

/**
 * Bundles a container app (containers/<app>/src/index.ts) into a single
 * dist/index.js that `bun dist/index.js` can run inside the container image.
 *
 * The whole reachable source closure is bundled so the resulting dist/ has no
 * unresolved Takos source-path imports. tsconfig path aliases (if any) are
 * honoured for local source targets.
 */
export async function buildNodeApp({
  appDir,
  alias = {},
  external = [],
  loader = {},
}) {
  const repoRoot = resolve(appDir, "../..");
  const outputPath = resolve(appDir, "dist/index.js");
  const localImportAliases = await readTsconfigPathAliases(repoRoot);

  await build({
    entryPoints: [resolve(appDir, "src/index.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    outfile: outputPath,
    banner: {
      js:
        "import { Buffer as __Buffer } from 'node:buffer'; import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url); globalThis.Buffer ??= __Buffer;",
    },
    external,
    alias: {
      ...nodeBuiltinAliases,
      ...localImportAliases,
      ...alias,
    },
    loader,
    logLevel: "info",
  });

  const bundleText = await readFile(outputPath, "utf8");
  if (
    /(?:from|require\()\s*['"][^'"]*\/containers\/[^'"]*\/src\//.test(
      bundleText,
    )
  ) {
    throw new Error(
      "Build output still contains unresolved Takos container source import paths",
    );
  }

  console.log(`Build complete: ${outputPath}`);
}

async function readTsconfigPathAliases(repoRoot) {
  const tsconfig = JSON.parse(
    await readFile(resolve(repoRoot, "tsconfig.json"), "utf8"),
  );
  const paths = tsconfig?.compilerOptions?.paths &&
      typeof tsconfig.compilerOptions.paths === "object"
    ? tsconfig.compilerOptions.paths
    : {};
  return Object.fromEntries(
    Object.entries(paths)
      .filter(([specifier]) => !specifier.includes("*"))
      .map(([specifier, targets]) => [
        specifier,
        Array.isArray(targets) ? targets[0] : targets,
      ])
      .filter(([, target]) =>
        typeof target === "string" &&
        (target.startsWith("./") || target.startsWith("../"))
      )
      .map(([specifier, target]) => [specifier, resolve(repoRoot, target)]),
  );
}
