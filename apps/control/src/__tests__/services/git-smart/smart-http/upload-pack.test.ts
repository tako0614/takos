import { handleUploadPack } from "@/services/git-smart/smart-http/upload-pack";
import {
  encodePktLine,
  flushPkt,
  parsePktLines,
  pktLineText,
} from "@/services/git-smart/protocol/pkt-line";
import { concatBytes } from "@/services/git-smart/core/sha1";
import { assert, assertEquals } from "jsr:@std/assert";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

Deno.test("handleUploadPack - returns NAK only when no wants are sent", async () => {
  const body = concatBytes(encodePktLine("done\n"), flushPkt());
  const result = await handleUploadPack({} as any, {} as any, "repo-1", body);
  const lines = parsePktLines(result);

  assertEquals(lines.length, 1);
  assertEquals(pktLineText(lines[0]), "NAK");
});

Deno.test("handleUploadPack - ignores invalid want and have lines", async () => {
  const body = concatBytes(
    encodePktLine("want shortsha\n"),
    encodePktLine(`have ${SHA_B}\n`),
    flushPkt(),
    encodePktLine("done\n"),
    flushPkt(),
  );
  const result = await handleUploadPack({} as any, {} as any, "repo-1", body);
  const lines = parsePktLines(result);

  assertEquals(lines.length, 1);
  assertEquals(pktLineText(lines[0]), "NAK");
});

Deno.test.ignore(
  "handleUploadPack - accepts a valid want line and emits a pack response structure",
  async () => {
    const body = concatBytes(
      encodePktLine(`want ${SHA_A}\n`),
      flushPkt(),
      encodePktLine("done\n"),
      flushPkt(),
    );
    const result = await handleUploadPack({} as any, {} as any, "repo-1", body);
    const lines = parsePktLines(result);

    assert(lines.length >= 1);
    assertEquals(pktLineText(lines[0]), "NAK");
  },
);
