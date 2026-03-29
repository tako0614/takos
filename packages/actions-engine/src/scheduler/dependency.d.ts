/**
 * Dependency resolution using DAG (Directed Acyclic Graph)
 */
import type { Workflow } from '../workflow-models.js';
/**
 * Error thrown when dependency resolution fails
 */
export declare class DependencyError extends Error {
    readonly jobs?: string[] | undefined;
    constructor(message: string, jobs?: string[] | undefined);
}
/**
 * Dependency graph representation
 */
export interface DependencyGraph {
    /** All nodes (job IDs) */
    nodes: Set<string>;
    /** Edges: key depends on values */
    edges: Map<string, Set<string>>;
    /** Reverse edges: key is required by values */
    reverseEdges: Map<string, Set<string>>;
}
/**
 * Build dependency graph from workflow
 */
export declare function buildDependencyGraph(workflow: Workflow): DependencyGraph;
/**
 * Detect circular dependencies in graph
 * Returns the cycle path if found, empty array otherwise
 */
export declare function detectCycle(graph: DependencyGraph): string[];
/**
 * Group jobs into parallel execution phases
 * Jobs in the same phase can run in parallel
 */
export declare function groupIntoPhases(graph: DependencyGraph): string[][];
//# sourceMappingURL=dependency.d.ts.map