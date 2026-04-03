import { assert, assertEquals } from "jsr:@std/assert";
import { fetchPackFromRemote } from "../../../../../../../packages/control/src/application/services/git-smart/client/fetch-pack.ts";
import {
  encodePktLine,
  encodeSideBandData,
  flushPkt,
  parsePktLines,
  pktLineText,
} from "@/services/git-smart/protocol/pkt-line";
import { concatBytes } from "@/services/git-smart/core/sha1";

function createPackResponse(packfile: Uint8Array): Response {
  const body = concatBytes(
    encodePktLine("NAK\n"),
    encodeSideBandData(1, packfile),
    flushPkt(),
  );
  const bytes = new Uint8Array(body.byteLength);
  bytes.set(body);
  return new Response(
    bytes.buffer,
    { status: 200 },
  );
}

Deno.test("fetchPackFromRemote - requests only advertised capabilities and sends filter line", async () => {
  const originalFetch = globalThis.fetch;
  const commitSha = "0123456789abcdef0123456789abcdef01234567";
  const packfile = new Uint8Array([
    0x50,
    0x41,
    0x43,
    0x4b,
    0x00,
    0x00,
    0x00,
    0x02,
    0x00,
    0x00,
    0x00,
    0x00,
  ]);
  let requestBody: Uint8Array | null = null;

  globalThis.fetch = (async (_input, init) => {
    requestBody = new Uint8Array(
      await new Response(init?.body as BodyInit).arrayBuffer(),
    );
    return createPackResponse(packfile);
  }) as typeof fetch;

  try {
    const receivedPack = await fetchPackFromRemote(
      "https://example.com/acme/repo.git",
      null,
      [commitSha],
      [],
      {
        advertisedCapabilities: ["side-band-64k", "filter"],
        filterSpec: "blob:none",
      },
    );

    assertEquals(receivedPack, packfile);
    assert(requestBody);

    const lines = parsePktLines(requestBody);
    const texts = lines
      .filter((line) => line.type === "data")
      .map((line) => pktLineText(line));

    assertEquals(
      texts[0],
      `want ${commitSha} side-band-64k filter`,
    );
    assertEquals(texts[1], "filter blob:none");
    assertEquals(texts[2], "done");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
