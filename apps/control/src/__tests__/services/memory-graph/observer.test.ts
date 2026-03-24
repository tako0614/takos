import { describe, expect, it, beforeEach } from 'vitest';
import { createToolObserver } from '@/services/memory-graph/observer';
import { RunOverlay } from '@/services/memory-graph/overlay';

describe('ToolObserver', () => {
  let overlay: RunOverlay;
  const accountId = 'acct1';
  const runId = 'run1';

  beforeEach(() => {
    overlay = new RunOverlay();
  });

  it('creates claim + evidence from remember tool', () => {
    const observer = createToolObserver(accountId, runId, overlay);

    observer.observe({
      toolName: 'remember',
      arguments: {
        content: 'User prefers TypeScript over JavaScript',
        type: 'semantic',
      },
      result: 'Remembered (semantic): User prefers TypeScript...',
      timestamp: Date.now(),
    });

    const claims = observer.getOverlayClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0].claimType).toBe('fact');
    expect(claims[0].subject).toBe('User');
    expect(claims[0].predicate).toBe('prefers');

    const evidence = observer.getOverlayEvidence();
    expect(evidence).toHaveLength(1);
    expect(evidence[0].kind).toBe('supports');
    expect(evidence[0].trust).toBe(0.9);
  });

  it('creates claim from remember with procedural type', () => {
    const observer = createToolObserver(accountId, runId, overlay);

    observer.observe({
      toolName: 'remember',
      arguments: {
        content: 'Deploy process uses Cloudflare Workers',
        type: 'procedural',
      },
      result: 'Remembered',
      timestamp: Date.now(),
    });

    const claims = observer.getOverlayClaims();
    expect(claims).toHaveLength(1);
    expect(claims[0].claimType).toBe('preference');
  });

  it('adds taint evidence on tool errors for related claims', () => {
    const observer = createToolObserver(accountId, runId, overlay);

    // First, create a claim that mentions a tool
    overlay.addClaim({
      id: 'c1',
      accountId,
      claimType: 'fact',
      subject: 'file_read',
      predicate: 'is',
      object: 'working',
    });

    // Observe a tool error
    observer.observe({
      toolName: 'file_read',
      arguments: { path: '/nonexistent' },
      result: '',
      error: 'File not found',
      timestamp: Date.now(),
    });

    const evidence = observer.getOverlayEvidence();
    expect(evidence.length).toBeGreaterThanOrEqual(1);
    const taintedEvidence = evidence.find(e => e.taint === 'tool_error');
    expect(taintedEvidence).toBeDefined();
    expect(taintedEvidence!.trust).toBe(0.5);
  });

  it('adds context evidence from recall tool', () => {
    const observer = createToolObserver(accountId, runId, overlay);

    // Pre-populate overlay with a claim
    overlay.addClaim({
      id: 'c1',
      accountId,
      claimType: 'fact',
      subject: 'deployment',
      predicate: 'uses',
      object: 'Workers',
    });

    observer.observe({
      toolName: 'recall',
      arguments: { query: 'deployment' },
      result: 'Found 2 memories about deployment...',
      timestamp: Date.now(),
    });

    const evidence = observer.getOverlayEvidence();
    const contextEvidence = evidence.find(e => e.sourceType === 'memory_recall');
    expect(contextEvidence).toBeDefined();
    expect(contextEvidence!.kind).toBe('context');
  });

  it('ignores remember with no content', () => {
    const observer = createToolObserver(accountId, runId, overlay);

    observer.observe({
      toolName: 'remember',
      arguments: { type: 'semantic' },
      result: '',
      timestamp: Date.now(),
    });

    expect(observer.getOverlayClaims()).toHaveLength(0);
  });

  it('never throws on observer errors', () => {
    const observer = createToolObserver(accountId, runId, overlay);

    // Should not throw even with unusual input
    expect(() => {
      observer.observe({
        toolName: 'remember',
        arguments: { content: null as unknown as string, type: 'semantic' },
        result: '',
        timestamp: Date.now(),
      });
    }).not.toThrow();
  });
});
