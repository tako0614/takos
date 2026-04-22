import { diffLinesLcs } from "@/utils/lcs-diff";

import { assertEquals } from "jsr:@std/assert";

Deno.test("diffLinesLcs - produces equal ops for identical input", () => {
  const ops = diffLinesLcs(["a", "b"], ["a", "b"]);
  assertEquals(ops, [
    { type: "equal", line: "a" },
    { type: "equal", line: "b" },
  ]);
});
Deno.test("diffLinesLcs - handles insertion", () => {
  const ops = diffLinesLcs(["a", "c"], ["a", "b", "c"]);
  assertEquals(ops, [
    { type: "equal", line: "a" },
    { type: "insert", line: "b" },
    { type: "equal", line: "c" },
  ]);
});
Deno.test("diffLinesLcs - handles deletion", () => {
  const ops = diffLinesLcs(["a", "b", "c"], ["a", "c"]);
  assertEquals(ops, [
    { type: "equal", line: "a" },
    { type: "delete", line: "b" },
    { type: "equal", line: "c" },
  ]);
});
