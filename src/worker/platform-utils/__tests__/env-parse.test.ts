import { expect, test } from "bun:test";

import { parseBoolean, parseInteger, parsePort } from "../env-parse.ts";

// ---------------------------------------------------------------------------
// parseBoolean
// ---------------------------------------------------------------------------

test("parseBoolean - accepts true synonyms (case-insensitive)", () => {
  for (const v of ["true", "TRUE", "True", "1", "yes", "YES", "on", "ON"]) {
    expect(parseBoolean(v, false, { warn: () => {} })).toEqual(true);
  }
});

test("parseBoolean - accepts false synonyms (case-insensitive)", () => {
  for (const v of ["false", "FALSE", "False", "0", "no", "NO", "off", "OFF"]) {
    expect(parseBoolean(v, true, { warn: () => {} })).toEqual(false);
  }
});

test("parseBoolean - undefined returns default", () => {
  expect(parseBoolean(undefined, true, { warn: () => {} })).toEqual(true);
  expect(parseBoolean(undefined, false, { warn: () => {} })).toEqual(false);
});

test("parseBoolean - empty string returns default (no warning)", () => {
  let warned = false;
  expect(parseBoolean("", true, { warn: () => (warned = true) })).toEqual(true);
  expect(warned).toEqual(false);
  expect(parseBoolean("   ", false, { warn: () => (warned = true) })).toEqual(false);
});

test("parseBoolean - unrecognized value returns default with warning", () => {
  let warned = false;
  let warnMessage = "";
  expect(parseBoolean("maybe", true, {
      name: "TEST_FLAG",
      warn: (m: string) => {
        warned = true;
        warnMessage = m;
      },
    })).toEqual(true);
  expect(warned).toEqual(true);
  expect(warnMessage.includes("TEST_FLAG")).toEqual(true);
  expect(warnMessage.includes("maybe")).toEqual(true);
});

test("parseBoolean - trims whitespace", () => {
  expect(parseBoolean("  true  ", false, { warn: () => {} })).toEqual(true);
});

// ---------------------------------------------------------------------------
// parseInteger
// ---------------------------------------------------------------------------

test("parseInteger - parses positive integer", () => {
  expect(parseInteger("42", 0, { warn: () => {} })).toEqual(42);
  expect(parseInteger("0", 5, { warn: () => {} })).toEqual(0);
});

test("parseInteger - undefined / empty returns default (no warning)", () => {
  let warned = false;
  expect(parseInteger(undefined, 7, { warn: () => (warned = true) })).toEqual(7);
  expect(parseInteger("", 7, { warn: () => (warned = true) })).toEqual(7);
  expect(warned).toEqual(false);
});

test("parseInteger - negative returns default with warning", () => {
  let warned = false;
  expect(parseInteger("-1", 5, { warn: () => (warned = true) })).toEqual(5);
  expect(warned).toEqual(true);
});

test("parseInteger - NaN returns default with warning", () => {
  let warned = false;
  expect(parseInteger("abc", 10, { warn: () => (warned = true) })).toEqual(10);
  expect(warned).toEqual(true);
});

// ---------------------------------------------------------------------------
// parsePort
// ---------------------------------------------------------------------------

test("parsePort - accepts 1..65535", () => {
  expect(parsePort("1", 80, { warn: () => {} })).toEqual(1);
  expect(parsePort("8080", 80, { warn: () => {} })).toEqual(8080);
  expect(parsePort("65535", 80, { warn: () => {} })).toEqual(65535);
});

test("parsePort - rejects 0 (out of range)", () => {
  let warned = false;
  expect(parsePort("0", 80, { warn: () => (warned = true) })).toEqual(80);
  expect(warned).toEqual(true);
});

test("parsePort - rejects > 65535", () => {
  let warned = false;
  expect(parsePort("70000", 443, { warn: () => (warned = true) })).toEqual(443);
  expect(warned).toEqual(true);
});

test("parsePort - undefined returns default", () => {
  expect(parsePort(undefined, 8787, { warn: () => {} })).toEqual(8787);
});

test("parsePort - non-integer returns default with warning", () => {
  let warned = false;
  expect(parsePort("not-a-port", 9000, { warn: () => (warned = true) })).toEqual(9000);
  expect(warned).toEqual(true);
});
