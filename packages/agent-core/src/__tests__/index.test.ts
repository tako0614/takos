import { describe, expect, it } from 'vitest';
import * as agentCore from '../index.js';

describe('agent-core exports', () => {
  it('exports executeRunInContainer function', () => {
    expect(typeof agentCore.executeRunInContainer).toBe('function');
  });

  it('exports parseStartPayload function', () => {
    expect(typeof agentCore.parseStartPayload).toBe('function');
  });

  it('exports createConcurrencyGuard function', () => {
    expect(typeof agentCore.createConcurrencyGuard).toBe('function');
  });

  it('exports installGracefulShutdown function', () => {
    expect(typeof agentCore.installGracefulShutdown).toBe('function');
  });
});
