// deno-lint-ignore-file no-import-prefix no-unversioned-import no-explicit-any
import {
  createLogger,
  logDebug,
  logError,
  logInfo,
  logWarn,
  safeJsonParse,
  safeJsonParseOrDefault,
} from "../../../../../packages/control/src/shared/utils/logger.ts";

import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert";
import { assertSpyCalls, stub } from "jsr:@std/testing/mock";

function withConsoleStub<K extends "debug" | "info" | "warn" | "error">(
  method: K,
  fn: (spy: any) => void,
) {
  const spy = stub(console as any, method as any, (() => undefined) as any);
  try {
    fn(spy);
  } finally {
    spy.restore();
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
  withConsoleStub("debug", (spy) => {
    logDebug("test message");
    assertSpyCalls(spy, 1);

    const entry = JSON.parse(spy.calls[0].args[0] as string);
    assertEquals(entry.level, "debug");
    assertEquals(entry.message, "test message");
    assert(entry.timestamp);
  });
});

Deno.test("logDebug - includes context in log entry", () => {
  withConsoleStub("debug", (spy) => {
    logDebug("msg", { requestId: "123", action: "test" });
    const entry = JSON.parse(spy.calls[0].args[0] as string);
    assertEquals(entry.context.requestId, "123");
    assertEquals(entry.context.action, "test");
  });
});

Deno.test('logInfo - calls console.info with level "info"', () => {
  withConsoleStub("info", (spy) => {
    logInfo("info message");
    const entry = JSON.parse(spy.calls[0].args[0] as string);
    assertEquals(entry.level, "info");
  });
});

Deno.test('logWarn - calls console.warn with level "warn"', () => {
  withConsoleStub("warn", (spy) => {
    logWarn("warning");
    const entry = JSON.parse(spy.calls[0].args[0] as string);
    assertEquals(entry.level, "warn");
  });
});

Deno.test('logError - calls console.error with level "error"', () => {
  withConsoleStub("error", (spy) => {
    logError("error occurred");
    const entry = JSON.parse(spy.calls[0].args[0] as string);
    assertEquals(entry.level, "error");
    assertEquals(entry.message, "error occurred");
  });
});

Deno.test("logError - includes error details when Error object is passed", () => {
  withConsoleStub("error", (spy) => {
    logError("failed", new Error("test error"));
    const entry = JSON.parse(spy.calls[0].args[0] as string);
    assertEquals(entry.error.name, "Error");
    assertEquals(entry.error.message, "test error");
  });
});

Deno.test("logError - handles non-Error error values", () => {
  withConsoleStub("error", (spy) => {
    logError("failed", "string error");
    const entry = JSON.parse(spy.calls[0].args[0] as string);
    assertEquals(entry.context.errorValue, "string error");
  });
});

Deno.test("logError - masks sensitive data in messages (API keys)", () => {
  withConsoleStub("error", (spy) => {
    logError("api_key=sk-1234567890abcdef1234567890abcdef");
    const entry = JSON.parse(spy.calls[0].args[0] as string);
    assert(
      !(entry.message as string).includes(
        "sk-1234567890abcdef1234567890abcdef",
      ),
    );
    assertStringIncludes(entry.message, "[REDACTED");
  });
});

Deno.test("logError - masks Bearer tokens", () => {
  withConsoleStub("error", (spy) => {
    logError(
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    );
    const entry = JSON.parse(spy.calls[0].args[0] as string);
    assert(!(entry.message as string).includes("eyJhbGciOiJ"));
  });
});

Deno.test("logError - masks sensitive keys in context objects", () => {
  withConsoleStub("error", (spy) => {
    logError(
      "test",
      undefined,
      { password: "secret123", userId: "user-1" } as any,
    );
    const entry = JSON.parse(spy.calls[0].args[0] as string);
    assertEquals(entry.context.password, "[REDACTED]");
    assertEquals(entry.context.userId, "user-1");
  });
});

Deno.test("logError - masks email addresses in messages", () => {
  withConsoleStub("error", (spy) => {
    logError("User user@example.com failed");
    const entry = JSON.parse(spy.calls[0].args[0] as string);
    assertStringIncludes(entry.message, "***@example.com");
    assert(!(entry.message as string).includes("user@example.com"));
  });
});

Deno.test("createLogger - creates a logger with base context merged into all calls", () => {
  withConsoleStub("info", (spy) => {
    const logger = createLogger({ module: "test-module" });
    logger.info("hello");
    const entry = JSON.parse(spy.calls[0].args[0] as string);
    assertEquals(entry.context.module, "test-module");
  });
});

Deno.test("createLogger - allows per-call context to override base context", () => {
  withConsoleStub("info", (spy) => {
    const logger = createLogger({ module: "base", action: "default" });
    logger.info("hello", { action: "override" });
    const entry = JSON.parse(spy.calls[0].args[0] as string);
    assertEquals(entry.context.module, "base");
    assertEquals(entry.context.action, "override");
  });
});

Deno.test("createLogger - has debug, info, warn, and error methods", () => {
  const logger = createLogger({ module: "test" });
  assertEquals(typeof logger.debug, "function");
  assertEquals(typeof logger.info, "function");
  assertEquals(typeof logger.warn, "function");
  assertEquals(typeof logger.error, "function");
});

Deno.test("createLogger - error method includes error details", () => {
  withConsoleStub("error", (spy) => {
    const logger = createLogger({ module: "test" });
    logger.error("failed", new Error("boom"));
    const entry = JSON.parse(spy.calls[0].args[0] as string);
    assertEquals(entry.error.message, "boom");
    assertEquals(entry.context.module, "test");
  });
});
