import type { Claim, ClaimPath, ActivationBundle, ActivationResult } from './graph-models';
export declare function buildActivationBundles(claims: Claim[], evidenceCounts: Map<string, number>, pathsByClaim: Map<string, ClaimPath[]>): ActivationBundle[];
export declare function renderActivationSegment(bundles: ActivationBundle[]): ActivationResult;
//# sourceMappingURL=activation.d.ts.map