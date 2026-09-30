import { expect, test } from "bun:test";

import {
  buildTestInventory,
  canRunTestSelection,
  selectTestFiles,
  validateTestInventory,
} from "../test-inventory.ts";

const onlinePath = "scripts/__tests__/takoserver-fetch-tracer.online.test.ts";
const quarantinedPath = "src/worker/local-platform/__tests__/bootstrap.test.ts";
const portablePath = "scripts/__tests__/portable.test.ts";

function inventory() {
  return buildTestInventory(
    [onlinePath, quarantinedPath, portablePath],
    { files: { [quarantinedPath]: "fails in the current local substrate" } },
    { files: { [onlinePath]: "requires public Registry/GitHub access" } },
  );
}

test("portable selection excludes online evidence", () => {
  expect(selectTestFiles(inventory(), "portable")).toEqual([portablePath]);
});

test("online selection includes only the explicit online inventory", () => {
  expect(selectTestFiles(inventory(), "online")).toEqual([onlinePath]);
});

test("quarantine selection remains separate from online evidence", () => {
  expect(selectTestFiles(inventory(), "quarantine")).toEqual([
    quarantinedPath,
  ]);
});

test("empty portable and online selections are refused but no-debt quarantine passes", () => {
  expect(canRunTestSelection("portable", [])).toBe(false);
  expect(canRunTestSelection("online", [])).toBe(false);
  expect(canRunTestSelection("quarantine", [])).toBe(true);
});

test("inventory validation rejects bad totals, reasons, paths, and overlap", () => {
  const result = validateTestInventory(
    [onlinePath, quarantinedPath],
    {
      totals: { files: 1 },
      files: {
        [onlinePath]: "also quarantined",
        missing: "not a tracked test",
      },
    },
    {
      totals: { files: 2 },
      files: { [onlinePath]: "", [quarantinedPath]: "overlap" },
    },
  );

  expect(result.issues.map(({ message }) => message)).toEqual(
    expect.arrayContaining([
      "Manifest totals say 1 file(s) but 2 are listed.",
      "missing is not a tracked test file.",
      `${onlinePath} has no reason.`,
      `Online test files may not also be quarantined: ${onlinePath}`,
    ]),
  );
});
