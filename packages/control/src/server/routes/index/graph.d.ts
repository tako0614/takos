import type { D1Database } from '../../../shared/types/bindings.ts';
import type { SpaceFile } from '../../../shared/types';
import type { IndexContext } from './index-context';
export declare function handleGraphNeighbors(c: IndexContext): Promise<Response>;
export declare function extractAndCreateEdges(db: D1Database, spaceId: string, file: SpaceFile, content: string, sourceNodeId: string): Promise<void>;
//# sourceMappingURL=graph.d.ts.map