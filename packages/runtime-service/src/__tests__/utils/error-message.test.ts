import { getErrorMessage } from "takos-common/errors";

import { assertEquals } from "jsr:@std/assert";

Deno.test("getErrorMessage - returns message from Error instance", () => {
  assertEquals(getErrorMessage(new Error("test error")), "test error");
});
Deno.test("getErrorMessage - returns string representation for non-Error", () => {
  assertEquals(getErrorMessage("string error"), "string error");
});
Deno.test("getErrorMessage - handles number", () => {
  assertEquals(getErrorMessage(42), "42");
});
Deno.test("getErrorMessage - handles null", () => {
  assertEquals(getErrorMessage(null), "null");
});
Deno.test("getErrorMessage - handles undefined", () => {
  assertEquals(getErrorMessage(undefined), "undefined");
});
Deno.test("getErrorMessage - handles object", () => {
  assertEquals(getErrorMessage({ code: "ERR" }), "[object Object]");
});
Deno.test("getErrorMessage - returns message from custom error class", () => {
  class CustomError extends Error {
    constructor() {
      super("custom message");
      this.name = "CustomError";
    }
  }
  assertEquals(getErrorMessage(new CustomError()), "custom message");
});
