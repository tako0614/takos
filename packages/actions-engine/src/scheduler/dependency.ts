/**
 * Dependency resolution using DAG (Directed Acyclic Graph)
 */
import type { Workflow } from '../types.js';
import { normalizeNeedsInput } from './job.js';

/**
 * Error thrown when dependency resolution fails
 */
export class DependencyError extends Error {
  constructor(
    message: string,
    public readonly jobs?: string[]
  ) {
    super(message);
    this.name = 'DependencyError';
  }
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

function getOrCreateGraphSet(
  map: Map<string, Set<string>>,
  key: string
): Set<string> {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }

  const created = new Set<string>();
  map.set(key, created);
  return created;
}

const EMPTY_JOB_SET = new Set<string>();

/**
 * Build dependency graph from workflow
 */
export function buildDependencyGraph(workflow: Workflow): DependencyGraph {
  const nodes = new Set<string>();
  const edges = new Map<string, Set<string>>();
  const reverseEdges = new Map<string, Set<string>>();

  // Initialize all nodes
  for (const jobId of Object.keys(workflow.jobs)) {
    nodes.add(jobId);
    edges.set(jobId, new Set());
    reverseEdges.set(jobId, new Set());
  }

  // Build edges from 'needs' declarations
  for (const [jobId, job] of Object.entries(workflow.jobs)) {
    const needs = normalizeNeedsInput(job.needs);
    for (const need of needs) {
      if (!nodes.has(need)) {
        throw new DependencyError(
          `Job "${jobId}" depends on unknown job "${need}"`,
          [jobId, need]
        );
      }
      getOrCreateGraphSet(edges, jobId).add(need);
      getOrCreateGraphSet(reverseEdges, need).add(jobId);
    }
  }

  return { nodes, edges, reverseEdges };
}

/**
 * Detect circular dependencies in graph
 * Returns the cycle path if found, empty array otherwise
 */
export function detectCycle(graph: DependencyGraph): string[] {
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];

  function dfs(node: string): string[] | null {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const dependencies = graph.edges.get(node) || EMPTY_JOB_SET;
    for (const dep of dependencies) {
      if (!visited.has(dep)) {
        const cycle = dfs(dep);
        if (cycle) return cycle;
      } else if (recursionStack.has(dep)) {
        // Found cycle - return the cycle path
        const cycleStart = path.indexOf(dep);
        return [...path.slice(cycleStart), dep];
      }
    }

    path.pop();
    recursionStack.delete(node);
    return null;
  }

  for (const node of graph.nodes) {
    if (!visited.has(node)) {
      const cycle = dfs(node);
      if (cycle) return cycle;
    }
  }

  return [];
}

function assertAcyclic(graph: DependencyGraph): void {
  const cycle = detectCycle(graph);
  if (cycle.length > 0) {
    throw new DependencyError(
      `Circular dependency detected: ${cycle.join(' -> ')}`,
      cycle
    );
  }
}

/**
 * Group jobs into parallel execution phases
 * Jobs in the same phase can run in parallel
 */
export function groupIntoPhases(graph: DependencyGraph): string[][] {
  // Check for cycles first
  assertAcyclic(graph);

  const phases: string[][] = [];
  const assigned = new Set<string>();

  while (assigned.size < graph.nodes.size) {
    const phase: string[] = [];

    for (const node of graph.nodes) {
      if (assigned.has(node)) continue;

      // Check if all dependencies are assigned
      const dependencies = graph.edges.get(node) || EMPTY_JOB_SET;
      let canAdd = true;
      for (const dep of dependencies) {
        if (!assigned.has(dep)) {
          canAdd = false;
          break;
        }
      }

      if (canAdd) {
        phase.push(node);
      }
    }

    if (phase.length === 0) {
      // This should not happen if cycle detection works
      throw new DependencyError('Unable to resolve dependencies');
    }

    // Sort phase for deterministic order
    phase.sort();
    phases.push(phase);

    for (const node of phase) {
      assigned.add(node);
    }
  }

  return phases;
}

