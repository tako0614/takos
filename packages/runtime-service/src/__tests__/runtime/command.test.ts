import { assert, assertEquals } from "jsr:@std/assert";

const originalAwsSecret = Deno.env.get("AWS_SECRET_ACCESS_KEY");
const originalTakosApiUrl = Deno.env.get("TAKOS_API_URL");

function restoreEnv(name: string, original: string | undefined): void {
  if (original === undefined) {
    Deno.env.delete(name);
    return;
  }
  Deno.env.set(name, original);
}

Deno.test("runCommand - does not inherit host AWS secrets", async () => {
  const cwd = await Deno.makeTempDir();
  try {
    Deno.env.set("TAKOS_API_URL", "https://takos.example.test");
    Deno.env.set("AWS_SECRET_ACCESS_KEY", "host-secret-value");
    const logs: string[] = [];
    const { runCommand } = await import("../../runtime/command.ts");

    const exitCode = await runCommand(
      "bash",
      ["-c", 'echo "${AWS_SECRET_ACCESS_KEY:-missing}"'],
      { cwd, logs, timeoutMs: 5_000 },
    );

    assertEquals(exitCode, 0);
    assert(logs.includes("missing"));
    assert(!logs.includes("host-secret-value"));
  } finally {
    await Deno.remove(cwd, { recursive: true });
    restoreEnv("TAKOS_API_URL", originalTakosApiUrl);
    restoreEnv("AWS_SECRET_ACCESS_KEY", originalAwsSecret);
  }
});
