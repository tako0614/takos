/**
 * Git Smart HTTP — info/refs endpoint.
 *
 * Returns the list of refs in pkt-line format for ref discovery.
 */

import type { D1Database } from '../../../../shared/types/bindings.ts';
import { listAllRefs, getDefaultBranch } from '../core/refs.ts';
import {
  encodePktLine,
  flushPkt,
  buildPktLineResponse,
} from '../protocol/pkt-line.ts';
import { concatBytes } from '../core/sha1.ts';
import {
  UPLOAD_PACK_CAPABILITIES,
  RECEIVE_PACK_CAPABILITIES,
  formatCapabilities,
} from '../protocol/capabilities.ts';

const ZERO_SHA = '0000000000000000000000000000000000000000';

export async function handleInfoRefs(
  db: D1Database,
  repoId: string,
  service: 'git-upload-pack' | 'git-receive-pack',
): Promise<Uint8Array> {
  const refs = await listAllRefs(db, repoId);
  const defaultBranch = await getDefaultBranch(db, repoId);
  const parts: Uint8Array[] = [];

  // Service announcement line
  parts.push(encodePktLine(`# service=${service}\n`));
  parts.push(flushPkt());

  const caps = service === 'git-upload-pack'
    ? formatCapabilities(UPLOAD_PACK_CAPABILITIES)
    : formatCapabilities(RECEIVE_PACK_CAPABILITIES);

  if (refs.length === 0) {
    // Empty repository — advertise capabilities with zero-id
    const symref = defaultBranch ? ` symref=HEAD:refs/heads/${defaultBranch.name}` : '';
    parts.push(encodePktLine(`${ZERO_SHA} capabilities^{}\0${caps}${symref}\n`));
    parts.push(flushPkt());
    return concatBytes(...parts);
  }

  // HEAD line (point to default branch)
  const headRef = defaultBranch
    ? refs.find(r => r.name === `refs/heads/${defaultBranch.name}`)
    : refs[0];

  const headSha = headRef?.target || refs[0]?.target || ZERO_SHA;
  const symref = defaultBranch ? ` symref=HEAD:refs/heads/${defaultBranch.name}` : '';

  // First ref includes capabilities
  parts.push(encodePktLine(`${headSha} HEAD\0${caps}${symref}\n`));

  // Remaining refs sorted by name
  const sortedRefs = [...refs].sort((a, b) => a.name.localeCompare(b.name));
  for (const ref of sortedRefs) {
    parts.push(encodePktLine(`${ref.target} ${ref.name}\n`));
  }

  parts.push(flushPkt());
  return concatBytes(...parts);
}
