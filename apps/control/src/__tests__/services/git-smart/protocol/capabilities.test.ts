import {
  formatCapabilities,
  RECEIVE_PACK_CAPABILITIES,
  UPLOAD_PACK_CAPABILITIES,
} from "@/services/git-smart/protocol/capabilities";

import { assert, assertEquals } from "jsr:@std/assert";

Deno.test("UPLOAD_PACK_CAPABILITIES - includes side-band-64k", () => {
  assert(UPLOAD_PACK_CAPABILITIES.includes("side-band-64k"));
});

Deno.test("UPLOAD_PACK_CAPABILITIES - is a non-empty array of strings", () => {
  assert(UPLOAD_PACK_CAPABILITIES.length > 0);
  for (const cap of UPLOAD_PACK_CAPABILITIES) {
    assertEquals(typeof cap, "string");
  }
});

Deno.test("RECEIVE_PACK_CAPABILITIES - includes side-band-64k", () => {
  assert(RECEIVE_PACK_CAPABILITIES.includes("side-band-64k"));
});

Deno.test("RECEIVE_PACK_CAPABILITIES - includes report-status", () => {
  assert(RECEIVE_PACK_CAPABILITIES.includes("report-status"));
});

Deno.test("formatCapabilities - joins capabilities with spaces", () => {
  const result = formatCapabilities(["a", "b", "c"]);
  assertEquals(result, "a b c");
});

Deno.test("formatCapabilities - handles single capability", () => {
  const result = formatCapabilities(["only"]);
  assertEquals(result, "only");
});

Deno.test("formatCapabilities - handles empty list", () => {
  const result = formatCapabilities([]);
  assertEquals(result, "");
});
