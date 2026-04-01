import {
  MockD1Database,
  MockR2Bucket,
} from "../../../../../test/integration/setup.ts";
import {
  handleReceivePack,
  parseReceivePackBody,
  readPackObjectCount,
} from "@/services/git-smart/smart-http/receive-pack";
import {
  encodePktLine,
  flushPkt,
  parsePktLines,
  pktLineText,
} from "@/services/git-smart/protocol/pkt-line";
import { concatBytes } from "@/services/git-smart/core/sha1";
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";

const ZERO_SHA = "0000000000000000000000000000000000000000";
const SHA_A = "a".repeat(40);

function buildBody(commands: string[], includePackfile = false): Uint8Array {
  const parts: Uint8Array[] = commands.map((cmd) => encodePktLine(`${cmd}\n`));
  parts.push(flushPkt());
  if (includePackfile) {
    parts.push(
      new Uint8Array([
        0x50,
        0x41,
        0x43,
        0x4b,
        0,
        0,
        0,
        2,
        0,
        0,
        0,
        0,
      ]),
      new Uint8Array(20),
    );
  }
  return concatBytes(...parts);
}

Deno.test("parseReceivePackBody - splits commands and packfile bytes", () => {
  const body = buildBody([`${ZERO_SHA} ${SHA_A} refs/heads/main`], true);
  const parsed = parseReceivePackBody(body);

  assertEquals(parsed.commands.length, 1);
  assertEquals(parsed.commands[0].refName, "refs/heads/main");
  assertEquals(parsed.packfileData?.length, 32);
});

Deno.test("readPackObjectCount - reads the pack object count", () => {
  const pack = new Uint8Array([
    0x50,
    0x41,
    0x43,
    0x4b,
    0,
    0,
    0,
    2,
    0,
    0,
    0,
    3,
  ]);
  assertEquals(readPackObjectCount(pack), 3);
});

Deno.test("handleReceivePack - returns ok with empty refs for an empty body", async () => {
  const result = await handleReceivePack(
    new MockD1Database() as any,
    new MockR2Bucket() as any,
    "repo-1",
    flushPkt(),
  );
  const lines = parsePktLines(result.response);
  assertEquals(result.updatedRefs, []);
  assertEquals(lines[0].type, "data");
  assertEquals(lines[0].data?.[0], 1);
  assertStringIncludes(
    new TextDecoder().decode(lines[0].data!.subarray(1)),
    "unpack ok",
  );
});

Deno.test("handleReceivePack - reports too many ref updates", async () => {
  const commands = Array.from(
    { length: 51 },
    (_, i) => `${ZERO_SHA} ${SHA_A} refs/heads/branch-${i}`,
  );
  const result = await handleReceivePack(
    new MockD1Database() as any,
    new MockR2Bucket() as any,
    "repo-1",
    buildBody(commands),
  );
  const lines = parsePktLines(result.response);
  assertEquals(result.updatedRefs, []);
  assertStringIncludes(pktLineText(lines[0]), "too many ref updates");
});
