import { MockD1Database } from "../../../../../test/integration/setup.ts";
import { handleInfoRefs } from "@/services/git-smart/smart-http/info-refs";
import {
  parsePktLines,
  pktLineText,
} from "@/services/git-smart/protocol/pkt-line";
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  formatCapabilities,
  RECEIVE_PACK_CAPABILITIES,
  UPLOAD_PACK_CAPABILITIES,
} from "@/services/git-smart/protocol/capabilities";

const ZERO_SHA = "0000000000000000000000000000000000000000";

Deno.test("formatCapabilities - joins capabilities with spaces", () => {
  assertEquals(formatCapabilities(["a", "b", "c"]), "a b c");
});

Deno.test("handleInfoRefs - advertises upload-pack capabilities for an empty repo", async () => {
  const result = await handleInfoRefs(
    new MockD1Database() as any,
    "repo-1",
    "git-upload-pack",
  );
  const lines = parsePktLines(result);

  assertEquals(lines[0].type, "data");
  assertEquals(pktLineText(lines[0]), "# service=git-upload-pack");
  assertEquals(lines[1].type, "flush");
  assertEquals(lines[2].type, "data");
  const capsLine = pktLineText(lines[2]);
  assertStringIncludes(capsLine, ZERO_SHA);
  assertStringIncludes(capsLine, "capabilities^{}");
  assertStringIncludes(capsLine, UPLOAD_PACK_CAPABILITIES[0]);
});

Deno.test("handleInfoRefs - advertises receive-pack capabilities for an empty repo", async () => {
  const result = await handleInfoRefs(
    new MockD1Database() as any,
    "repo-1",
    "git-receive-pack",
  );
  const lines = parsePktLines(result);

  const capsLine = pktLineText(lines[2]);
  assertStringIncludes(capsLine, ZERO_SHA);
  assertStringIncludes(capsLine, "capabilities^{}");
  assertStringIncludes(capsLine, RECEIVE_PACK_CAPABILITIES[0]);
});
