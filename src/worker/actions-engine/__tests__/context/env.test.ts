import { expect, test } from "bun:test";
import { parseGitHubEnvFile } from "../../context.ts";

test("parseGitHubEnvFile - parses simple NAME=value lines", () => {
  const content = ["FOO=bar", "BAR=baz"].join("\n");

  expect(parseGitHubEnvFile(content)).toEqual({
    FOO: "bar",
    BAR: "baz",
  });
});
test("parseGitHubEnvFile - parses heredoc NAME<<EOF blocks", () => {
  const content = ["MULTILINE<<EOF", "line1", "line2", "EOF", "AFTER=value"]
    .join(
      "\n",
    );

  expect(parseGitHubEnvFile(content)).toEqual({
    MULTILINE: "line1\nline2",
    AFTER: "value",
  });
});
test("parseGitHubEnvFile - parses CRLF heredoc blocks and strips carriage returns", () => {
  const content =
    "WINDOWS<<END\r\nfirst line\r\nsecond line\r\nEND\r\nNEXT=value\r\n";

  const env = parseGitHubEnvFile(content);

  expect(env).toEqual({
    WINDOWS: "first line\nsecond line",
    NEXT: "value",
  });
  expect(!env.WINDOWS.includes("\r")).toBeTruthy();
});
test("parseGitHubEnvFile - drops prototype-polluting keys (simple form)", () => {
  const content = [
    "__proto__=polluted",
    "constructor=polluted",
    "prototype=polluted",
    "SAFE=ok",
  ].join("\n");

  const env = parseGitHubEnvFile(content);

  // The dangerous keys must not be captured as env entries...
  expect(env).toEqual({ SAFE: "ok" });
  // ...and must not have polluted Object.prototype.
  expect(({} as Record<string, unknown>).polluted).toEqual(undefined);
  expect(Object.prototype.hasOwnProperty.call(env, "__proto__")).toEqual(false);
});
test("parseGitHubEnvFile - drops prototype-polluting keys (heredoc form)", () => {
  const content = [
    "__proto__<<EOF",
    "polluted",
    "EOF",
    "SAFE=ok",
  ].join("\n");

  const env = parseGitHubEnvFile(content);

  expect(env).toEqual({ SAFE: "ok" });
  expect(({} as Record<string, unknown>).polluted).toEqual(undefined);
});
