import type { DurableObjectNamespace } from '../../shared/types/bindings.ts';
interface Env {
    RATE_LIMITER_DO?: DurableObjectNamespace;
    EGRESS_MAX_REQUESTS?: string;
    EGRESS_WINDOW_MS?: string;
    EGRESS_RATE_LIMIT_ALGORITHM?: string;
    EGRESS_RATE_LIMIT_SHADOW_SAMPLE_RATE?: string;
    EGRESS_MAX_RESPONSE_BYTES?: string;
    EGRESS_TIMEOUT_MS?: string;
}
declare const _default: {
    fetch(request: Request, env: Env): Promise<Response>;
};
export default _default;
//# sourceMappingURL=egress.d.ts.map