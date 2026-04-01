import { toSafeHref } from "../../lib/safeHref.ts";
import { assertEquals } from "jsr:@std/assert";

Deno.test("toSafeHref - blocks dangerous schemes even when obfuscated with whitespace", () => {
  assertEquals(toSafeHref("javascript:alert(1)"), null);
  assertEquals(toSafeHref("java\nscript:alert(1)"), null);
  assertEquals(toSafeHref(" data:text/html;base64,PGgxPkJvb208L2gxPg=="), null);
});

Deno.test("toSafeHref - accepts relative paths and allowed schemes", () => {
  assertEquals(toSafeHref("/store/installed"), "/store/installed");
  assertEquals(
    toSafeHref("/w/personal/repos/repo-1?path=src/main.ts&line=12"),
    "/w/personal/repos/repo-1?path=src/main.ts&line=12",
  );
  assertEquals(
    toSafeHref("/storage/personal/docs/README.md?open=1"),
    "/storage/personal/docs/README.md?open=1",
  );
  assertEquals(toSafeHref("https://takos.jp"), "https://takos.jp");
  assertEquals(toSafeHref("mailto:hello@takos.jp"), "mailto:hello@takos.jp");
});
