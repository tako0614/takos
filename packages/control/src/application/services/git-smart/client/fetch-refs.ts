/**
 * Git Smart HTTP Client — fetch remote refs.
 *
 * Speaks the client side of the git smart HTTP info/refs protocol.
 * This is the inverse of `handleInfoRefs` in `smart-http/info-refs.ts`:
 * the server *constructs* the pkt-line response; this module *parses* it.
 *
 * Usage:
 *   const { refs, capabilities } = await fetchRemoteRefs(
 *     'https://github.com/owner/repo.git',
 *     null, // no auth for public repos
 *   );
 */

import { parsePktLines, pktLineText } from '../protocol/pkt-line';
import { logWarn } from '../../../../shared/utils/logger';

export interface RemoteRef {
  /** Fully qualified ref name, e.g. `refs/heads/main`. */
  name: string;
  /** 40-character hex SHA-1. */
  sha: string;
}

export interface FetchRefsResult {
  refs: RemoteRef[];
  capabilities: string[];
  /** The SHA advertised as HEAD (if present via symref). */
  headSha: string | null;
  /** The branch HEAD points to (parsed from symref capability). */
  headTarget: string | null;
}

/**
 * Fetch the ref list from a remote git HTTP server.
 *
 * Sends `GET <url>/info/refs?service=git-upload-pack` and parses the
 * pkt-line response into structured ref entries and capabilities.
 */
export async function fetchRemoteRefs(
  url: string,
  authHeader: string | null,
): Promise<FetchRefsResult> {
  const normalizedUrl = url.replace(/\/$/, '');
  const infoRefsUrl = `${normalizedUrl}/info/refs?service=git-upload-pack`;

  const headers: Record<string, string> = {
    'User-Agent': 'takos-git-client/1.0',
  };
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }

  const response = await fetch(infoRefsUrl, { headers });

  if (!response.ok) {
    const body = await response.text().catch((err) => {
      logWarn('Failed to read error response body from remote git server', { module: 'fetch-refs', error: err instanceof Error ? err.message : String(err) });
      return '';
    });
    throw new Error(
      `Failed to fetch refs from ${normalizedUrl}: HTTP ${response.status}${body ? ` — ${body.slice(0, 200)}` : ''}`,
    );
  }

  const buffer = new Uint8Array(await response.arrayBuffer());
  const lines = parsePktLines(buffer);

  const refs: RemoteRef[] = [];
  let capabilities: string[] = [];
  let headSha: string | null = null;
  let headTarget: string | null = null;
  let firstDataLine = true;

  for (const line of lines) {
    if (line.type !== 'data' || !line.data) continue;

    const text = pktLineText(line);

    // Skip the service announcement line (e.g. "# service=git-upload-pack")
    if (text.startsWith('#')) continue;

    if (firstDataLine) {
      // First data line contains: "<sha> <refname>\0<capabilities>"
      firstDataLine = false;
      const nulIndex = text.indexOf('\0');
      if (nulIndex >= 0) {
        const refPart = text.slice(0, nulIndex);
        const capsPart = text.slice(nulIndex + 1);
        capabilities = capsPart.split(' ').filter(Boolean);

        // Parse symref capability: symref=HEAD:refs/heads/main
        for (const cap of capabilities) {
          if (cap.startsWith('symref=HEAD:')) {
            headTarget = cap.slice('symref=HEAD:'.length);
          }
        }

        const ref = parseRefLine(refPart);
        if (ref) {
          refs.push(ref);
          if (ref.name === 'HEAD') headSha = ref.sha;
        }
      } else {
        const ref = parseRefLine(text);
        if (ref) {
          refs.push(ref);
          if (ref.name === 'HEAD') headSha = ref.sha;
        }
      }
    } else {
      const ref = parseRefLine(text);
      if (ref) {
        refs.push(ref);
      }
    }
  }

  return { refs, capabilities, headSha, headTarget };
}

function parseRefLine(line: string): RemoteRef | null {
  // Format: "<40-char sha> <refname>"
  const spaceIndex = line.indexOf(' ');
  if (spaceIndex < 0) return null;

  const sha = line.slice(0, spaceIndex);
  const name = line.slice(spaceIndex + 1);

  if (sha.length !== 40 || !/^[a-f0-9]{40}$/.test(sha)) return null;
  if (!name) return null;

  return { sha, name };
}
