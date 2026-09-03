import { test } from "bun:test";
import { assertEquals } from "@takos/test/assert";

import { selectInstallableSourcePathFromRepo } from "../opentofu-app-manifest.ts";

test("selectInstallableSourcePathFromRepo prefers OpenTofu module files", () => {
  assertEquals(
    selectInstallableSourcePathFromRepo(["package.json", "main.tf"]),
    "main.tf",
  );
  assertEquals(
    selectInstallableSourcePathFromRepo(["package.json", "opentofu/main.tf"]),
    "opentofu/main.tf",
  );
  assertEquals(
    selectInstallableSourcePathFromRepo(["package.json", "infra/outputs.tf"]),
    "infra/outputs.tf",
  );
  assertEquals(
    selectInstallableSourcePathFromRepo([
      "package.json",
      "deploy/opentofu/cloudflare/main.tf",
    ]),
    "deploy/opentofu/cloudflare/main.tf",
  );
  assertEquals(
    selectInstallableSourcePathFromRepo([
      "package.json",
      "deploy/opentofu/retired/main.tf.history",
    ]),
    null,
  );
  assertEquals(selectInstallableSourcePathFromRepo(["package.json"]), null);
});
