import { parseMarkdownBlocks } from "../../../views/chat/markdownBlocks.ts";
import { deepStrictEqual as eq } from "node:assert/strict";
import { test } from "bun:test";

test("markdownBlocks - headings by level", () => {
  eq(parseMarkdownBlocks("# A\n## B\n### C\n#### D"), [
    { kind: "heading", level: 1, text: "A" },
    { kind: "heading", level: 2, text: "B" },
    { kind: "heading", level: 3, text: "C" },
    { kind: "heading", level: 4, text: "D" },
  ]);
});

test("markdownBlocks - fenced code preserves content and language", () => {
  eq(parseMarkdownBlocks("```ts\nconst a = 1;\nconst b = 2;\n```"), [
    { kind: "code", lang: "ts", code: "const a = 1;\nconst b = 2;" },
  ]);
});

test("markdownBlocks - unfinished code fence runs to end", () => {
  eq(parseMarkdownBlocks("```\nx\ny"), [
    { kind: "code", lang: "", code: "x\ny" },
  ]);
});

test("markdownBlocks - unordered and ordered lists fold consecutive items", () => {
  eq(parseMarkdownBlocks("- a\n- b\n* c"), [
    { kind: "list", ordered: false, items: ["a", "b", "c"] },
  ]);
  eq(parseMarkdownBlocks("1. one\n2. two"), [
    { kind: "list", ordered: true, items: ["one", "two"] },
  ]);
});

test("markdownBlocks - list marker tolerates extra spaces (old slice(2) bug)", () => {
  eq(parseMarkdownBlocks("-   spaced"), [
    { kind: "list", ordered: false, items: ["spaced"] },
  ]);
});

test("markdownBlocks - blockquote folds consecutive > lines", () => {
  eq(parseMarkdownBlocks("> first\n> second\nafter"), [
    { kind: "quote", lines: ["first", "second"] },
    { kind: "paragraph", text: "after" },
  ]);
});

test("markdownBlocks - horizontal rule variants, not confused with lists", () => {
  eq(parseMarkdownBlocks("---"), [{ kind: "hr" }]);
  eq(parseMarkdownBlocks("***"), [{ kind: "hr" }]);
  eq(parseMarkdownBlocks("___"), [{ kind: "hr" }]);
});

test("markdownBlocks - GFM table with alignment", () => {
  const md = "| a | b | c |\n| :-- | :-: | --: |\n| 1 | 2 | 3 |\n| x | y | z |";
  eq(parseMarkdownBlocks(md), [
    {
      kind: "table",
      header: ["a", "b", "c"],
      align: ["left", "center", "right"],
      rows: [["1", "2", "3"], ["x", "y", "z"]],
    },
  ]);
});

test("markdownBlocks - a pipe line without a separator is just a paragraph", () => {
  eq(parseMarkdownBlocks("a | b | c"), [
    { kind: "paragraph", text: "a | b | c" },
  ]);
});

test("markdownBlocks - paragraphs and blanks", () => {
  eq(parseMarkdownBlocks("hello\n\nworld"), [
    { kind: "paragraph", text: "hello" },
    { kind: "blank" },
    { kind: "paragraph", text: "world" },
  ]);
});
