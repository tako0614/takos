import { describe, it, expect } from 'vitest';
import {
  UPLOAD_PACK_CAPABILITIES,
  RECEIVE_PACK_CAPABILITIES,
  formatCapabilities,
} from '@/services/git-smart/protocol/capabilities';

describe('UPLOAD_PACK_CAPABILITIES', () => {
  it('includes side-band-64k', () => {
    expect(UPLOAD_PACK_CAPABILITIES).toContain('side-band-64k');
  });

  it('is a non-empty array of strings', () => {
    expect(UPLOAD_PACK_CAPABILITIES.length).toBeGreaterThan(0);
    for (const cap of UPLOAD_PACK_CAPABILITIES) {
      expect(typeof cap).toBe('string');
    }
  });
});

describe('RECEIVE_PACK_CAPABILITIES', () => {
  it('includes side-band-64k', () => {
    expect(RECEIVE_PACK_CAPABILITIES).toContain('side-band-64k');
  });

  it('includes report-status', () => {
    expect(RECEIVE_PACK_CAPABILITIES).toContain('report-status');
  });
});

describe('formatCapabilities', () => {
  it('joins capabilities with spaces', () => {
    const result = formatCapabilities(['a', 'b', 'c']);
    expect(result).toBe('a b c');
  });

  it('handles single capability', () => {
    const result = formatCapabilities(['only']);
    expect(result).toBe('only');
  });

  it('handles empty list', () => {
    const result = formatCapabilities([]);
    expect(result).toBe('');
  });
});
