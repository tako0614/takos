import { assertEquals } from "jsr:@std/assert";

async function loadLoggingModule() {
  if (!Deno.env.get("TAKOS_API_URL")) {
    Deno.env.set("TAKOS_API_URL", "https://takos.example.test");
  }
  return await import("../../runtime/logging.ts");
}

Deno.test("pushLog - pushes a message to the log array", async () => {
  const { pushLog } = await loadLoggingModule();
  const logs: string[] = [];
  pushLog(logs, "hello");
  assertEquals(logs, ["hello"]);
});

Deno.test("pushLog - pushes multiple messages", async () => {
  const { pushLog } = await loadLoggingModule();
  const logs: string[] = [];
  pushLog(logs, "first");
  pushLog(logs, "second");
  assertEquals(logs, ["first", "second"]);
});

Deno.test("pushLog - truncates individual lines exceeding 10000 chars", async () => {
  const { pushLog } = await loadLoggingModule();
  const logs: string[] = [];
  const longLine = "x".repeat(15_000);
  pushLog(logs, longLine);
  assertEquals(logs[0].length, 10_000 + "...[truncated]".length);
  assertEquals(logs[0].endsWith("...[truncated]"), true);
});

Deno.test("pushLog - stops appending after MAX_LOG_LINES and adds truncation notice", async () => {
  const module = await loadLoggingModule();
  const originalMaxLogLines = module.loggingDeps.maxLogLines;
  module.loggingDeps.maxLogLines = 5;

  try {
    const logs: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      module.pushLog(logs, `line ${i}`);
    }
    assertEquals(logs.length, 6);
    assertEquals(logs[5], "...log truncated");
  } finally {
    module.loggingDeps.maxLogLines = originalMaxLogLines;
  }
});

Deno.test("pushLog - adds truncation notice only once", async () => {
  const module = await loadLoggingModule();
  const originalMaxLogLines = module.loggingDeps.maxLogLines;
  module.loggingDeps.maxLogLines = 5;

  try {
    const logs: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      module.pushLog(logs, `line ${i}`);
    }
    const truncationCount = logs.filter((line: string) =>
      line === "...log truncated"
    ).length;
    assertEquals(truncationCount, 1);
  } finally {
    module.loggingDeps.maxLogLines = originalMaxLogLines;
  }
});

Deno.test("pushLog - sanitizes message with provided sanitizer", async () => {
  const { pushLog } = await loadLoggingModule();
  const logs: string[] = [];
  const sanitizer = {
    sanitize: (text: string) => text.replace(/secret/g, "***"),
  };
  pushLog(logs, "my secret value", sanitizer as never);
  assertEquals(logs[0], "my *** value");
});

Deno.test("pushLog - works without sanitizer", async () => {
  const { pushLog } = await loadLoggingModule();
  const logs: string[] = [];
  pushLog(logs, "no sanitizer", undefined);
  assertEquals(logs[0], "no sanitizer");
});
