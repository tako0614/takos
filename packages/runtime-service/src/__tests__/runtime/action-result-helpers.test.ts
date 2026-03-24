import { describe, expect, it } from 'vitest';
import { appendOutput, buildCombinedResult } from '../../runtime/actions/action-result-helpers.js';

// ---------------------------------------------------------------------------
// appendOutput
// ---------------------------------------------------------------------------

describe('appendOutput', () => {
  it('appends stdout and stderr', () => {
    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];

    appendOutput(
      { exitCode: 0, stdout: 'out1', stderr: 'err1', outputs: {}, conclusion: 'success' },
      stdoutParts,
      stderrParts,
    );

    expect(stdoutParts).toEqual(['out1']);
    expect(stderrParts).toEqual(['err1']);
  });

  it('skips empty stdout', () => {
    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];

    appendOutput(
      { exitCode: 0, stdout: '', stderr: 'err', outputs: {}, conclusion: 'success' },
      stdoutParts,
      stderrParts,
    );

    expect(stdoutParts).toEqual([]);
    expect(stderrParts).toEqual(['err']);
  });

  it('skips empty stderr', () => {
    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];

    appendOutput(
      { exitCode: 0, stdout: 'out', stderr: '', outputs: {}, conclusion: 'success' },
      stdoutParts,
      stderrParts,
    );

    expect(stdoutParts).toEqual(['out']);
    expect(stderrParts).toEqual([]);
  });

  it('accumulates multiple results', () => {
    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];

    appendOutput(
      { exitCode: 0, stdout: 'out1', stderr: 'err1', outputs: {}, conclusion: 'success' },
      stdoutParts,
      stderrParts,
    );
    appendOutput(
      { exitCode: 0, stdout: 'out2', stderr: 'err2', outputs: {}, conclusion: 'success' },
      stdoutParts,
      stderrParts,
    );

    expect(stdoutParts).toEqual(['out1', 'out2']);
    expect(stderrParts).toEqual(['err1', 'err2']);
  });

  it('handles undefined stdout/stderr', () => {
    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];

    appendOutput(
      { exitCode: 0, stdout: undefined as any, stderr: undefined as any, outputs: {}, conclusion: 'success' },
      stdoutParts,
      stderrParts,
    );

    expect(stdoutParts).toEqual([]);
    expect(stderrParts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildCombinedResult
// ---------------------------------------------------------------------------

describe('buildCombinedResult', () => {
  it('builds success result', () => {
    const result = buildCombinedResult(
      ['out1', 'out2'],
      ['err1'],
      { key: 'value' },
      'success',
    );

    expect(result).toEqual({
      exitCode: 0,
      stdout: 'out1\nout2',
      stderr: 'err1',
      outputs: { key: 'value' },
      conclusion: 'success',
    });
  });

  it('builds failure result with exit code 1', () => {
    const result = buildCombinedResult([], [], {}, 'failure');
    expect(result.exitCode).toBe(1);
    expect(result.conclusion).toBe('failure');
  });

  it('trims trailing whitespace from joined output', () => {
    const result = buildCombinedResult(['line1  ', 'line2  '], [], {}, 'success');
    expect(result.stdout).toBe('line1  \nline2');
  });

  it('handles empty arrays', () => {
    const result = buildCombinedResult([], [], {}, 'success');
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('preserves outputs object', () => {
    const outputs = { a: '1', b: '2' };
    const result = buildCombinedResult([], [], outputs, 'success');
    expect(result.outputs).toEqual({ a: '1', b: '2' });
  });
});
