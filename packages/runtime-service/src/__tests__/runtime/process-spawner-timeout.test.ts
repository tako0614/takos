import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { assertEquals, assertRejects } from "jsr:@std/assert";

async function loadProcessSpawner() {
  Deno.env.set("TAKOS_API_URL", "https://takos.example.test");
  return await import("../../runtime/actions/process-spawner.ts");
}

Deno.test(
  "spawnWithTimeout kills Unix process groups on timeout so grandchildren do not survive",
  async () => {
    if (Deno.build.os === "windows") {
      return;
    }

    const { spawnWithTimeout } = await loadProcessSpawner();
    const workspacePath = await fs.mkdtemp(
      path.join(os.tmpdir(), "takos-timeout-"),
    );
    const markerPath = path.join(workspacePath, "survivor.txt");
    const script = `nohup sh -c 'sleep 1; printf survived > "$1"' sh ${
      JSON.stringify(markerPath)
    } >/dev/null 2>&1 & sleep 60`;

    try {
      const result = await spawnWithTimeout(
        "sh",
        ["-c", script],
        {
          timeout: 100,
          cwd: workspacePath,
        },
        {
          env: {},
          logs: [],
          outputs: {},
          workspacePath,
          parseWorkflowCommands: () => {},
          parseKeyValueFile: () => ({}),
          parsePathFile: () => [],
        },
      );

      assertEquals(result.exitCode, 124);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await assertRejects(() => fs.readFile(markerPath, "utf-8"));
    } finally {
      await fs.rm(workspacePath, { recursive: true, force: true });
    }
  },
);
