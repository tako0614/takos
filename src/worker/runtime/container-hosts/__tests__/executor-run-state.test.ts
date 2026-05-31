import { assertEquals } from "@std/assert";
import { readRunBootstrapInstallationContext } from "../executor-run-state.ts";

Deno.test("readRunBootstrapInstallationContext extracts install namespace context", () => {
  assertEquals(
    readRunBootstrapInstallationContext(JSON.stringify({
      installationId: " inst_1 ",
      runtimeNamespace: " shared-cell://tokyo-cell-01/namespaces/inst_1 ",
    })),
    {
      installationId: "inst_1",
      runtimeNamespace: "shared-cell://tokyo-cell-01/namespaces/inst_1",
    },
  );
});

Deno.test("readRunBootstrapInstallationContext supports nested Accounts materialization context", () => {
  assertEquals(
    readRunBootstrapInstallationContext(JSON.stringify({
      accounts: { installationId: "inst_nested" },
      runtimeBinding: {
        target_id: "shared-cell://tokyo-cell-01/namespaces/inst_nested",
      },
    })),
    {
      installationId: "inst_nested",
      runtimeNamespace: "shared-cell://tokyo-cell-01/namespaces/inst_nested",
    },
  );
});

Deno.test("readRunBootstrapInstallationContext ignores invalid run input", () => {
  assertEquals(readRunBootstrapInstallationContext("{not json"), {});
  assertEquals(readRunBootstrapInstallationContext(JSON.stringify([])), {});
  assertEquals(readRunBootstrapInstallationContext(null), {});
});
