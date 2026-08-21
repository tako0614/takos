import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })));
});

test("Takosumi deploy wrapper separates reviewable plan from explicit apply", async () => {
  const root = await mkdtemp(join(tmpdir(), "takosumi-deploy-test-"));
  roots.push(root);
  const bin = join(root, "bin");
  await mkdir(bin);
  const log = join(root, "curl.log");
  const curl = join(bin, "curl");
  await writeFile(
    curl,
    `#!/usr/bin/env bash
printf '%s\n' "$*" >> "$CURL_LOG"
if [[ "$*" == *'/api/v1/runs/run_plan_1/apply'* ]]; then
  printf '%s\n200' '{"run":{"id":"run_apply_1"}}'
else
  printf '%s\n200' '{"run":{"id":"run_plan_1"},"status":"waiting_approval"}'
fi
`,
  );
  await chmod(curl, 0o755);

  const script = resolve(import.meta.dir, "takosumi-deploy.sh");
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    CURL_LOG: log,
    TAKOSUMI_URL: "https://takosumi.example.test",
    TAKOSUMI_TOKEN: "test-secret-token",
    TAKOSUMI_CAPSULE_ID: "cap_1",
  };

  const planned = spawnSync("bash", [script], { env, encoding: "utf8" });
  expect(planned.status).toBe(0);
  expect(planned.stdout).toContain("Plan Run run_plan_1 is ready for review");
  expect(planned.stdout).not.toContain("Applying reviewed plan Run");
  expect(planned.stdout).not.toContain("test-secret-token");
  expect(await readFile(log, "utf8")).toContain(
    "https://takosumi.example.test/api/v1/capsules/cap_1/plan",
  );

  await writeFile(log, "");
  const applied = spawnSync("bash", [script, "--apply-run", "run_plan_1"], {
    env,
    encoding: "utf8",
  });
  expect(applied.status).toBe(0);
  expect(applied.stdout).toContain("Applying reviewed plan Run run_plan_1");
  expect(applied.stdout).not.toContain("Triggering plan Run");
  expect(applied.stdout).not.toContain("test-secret-token");
  expect(await readFile(log, "utf8")).toContain(
    "https://takosumi.example.test/api/v1/runs/run_plan_1/apply",
  );
});
