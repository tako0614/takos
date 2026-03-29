/**
 * Git Smart HTTP — info/refs endpoint.
 *
 * Returns the list of refs in pkt-line format for ref discovery.
 */
import type { D1Database } from '../../../../shared/types/bindings.ts';
export declare function handleInfoRefs(db: D1Database, repoId: string, service: 'git-upload-pack' | 'git-receive-pack'): Promise<Uint8Array>;
//# sourceMappingURL=info-refs.d.ts.map