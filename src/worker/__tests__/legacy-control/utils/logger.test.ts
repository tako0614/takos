// deno-lint-ignore-file no-import-prefix no-unversioned-import
import {
  logDebug,
  logError,
  logInfo,
  logWarn,
  safeJsonParse,
  safeJsonParseOrDefault,
} from "../../../shared/utils/logger.ts";
import type { LogContext } from "../../../shared/utils/logger.ts";

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { assertSpyCalls, stub } from "@std/testing/mock";

type ConsoleMethod = "debug" | "info" | "warn" | "error";

function withConsoleStub<K extends ConsoleMethod>(
  method: K,
  fn: (consoleStub: ReturnType<typeof stub<Console, K>>) => void,
) {
  const consoleStub = stub(console, method);
  try {
    fn(consoleStub);
  } finally {
    consoleStub.restore();
  }
}

Deno.test("safeJsonParse - parses valid JSON string", () => {
  assertEquals(safeJsonParse('{"key":"value"}'), { key: "value" });
});

Deno.test("safeJsonParse - returns null for null input", () => {
  assertEquals(safeJsonParse(null), null);
});

Deno.test("safeJsonParse - returns null for undefined input", () => {
  assertEquals(safeJsonParse(undefined), null);
});

Deno.test("safeJsonParse - returns the object directly when input is already an object", () => {
  const obj = { key: "value" };
  assertEquals(safeJsonParse(obj), obj);
});

Deno.test("safeJsonParse - returns null for invalid JSON string", () => {
  assertEquals(safeJsonParse("not json"), null);
});

Deno.test("safeJsonParse - returns null for non-string, non-object input (number)", () => {
  assertEquals(safeJsonParse(42), null);
});

Deno.test("safeJsonParse - returns null for boolean input", () => {
  assertEquals(safeJsonParse(true), null);
});

Deno.test("safeJsonParse - parses JSON array", () => {
  assertEquals(safeJsonParse("[1,2,3]"), [1, 2, 3]);
});

Deno.test("safeJsonParse - parses JSON number string", () => {
  assertEquals(safeJsonParse("42"), 42);
});

Deno.test("safeJsonParse - accepts string context parameter", () => {
  assertEquals(safeJsonParse("{}", "test-context"), {});
});

Deno.test("safeJsonParse - accepts object context parameter", () => {
  assertEquals(safeJsonParse("{}", { service: "test", field: "data" }), {});
});

Deno.test("safeJsonParseOrDefault - returns parsed value when input is valid JSON", () => {
  assertEquals(safeJsonParseOrDefault('{"a":1}', { a: 0 }), { a: 1 });
});

Deno.test("safeJsonParseOrDefault - returns fallback when input is invalid JSON", () => {
  assertEquals(safeJsonParseOrDefault("not json", "default"), "default");
});

Deno.test("safeJsonParseOrDefault - returns fallback when input is null", () => {
  assertEquals(safeJsonParseOrDefault(null, "fallback"), "fallback");
});

Deno.test("safeJsonParseOrDefault - returns fallback when input is undefined", () => {
  assertEquals(safeJsonParseOrDefault(undefined, []), []);
});

Deno.test("safeJsonParseOrDefault - does not return fallback when parsed value is falsy but valid", () => {
  assertEquals(safeJsonParseOrDefault("0", 42), 0);
  assertEquals(safeJsonParseOrDefault("false", true), false);
  assertEquals(safeJsonParseOrDefault('""', "default"), "");
});

Deno.test("logDebug - calls console.debug with structured JSON", () => {
  withConsoleStub("debug", (consoleStub) => {
    logDebug("test message");
    assertSpyCalls(consoleStub, 1);

    const entry = JSON.parse(String(consoleStub.calls[0].args[0]));
    assertEquals(entry.level, "debug");
    assertEquals(entry.message, "test message");
    assert(entry.timestamp);
  });
});

Deno.test("logDebug - includes context in log entry", () => {
  withConsoleStub("debug", (consoleStub) => {
    logDebug("msg", { requestId: "123", action: "test" });
    const entry = JSON.parse(String(consoleStub.calls[0].args[0]));
    assertEquals(entry.context.requestId, "123");
    assertEquals(entry.context.action, "test");
  });
});

Deno.test('logInfo - calls console.info with level "info"', () => {
  withConsoleStub("info", (consoleStub) => {
    logInfo("info message");
    const entry = JSON.parse(String(consoleStub.calls[0].args[0]));
    assertEquals(entry.level, "info");
  });
});

Deno.test('logWarn - calls console.warn with level "warn"', () => {
  withConsoleStub("warn", (consoleStub) => {
    logWarn("warning");
    const entry = JSON.parse(String(consoleStub.calls[0].args[0]));
    assertEquals(entry.level, "warn");
  });
});

Deno.test('logError - calls console.error with level "error"', () => {
  withConsoleStub("error", (consoleStub) => {
    logError("error occurred");
    const entry = JSON.parse(String(consoleStub.calls[0].args[0]));
    assertEquals(entry.level, "error");
    assertEquals(entry.message, "error occurred");
  });
});

Deno.test("logError - includes error details when Error object is passed", () => {
  withConsoleStub("error", (consoleStub) => {
    logError("failed", new Error("test error"));
    const entry = JSON.parse(String(consoleStub.calls[0].args[0]));
    assertEquals(entry.error.name, "Error");
    assertEquals(entry.error.message, "test error");
  });
});

Deno.test("logError - handles non-Error error values", () => {
  withConsoleStub("error", (consoleStub) => {
    logError("failed", "string error");
    const entry = JSON.parse(String(consoleStub.calls[0].args[0]));
    assertEquals(entry.context.errorValue, "string error");
  });
});

Deno.test("logError - masks sensitive data in messages (API keys)", () => {
  withConsoleStub("error", (consoleStub) => {
    logError("api_key=sk-1234567890abcdef1234567890abcdef");
    const entry = JSON.parse(String(consoleStub.calls[0].args[0]));
    assert(
      !(entry.message as string).includes(
        "sk-1234567890abcdef1234567890abcdef",
      ),
    );
    assertStringIncludes(entry.message, "[REDACTED");
  });
});

Deno.test("logError - masks Bearer tokens", () => {
  withConsoleStub("error", (consoleStub) => {
    logError(
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    );
    const entry = JSON.parse(String(consoleStub.calls[0].args[0]));
    assert(!(entry.message as string).includes("eyJhbGciOiJ"));
  });
});

Deno.test("logError - masks sensitive keys in context objects", () => {
  withConsoleStub("error", (consoleStub) => {
    // The LogContext type permits arbitrary keys via the index signature, so
    // `password` is valid without an explicit cast.
    const context: LogContext = { password: "secret123", userId: "user-1" };
    logError("test", undefined, context);
    const entry = JSON.parse(String(consoleStub.calls[0].args[0]));
    assertEquals(entry.context.password, "[REDACTED]");
    assertEquals(entry.context.userId, "user-1");
  });
});

Deno.test("logError - masks email addresses in messages", () => {
  withConsoleStub("error", (consoleStub) => {
    logError("User user@example.com failed");
    const entry = JSON.parse(String(consoleStub.calls[0].args[0]));
    assertStringIncludes(entry.message, "***@example.com");
    assert(!(entry.message as string).includes("user@example.com"));
  });
});
