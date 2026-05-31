import { deepStrictEqual } from 'node:assert/strict';
import { test } from 'bun:test';
import { CUSTOM_TOOLS } from "../../../../worker/application/tools/custom/index.ts";
import { listCustomTools } from "./catalog.ts";

test("src/routes/public custom tool catalog matches control definition registry", () => {
  deepStrictEqual(
    listCustomTools(),
    CUSTOM_TOOLS.map((tool) => ({
      id: tool.name,
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
      enabled: true,
      type: "custom",
      bundleDeploymentId: null,
    })),
  );
});
