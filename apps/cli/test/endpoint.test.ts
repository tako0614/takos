import { Command } from "commander";
import { green } from "@std/fmt/colors";
import { assertEquals, assertRejects } from "@std/assert";
import { assertSpyCallArgs, assertSpyCalls, stub } from "@std/testing/mock";
import { CliCommandExit } from "../src/lib/command-exit.ts";
import { createCliTestEnv } from "./test-support.ts";

type EndpointModule = typeof import("../src/commands/endpoint.ts");

const endpointEnv = createCliTestEnv();
const endpointModulePromise = endpointEnv.importFresh<EndpointModule>(
  "../src/commands/endpoint.ts",
);

addEventListener("unload", () => {
  endpointEnv.dispose();
});

Deno.test("resolveEndpointTarget - maps preset names to canonical URLs", async () => {
  endpointEnv.reset();
  const { resolveEndpointTarget } = await endpointModulePromise;

  assertEquals(resolveEndpointTarget("prod"), "https://takos.jp");
  assertEquals(resolveEndpointTarget("production"), "https://takos.jp");
  assertEquals(resolveEndpointTarget("test"), "https://test.takos.jp");
  assertEquals(resolveEndpointTarget("staging"), "https://test.takos.jp");
  assertEquals(resolveEndpointTarget("local"), "http://localhost:8787");
});

Deno.test("resolveEndpointTarget - uses explicit URL as-is", async () => {
  endpointEnv.reset();
  const { resolveEndpointTarget } = await endpointModulePromise;

  assertEquals(
    resolveEndpointTarget("https://api.takos.dev"),
    "https://api.takos.dev",
  );
});

Deno.test("endpoint command - updates endpoint to test preset", async () => {
  endpointEnv.reset();
  const { registerEndpointCommand } = await endpointModulePromise;
  const logSpy = stub(console, "log", () => {});

  try {
    const program = new Command();
    registerEndpointCommand(program);

    await program.parseAsync(["node", "takos", "endpoint", "use", "test"]);

    assertEquals(endpointEnv.readConfig(), { apiUrl: "https://test.takos.jp" });
    assertSpyCallArgs(logSpy, 0, [
      green("Endpoint updated: https://test.takos.jp"),
    ]);
  } finally {
    logSpy.restore();
  }
});

Deno.test("endpoint command - updates endpoint to prod preset", async () => {
  endpointEnv.reset();
  const { registerEndpointCommand } = await endpointModulePromise;
  const logSpy = stub(console, "log", () => {});

  try {
    const program = new Command();
    registerEndpointCommand(program);

    await program.parseAsync(["node", "takos", "endpoint", "use", "prod"]);

    assertEquals(endpointEnv.readConfig(), { apiUrl: "https://takos.jp" });
    assertSpyCallArgs(logSpy, 0, [green("Endpoint updated: https://takos.jp")]);
  } finally {
    logSpy.restore();
  }
});

Deno.test("endpoint command - shows current endpoint", async () => {
  endpointEnv.reset();
  endpointEnv.writeConfig({ apiUrl: "https://test.takos.jp" });
  const { registerEndpointCommand } = await endpointModulePromise;
  const logSpy = stub(console, "log", () => {});

  try {
    const program = new Command();
    registerEndpointCommand(program);

    await program.parseAsync(["node", "takos", "endpoint", "show"]);

    assertSpyCallArgs(logSpy, 0, ["https://test.takos.jp"]);
  } finally {
    logSpy.restore();
  }
});

Deno.test("endpoint command - fails when running in container mode", async () => {
  endpointEnv.reset();
  Deno.env.set("TAKOS_SESSION_ID", "550e8400-e29b-41d4-a716-446655440000");
  const { registerEndpointCommand } = await endpointModulePromise;
  const logSpy = stub(console, "log", () => {});

  try {
    const program = new Command();
    registerEndpointCommand(program);

    await assertRejects(
      async () => {
        await program.parseAsync(["node", "takos", "endpoint", "use", "test"]);
      },
      CliCommandExit,
    );

    assertEquals(endpointEnv.readConfig(), null);
    assertSpyCalls(logSpy, 1);
  } finally {
    logSpy.restore();
  }
});
