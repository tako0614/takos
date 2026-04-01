/**
 * Git Smart HTTP Client — fetch pack (clone/fetch).
 *
 * Speaks the client side of the git upload-pack protocol.
 * This is the inverse of `handleUploadPack` in `smart-http/upload-pack.ts`:
 * the server builds want/have negotiation and constructs a packfile response;
 * this module *sends* want/have lines and *receives* the packfile.
 *
 * The returned packfile bytes can be passed directly to `readPackfileAsync`
 * from `protocol/packfile-reader.ts` to unpack objects into R2.
 */

import { encodePktLine, flushPkt, parsePktLines, pktLineText } from '../protocol/pkt-line.ts';
import { concatBytes } from '../core/sha1.ts';
import { logWarn } from '../../../../shared/utils/logger.ts';

const _TEXT_ENCODER = new TextEncoder();

/** Maximum packfile size we accept (100 MB). */
const MAX_FETCH_PACKFILE_BYTES = 100 * 1024 * 1024;

/**
 * Fetch a packfile from a remote git HTTP server.
 *
 * Sends a `POST <url>/git-upload-pack` request with want/have negotiation
 * and returns the raw packfile bytes (starting with `PACK` signature).
 *
 * @param url       Base git URL (e.g. `https://github.com/owner/repo.git`)
 * @param authHeader  Authorization header value, or null for public repos
 * @param wants     SHA-1 hashes of refs we want
 * @param haves     SHA-1 hashes of refs we already have locally (empty for initial clone)
 * @param options   Optional fetch configuration
 * @returns Raw packfile bytes suitable for `readPackfileAsync`
 */
export async function fetchPackFromRemote(
  url: string,
  authHeader: string | null,
  wants: string[],
  haves: string[],
  options?: { maxPackfileBytes?: number },
): Promise<Uint8Array> {
  if (wants.length === 0) {
    throw new Error('fetchPackFromRemote: at least one want SHA is required');
  }

  const maxBytes = options?.maxPackfileBytes ?? MAX_FETCH_PACKFILE_BYTES;
  const normalizedUrl = url.replace(/\/$/, '');
  const uploadPackUrl = `${normalizedUrl}/git-upload-pack`;

  // Build request body: want lines, flush, have lines, done
  const requestParts: Uint8Array[] = [];

  // First want line includes capabilities
  const capabilities = 'side-band-64k no-progress ofs-delta';
  requestParts.push(encodePktLine(`want ${wants[0]} ${capabilities}\n`));

  // Remaining want lines
  for (let i = 1; i < wants.length; i++) {
    requestParts.push(encodePktLine(`want ${wants[i]}\n`));
  }

  requestParts.push(flushPkt());

  // Have lines
  for (const have of haves) {
    requestParts.push(encodePktLine(`have ${have}\n`));
  }

  // Done
  requestParts.push(encodePktLine('done\n'));

  const requestBody = concatBytes(...requestParts);

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-git-upload-pack-request',
    'User-Agent': 'takos-git-client/1.0',
  };
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }

  const response = await fetch(uploadPackUrl, {
    method: 'POST',
    headers,
    body: requestBody as unknown as BodyInit,
  });

  if (!response.ok) {
    const body = await response.text().catch((e) => { logWarn('Failed to read fetch-pack error response body', { module: 'git-smart', error: String(e) }); return ''; });
    throw new Error(
      `Failed to fetch pack from ${normalizedUrl}: HTTP ${response.status}${body ? ` — ${body.slice(0, 200)}` : ''}`,
    );
  }

  const responseBuffer = new Uint8Array(await response.arrayBuffer());

  if (responseBuffer.length > maxBytes) {
    throw new Error(
      `Packfile response too large: ${responseBuffer.length} bytes (limit: ${maxBytes})`,
    );
  }

  // Parse the response — extract packfile from side-band-64k framing
  return extractPackfileFromResponse(responseBuffer);
}

/**
 * Extract raw packfile data from a git upload-pack response.
 *
 * The response format is:
 *   - NAK/ACK pkt-lines
 *   - Side-band-64k frames: channel 1 = pack data, channel 2 = progress, channel 3 = error
 *   - Flush packet
 *
 * If the response does not use side-band framing (e.g., the server doesn't
 * support it), the raw response after the NAK line is treated as packfile data.
 */
function extractPackfileFromResponse(data: Uint8Array): Uint8Array {
  const lines = parsePktLines(data);
  const packParts: Uint8Array[] = [];
  let hasSideBand = false;

  for (const line of lines) {
    if (line.type !== 'data' || !line.data || line.data.length === 0) continue;

    const text = pktLineText(line);

    // Skip NAK/ACK lines
    if (text === 'NAK' || text.startsWith('ACK ')) continue;

    // Check for side-band framing (channel byte as first byte)
    const channel = line.data[0];

    if (channel === 1) {
      // Pack data channel
      hasSideBand = true;
      packParts.push(line.data.subarray(1));
    } else if (channel === 2) {
      // Progress channel — skip
      hasSideBand = true;
    } else if (channel === 3) {
      // Error channel
      const errorMsg = new TextDecoder().decode(line.data.subarray(1));
      throw new Error(`Remote error: ${errorMsg}`);
    } else if (!hasSideBand) {
      // No side-band — treat raw data as packfile
      packParts.push(line.data);
    }
  }

  if (packParts.length === 0) {
    throw new Error('No packfile data received from remote');
  }

  const packfile = concatBytes(...packParts);

  // Verify PACK signature
  if (packfile.length < 12) {
    throw new Error(`Packfile too small: ${packfile.length} bytes`);
  }

  const sig = String.fromCharCode(packfile[0], packfile[1], packfile[2], packfile[3]);
  if (sig !== 'PACK') {
    throw new Error(`Invalid packfile signature: "${sig}"`);
  }

  return packfile;
}
