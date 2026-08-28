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
await assertWorkerDestroyDependencyGraph();

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

async function assertWorkerDestroyDependencyGraph(): Promise<void> {
  // `tofu graph -type=plan` emits create-time dependency arrows. OpenTofu
  // reverses those arrows during destroy, so the Worker identity must depend
  // directly on every resource whose binding can keep it undeletable.
  const graph = await runTofuCapture(
    [
      "graph",
      "-type=plan",
      "-draw-cycles",
      "-var=project_name=takos-destroy-order-graph",
      "-var=public_url=https://takos-destroy-order-graph.example.com",
      "-var=opentofu_plan_mode=true",
      '-var=cloudflare={account_id="00000000000000000000000000000000"}',
    ],
    moduleRoot,
  );
  const edges = new Set(
    [...graph.matchAll(/"([^"]+)"\s+->\s+"([^"]+)"/g)].map(
      ([, from, to]) => `${from} -> ${to}`,
    ),
  );
  const worker = '[root] module.platform.cloudflare_worker.app (expand)';
  const backingResources = [
    '[root] module.platform.cloudflare_d1_database.this (expand)',
    '[root] module.platform.cloudflare_workers_kv_namespace.this (expand)',
    '[root] module.platform.cloudflare_r2_bucket.this (expand)',
    '[root] module.platform.cloudflare_queue.this (expand)',
    '[root] module.platform.random_password.encryption (expand)',
    '[root] module.platform.random_password.agent_start (expand)',
    '[root] module.platform.random_password.internal_api (expand)',
    '[root] module.platform.tls_private_key.platform (expand)',
  ];
  const missing = backingResources.filter(
    (resource) => !edges.has(`${worker} -> ${resource}`),
  );
  if (missing.length > 0) {
    throw new Error(
      `Worker destroy dependency graph is missing direct edges:\n${missing
        .map((resource) => `  ${worker} -> ${resource}`)
        .join("\n")}`,
    );
  }
}

async function runTofuCapture(
  args: readonly string[],
  cwd: string,
): Promise<string> {
  const process = Bun.spawn(["tofu", ...args], {
    cwd,
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `tofu ${args[0] ?? "command"} failed with exit ${exitCode}: ${stderr.trim()}`,
    );
  }
  return stdout;
}
