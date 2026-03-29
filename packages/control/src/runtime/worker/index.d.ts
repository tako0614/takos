export { createWorkerRuntime } from './runtime-factory';
declare const _default: {
    fetch(request: Request, env: import("./env").WorkerEnv): Promise<Response>;
    queue(batch: import("../../shared/types").MessageBatch<unknown>, env: import("./env").WorkerEnv): Promise<void>;
    scheduled(event: import("../../shared/types").ScheduledEvent, env: import("./env").WorkerEnv): Promise<void>;
};
export default _default;
//# sourceMappingURL=index.d.ts.map