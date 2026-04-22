import {
  parseKeyValueFile,
  parsePathFile,
} from "../../runtime/actions/file-parsers.ts";

// ---------------------------------------------------------------------------
// parseKeyValueFile
// ---------------------------------------------------------------------------

import { assertEquals } from "jsr:@std/assert";

Deno.test("parseKeyValueFile - parses simple key=value pairs", () => {
  assertEquals(parseKeyValueFile("KEY=value"), { KEY: "value" });
});
Deno.test("parseKeyValueFile - parses multiple key=value pairs", () => {
  const content = "KEY1=value1\nKEY2=value2\nKEY3=value3";
  assertEquals(parseKeyValueFile(content), {
    KEY1: "value1",
    KEY2: "value2",
    KEY3: "value3",
  });
});
Deno.test("parseKeyValueFile - handles empty value", () => {
  assertEquals(parseKeyValueFile("KEY="), { KEY: "" });
});
Deno.test("parseKeyValueFile - handles value containing equals sign", () => {
  assertEquals(parseKeyValueFile("KEY=a=b=c"), { KEY: "a=b=c" });
});
Deno.test("parseKeyValueFile - handles heredoc format", () => {
  const content = "OUTPUT<<EOF\nline1\nline2\nEOF";
  assertEquals(parseKeyValueFile(content), { OUTPUT: "line1\nline2" });
});
Deno.test("parseKeyValueFile - handles heredoc with custom delimiter", () => {
  const content = "DATA<<DELIM\ncontent here\nDELIM";
  assertEquals(parseKeyValueFile(content), { DATA: "content here" });
});
Deno.test("parseKeyValueFile - handles empty heredoc", () => {
  const content = "EMPTY<<EOF\nEOF";
  assertEquals(parseKeyValueFile(content), { EMPTY: "" });
});
Deno.test("parseKeyValueFile - handles CRLF line endings", () => {
  const content = "KEY1=value1\r\nKEY2=value2";
  assertEquals(parseKeyValueFile(content), {
    KEY1: "value1",
    KEY2: "value2",
  });
});
Deno.test("parseKeyValueFile - skips empty lines", () => {
  const content = "KEY1=value1\n\n\nKEY2=value2";
  assertEquals(parseKeyValueFile(content), {
    KEY1: "value1",
    KEY2: "value2",
  });
});
Deno.test("parseKeyValueFile - skips lines without equals sign", () => {
  const content = "noequals\nKEY=value";
  assertEquals(parseKeyValueFile(content), { KEY: "value" });
});
Deno.test("parseKeyValueFile - handles mixed heredoc and regular entries", () => {
  const content = "SIMPLE=val\nHERE<<EOF\nmulti\nline\nEOF\nAFTER=done";
  assertEquals(parseKeyValueFile(content), {
    SIMPLE: "val",
    HERE: "multi\nline",
    AFTER: "done",
  });
});
Deno.test("parseKeyValueFile - handles empty input", () => {
  assertEquals(parseKeyValueFile(""), {});
});
Deno.test("parseKeyValueFile - last value wins for duplicate keys", () => {
  const content = "KEY=first\nKEY=second";
  assertEquals(parseKeyValueFile(content), { KEY: "second" });
});
Deno.test("parseKeyValueFile - does not mutate object prototypes", () => {
  const parsed = parseKeyValueFile("__proto__=polluted\nKEY=value");
  assertEquals(({} as Record<string, unknown>).polluted, undefined);
  assertEquals(parsed.KEY, "value");
});
// ---------------------------------------------------------------------------
// parsePathFile
// ---------------------------------------------------------------------------

Deno.test("parsePathFile - parses path entries", () => {
  assertEquals(parsePathFile("/usr/bin\n/home/user/.local/bin"), [
    "/usr/bin",
    "/home/user/.local/bin",
  ]);
});
Deno.test("parsePathFile - trims whitespace", () => {
  assertEquals(parsePathFile("  /usr/bin  \n  /home/bin  "), [
    "/usr/bin",
    "/home/bin",
  ]);
});
Deno.test("parsePathFile - filters empty lines", () => {
  assertEquals(parsePathFile("/usr/bin\n\n\n/home/bin\n"), [
    "/usr/bin",
    "/home/bin",
  ]);
});
Deno.test("parsePathFile - handles CRLF line endings", () => {
  assertEquals(parsePathFile("/usr/bin\r\n/home/bin"), [
    "/usr/bin",
    "/home/bin",
  ]);
});
Deno.test("parsePathFile - returns empty array for empty input", () => {
  assertEquals(parsePathFile(""), []);
});
Deno.test("parsePathFile - returns empty array for whitespace-only input", () => {
  assertEquals(parsePathFile("   \n   \n   "), []);
});
Deno.test("parsePathFile - handles single path entry", () => {
  assertEquals(parsePathFile("/single/path"), ["/single/path"]);
});
