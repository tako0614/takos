import { validatePath, validatePathSegment } from "@/utils/path-validation";

import { assertEquals, assertThrows } from "jsr:@std/assert";

Deno.test("validatePath - passes a simple relative path", () => {
  assertEquals(validatePath("src/index.ts"), "src/index.ts");
});
Deno.test("validatePath - normalizes backslashes to forward slashes", () => {
  assertEquals(validatePath("src\\lib\\file.ts"), "src/lib/file.ts");
});
Deno.test("validatePath - strips leading slashes", () => {
  assertEquals(validatePath("/src/index.ts"), "src/index.ts");
});
Deno.test("validatePath - removes Windows drive letter prefix", () => {
  assertEquals(validatePath("C:\\Users\\file.txt"), "Users/file.txt");
  assertEquals(validatePath("D:/path/file.txt"), "path/file.txt");
});
Deno.test("validatePath - collapses multiple slashes", () => {
  assertEquals(validatePath("src///lib//file.ts"), "src/lib/file.ts");
});
Deno.test("validatePath - removes ./ prefix", () => {
  assertEquals(validatePath("./src/file.ts"), "src/file.ts");
});
Deno.test("validatePath - removes /./ segments", () => {
  assertEquals(validatePath("src/./lib/./file.ts"), "src/lib/file.ts");
});
Deno.test("validatePath - throws on path traversal (..)", () => {
  // The ".." is detected after NFC normalization and rejected
  assertThrows(
    () => validatePath("src/../lib/file.ts"),
    Error,
    "path traversal",
  );
});
Deno.test("validatePath - throws on double-encoded characters", () => {
  assertThrows(
    () => validatePath("src/%252e%252e/etc"),
    Error,
    "double-encoded",
  );
});
Deno.test("validatePath - throws on encoded null bytes", () => {
  assertThrows(() => validatePath("src/%00/file"), Error, "null bytes");
});
Deno.test("validatePath - throws on raw null bytes", () => {
  assertThrows(() => validatePath("src/\0file"), Error, "null bytes");
});
Deno.test("validatePath - throws on confusable Unicode dots", () => {
  // U+2024 = one dot leader
  assertThrows(
    () => validatePath("src/\u2024\u2024/etc"),
    Error,
    "confusable Unicode",
  );
});
Deno.test("validatePath - throws on confusable Unicode slashes", () => {
  // U+FF0F = fullwidth solidus
  assertThrows(() => validatePath("src\uFF0Fetc"), Error, "confusable Unicode");
});
Deno.test("validatePath - converts fullwidth ASCII characters", () => {
  // U+FF41 = fullwidth 'a'
  const result = validatePath("\uFF41\uFF42\uFF43");
  assertEquals(result, "abc");
});
Deno.test("validatePath - throws on fullwidth dot characters (confusable)", () => {
  // U+FF0E = fullwidth full stop, caught by confusable pattern before conversion
  assertThrows(
    () => validatePath("\uFF0E\uFF0E/secret"),
    Error,
    "confusable Unicode",
  );
});
Deno.test("validatePath - strips zero-width characters", () => {
  const result = validatePath("src/\u200bfile.ts");
  assertEquals(result, "src/file.ts");
});
Deno.test("validatePath - throws on system paths (/proc/)", () => {
  assertThrows(
    () => validatePath("something/proc/self"),
    Error,
    "system paths",
  );
});
Deno.test("validatePath - throws on /etc/passwd", () => {
  assertThrows(
    () => validatePath("something/etc/passwd"),
    Error,
    "system paths",
  );
});
Deno.test("validatePath - throws on /etc/shadow", () => {
  assertThrows(
    () => validatePath("something/etc/shadow"),
    Error,
    "system paths",
  );
});
Deno.test("validatePath - throws on dangerous path patterns (/tmp/)", () => {
  assertThrows(
    () => validatePath("something/tmp/exploit"),
    Error,
    "potentially dangerous",
  );
});
Deno.test("validatePath - throws on /home/ pattern", () => {
  assertThrows(
    () => validatePath("something/home/user"),
    Error,
    "potentially dangerous",
  );
});
Deno.test("validatePath - passes through non-hex percent sequences without decoding", () => {
  // %ZZ does not match the hex pattern /%[0-9a-f]{2}/i, so it's not decoded
  const result = validatePath("src/%ZZ/file");
  assertEquals(result, "src/%ZZ/file");
});
Deno.test("validatePath - handles URL-encoded normal characters", () => {
  const result = validatePath("src/%61%62%63.ts");
  assertEquals(result, "src/abc.ts");
});
Deno.test("validatePath - throws on deeply nested traversal", () => {
  // The ".." patterns are detected before stripping
  assertThrows(() => validatePath("a/b/../../c"), Error, "path traversal");
});
Deno.test("validatePath - strips Windows drive letter (C:) making the path relative", () => {
  // C: prefix is removed by the normalization, leaving "file.txt"
  assertEquals(validatePath("C:file.txt"), "file.txt");
});
Deno.test("validatePath - handles ideographic space (U+3000)", () => {
  const result = validatePath("src/\u3000file.ts");
  assertEquals(result, "src/ file.ts");
});

Deno.test("validatePathSegment - accepts a normal filename", () => {
  assertEquals(validatePathSegment("index.ts"), true);
});
Deno.test("validatePathSegment - rejects empty string", () => {
  assertEquals(validatePathSegment(""), false);
});
Deno.test('validatePathSegment - rejects "."', () => {
  assertEquals(validatePathSegment("."), false);
});
Deno.test('validatePathSegment - rejects ".."', () => {
  assertEquals(validatePathSegment(".."), false);
});
Deno.test('validatePathSegment - rejects names containing "/"', () => {
  assertEquals(validatePathSegment("path/file"), false);
});
Deno.test('validatePathSegment - rejects names containing "%"', () => {
  assertEquals(validatePathSegment("file%20name"), false);
});
Deno.test("validatePathSegment - rejects names containing backslash", () => {
  assertEquals(validatePathSegment("path\\file"), false);
});
Deno.test("validatePathSegment - rejects names longer than 255 characters", () => {
  assertEquals(validatePathSegment("a".repeat(256)), false);
});
Deno.test("validatePathSegment - accepts names at exactly 255 characters", () => {
  assertEquals(validatePathSegment("a".repeat(255)), true);
});
Deno.test("validatePathSegment - accepts dotfiles (hidden files)", () => {
  assertEquals(validatePathSegment(".gitignore"), true);
});
