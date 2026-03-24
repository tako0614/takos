import { describe, expect, it } from 'vitest';
import { diffLinesLcs } from '@/utils/lcs-diff';

describe('diffLinesLcs', () => {
  it('produces equal ops for identical input', () => {
    const ops = diffLinesLcs(['a', 'b'], ['a', 'b']);
    expect(ops).toEqual([
      { type: 'equal', line: 'a' },
      { type: 'equal', line: 'b' },
    ]);
  });

  it('handles insertion', () => {
    const ops = diffLinesLcs(['a', 'c'], ['a', 'b', 'c']);
    expect(ops).toEqual([
      { type: 'equal', line: 'a' },
      { type: 'insert', line: 'b' },
      { type: 'equal', line: 'c' },
    ]);
  });

  it('handles deletion', () => {
    const ops = diffLinesLcs(['a', 'b', 'c'], ['a', 'c']);
    expect(ops).toEqual([
      { type: 'equal', line: 'a' },
      { type: 'delete', line: 'b' },
      { type: 'equal', line: 'c' },
    ]);
  });
});

