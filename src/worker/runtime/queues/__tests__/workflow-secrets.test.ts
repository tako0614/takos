import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";
import {
  collectReferencedSecretNames,
  collectReferencedSecretNamesFromEnv,
} from "../workflow-secrets.ts";

test("collectReferencedSecretNames finds refs in job env AND every step (least-privilege completeness)", () => {
  const jobDefinition = {
    name: "build",
    "runs-on": "ubuntu-latest",
    env: { TOKEN: "${{ secrets.JOB_TOKEN }}" },
    steps: [
      { run: "echo ${{ secrets.RUN_SECRET }}" },
      {
        uses: "some/action",
        with: { key: "${{ secrets.WITH_SECRET }}" },
        env: { STEP_ENV: "${{ secrets.STEP_ENV_SECRET }}" },
      },
    ],
    outputs: { out: "${{ secrets.OUTPUT_SECRET }}" },
  };
  const effectiveJobEnv = { TOKEN: "${{ secrets.JOB_TOKEN }}" };

  const names = collectReferencedSecretNames(jobDefinition, effectiveJobEnv);

  // Must catch references in env, step.run, step.with, step.env, and outputs.
  assertEquals(names, [
    "JOB_TOKEN",
    "OUTPUT_SECRET",
    "RUN_SECRET",
    "STEP_ENV_SECRET",
    "WITH_SECRET",
  ]);
});

test("collectReferencedSecretNames returns empty when nothing references secrets", () => {
  const names = collectReferencedSecretNames(
    { steps: [{ run: "echo hello" }], env: { A: "b" } },
    { A: "b" },
  );
  assertEquals(names, []);
});

test("collectReferencedSecretNames ignores null/undefined sources", () => {
  const names = collectReferencedSecretNames(
    undefined,
    null,
    "use ${{ secrets.ONLY }}",
  );
  assertEquals(names, ["ONLY"]);
});

test("collectReferencedSecretNamesFromEnv still scans only the env block", () => {
  const names = collectReferencedSecretNamesFromEnv({
    A: "${{ secrets.ENV_ONLY }}",
    B: "plain",
  });
  assertEquals(names, ["ENV_ONLY"]);
});
