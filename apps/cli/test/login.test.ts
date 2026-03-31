import { Command } from "commander";

import { assertRejects } from "jsr:@std/assert";
import { assertSpyCallArgs, assertSpyCalls, stub } from "jsr:@std/testing/mock";

import { CliCommandExit } from "../src/lib/command-exit.ts";
import { withCliTestEnv } from "./test-support.ts";

type LoginModule = typeof import("../src/commands/login.ts");

Deno.test("login command - exits early in container mode", async () => {
  await withCliTestEnv(async ({ importFresh }) => {
    Deno.env.set("TAKOS_SESSION_ID", "550e8400-e29b-41d4-a716-446655440000");
    const { registerLoginCommand } = await importFresh<LoginModule>(
      "../src/commands/login.ts",
    );

    const logSpy = stub(console, "log", () => {});
    try {
      const program = new Command();
      registerLoginCommand(program);

      await program.parseAsync(["node", "takos", "login"]);

      assertSpyCalls(logSpy, 1);
      assertSpyCallArgs(logSpy, 0, [
        "Running in container mode - authentication is automatic",
      ]);
    } finally {
      logSpy.restore();
    }
  });
});

Deno.test("login command - rejects invalid API URLs before starting OAuth", async () => {
  await withCliTestEnv(async ({ importFresh }) => {
    const { registerLoginCommand } = await importFresh<LoginModule>(
      "../src/commands/login.ts",
    );

    const logSpy = stub(console, "log", () => {});
    try {
      const program = new Command();
      registerLoginCommand(program);

      await assertRejects(
        () =>
          program.parseAsync([
            "node",
            "takos",
            "login",
            "--api-url",
            "notaurl",
          ]),
        CliCommandExit,
      );

      assertSpyCalls(logSpy, 1);
      assertSpyCallArgs(logSpy, 0, ["Invalid API URL: Invalid API URL format"]);
    } finally {
      logSpy.restore();
    }
  });
});

Deno.test("logout command - clears stored credentials", async () => {
  await withCliTestEnv(async ({ importFresh }) => {
    const { registerLoginCommand } = await importFresh<LoginModule>(
      "../src/commands/login.ts",
    );

    const logSpy = stub(console, "log", () => {});
    try {
      const program = new Command();
      registerLoginCommand(program);

      await program.parseAsync(["node", "takos", "logout"]);

      assertSpyCallArgs(logSpy, 0, ["Logged out successfully"]);
    } finally {
      logSpy.restore();
    }
  });
});
