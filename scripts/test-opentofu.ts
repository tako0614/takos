import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const moduleRoot = join(root, "deploy", "opentofu", "cloudflare");
const fixtureRoot = join(moduleRoot, "fixtures", "generated-root");

await runTofu(
  ["init", "-backend=false", "-input=false", "-lockfile=readonly", "-no-color"],
  moduleRoot,
);
await runTofu(["test", "-no-color"], moduleRoot);

const generatedRoot = await mkdtemp(join(moduleRoot, ".generated-root-test-"));
try {
  await writeFile(
    join(generatedRoot, "main.tf"),
    await readFile(join(fixtureRoot, "main.tf.tmpl"), "utf8"),
  );
  await cp(
    join(fixtureRoot, "paths.tftest.hcl"),
    join(generatedRoot, "paths.tftest.hcl"),
  );
  await runTofu(
    ["init", "-backend=false", "-input=false", "-no-color"],
    generatedRoot,
  );
  await runTofu(["test", "-no-color"], generatedRoot);
} finally {
  await rm(generatedRoot, { recursive: true, force: true });
}

async function runTofu(args: readonly string[], cwd: string): Promise<void> {
  const process = Bun.spawn(["tofu", ...args], {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`tofu ${args[0] ?? "command"} failed with exit ${exitCode}`);
  }
}
