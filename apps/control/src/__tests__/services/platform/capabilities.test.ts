import { describe, expect, it } from 'vitest';

import {
  filterBindingsByCapabilities,
  selectAllowedCapabilities,
} from '@/services/platform/capabilities';

describe('selectAllowedCapabilities', () => {
  it('grants non-AI tenant resource capabilities to editors', () => {
    const allowed = selectAllowedCapabilities({
      role: 'editor',
      securityPosture: 'standard',
      tenantType: 'third_party',
    });

    expect(allowed.has('queue.write')).toBe(true);
    expect(allowed.has('analytics.write')).toBe(true);
    expect(allowed.has('workflow.invoke')).toBe(true);
  });
});

describe('filterBindingsByCapabilities', () => {
  it('allows queue, analytics, and workflow bindings when their capabilities are granted', () => {
    const { allowedBindings, deniedBindings } = filterBindingsByCapabilities({
      allowed: new Set(['queue.write', 'analytics.write', 'workflow.invoke']),
      bindings: [
        { type: 'queue', name: 'JOB_QUEUE', queue_name: 'jobs' },
        { type: 'analytics_engine', name: 'EVENTS', dataset: 'events' },
        { type: 'workflow', name: 'PUBLISH_FLOW', workflow_name: 'publish-flow' },
      ],
    });

    expect(allowedBindings).toHaveLength(3);
    expect(deniedBindings).toEqual([]);
  });

  it('denies workflow bindings without workflow.invoke', () => {
    const { allowedBindings, deniedBindings } = filterBindingsByCapabilities({
      allowed: new Set(['queue.write', 'analytics.write']),
      bindings: [
        { type: 'workflow', name: 'PUBLISH_FLOW', workflow_name: 'publish-flow' },
      ],
    });

    expect(allowedBindings).toEqual([]);
    expect(deniedBindings).toEqual([
      { type: 'workflow', name: 'PUBLISH_FLOW', workflow_name: 'publish-flow' },
    ]);
  });
});
