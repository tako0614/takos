import type { MessageBatch } from '../../shared/types/bindings.ts';
import type { IndexJobQueueMessage } from '../../shared/types';
import type { IndexerEnv as Env } from '../../shared/types';
export { handleIndexJobDlq } from './handlers';
declare const _default: {
    queue(batch: MessageBatch<IndexJobQueueMessage>, env: Env): Promise<void>;
};
export default _default;
//# sourceMappingURL=index.d.ts.map