import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ExecutionContext } from '../../types.js';
import {
  evaluateExpression,
  ExpressionError,
  interpolateString,
} from '../../parser/expression.js';

function createContext(): ExecutionContext {
  return {
    github: { actor: 'tester', workspace: process.cwd() },
    env: {},
    vars: {},
    secrets: {},
    runner: {},
    job: { status: 'success' },
    steps: {},
    needs: {},
  } as ExecutionContext;
}

describe('expression resource limits', () => {
  it('throws ExpressionError when expression size exceeds 64KiB', () => {
    const context = createContext();
    const oversized = 'a'.repeat(64 * 1024 + 1);
    const expr = `\${{ ${oversized} }}`;

    expect(() => evaluateExpression(expr, context)).toThrowError(ExpressionError);
    expect(() => evaluateExpression(expr, context)).toThrow(
      /Expression size limit exceeded/
    );
  });

  it('throws ExpressionError when evaluate call count exceeds 10000', () => {
    const context = createContext();
    const manyArgs = ',1'.repeat(10_000);
    const expr = `\${{ format('x'${manyArgs}) }}`;

    expect(() => evaluateExpression(expr, context)).toThrowError(ExpressionError);
    expect(() => evaluateExpression(expr, context)).toThrow(
      /Expression evaluate call limit exceeded/
    );
  });

  it('throws ExpressionError when parseAccess depth exceeds 128', () => {
    const context = createContext();
    const deepAccess = 'github' + '.a'.repeat(129);
    const expr = `\${{ ${deepAccess} }}`;

    expect(() => evaluateExpression(expr, context)).toThrowError(ExpressionError);
    expect(() => evaluateExpression(expr, context)).toThrow(
      /Expression access depth limit exceeded/
    );
  });
});

describe('expression property hardening', () => {
  it('blocks dangerous prototype-chain keys', () => {
    const context = createContext();
    const blockedKeys = ['__proto__', 'constructor', 'prototype'];

    for (const key of blockedKeys) {
      const expr = `\${{ github.${key} }}`;
      expect(evaluateExpression(expr, context)).toBeUndefined();
    }
  });
});

describe('expression function behavior', () => {
  it('returns empty string when format template is null', () => {
    const context = createContext();
    const expr = "${{ format(null, 'x') }}";

    expect(evaluateExpression(expr, context)).toBe('');
  });

  it('returns empty string when format template is undefined', () => {
    const context = createContext();
    const expr = "${{ format(env.NOT_EXISTS, 'x') }}";

    expect(evaluateExpression(expr, context)).toBe('');
  });

  it('returns SHA-256 hash for a matched file via hashFiles', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'actions-engine-hash-'));
    const content = 'hello hash files\n';
    writeFileSync(join(workspace, 'a.txt'), content);

    try {
      const context = createContext();
      context.github.workspace = workspace;

      const expr = "${{ hashFiles('a.txt') }}";
      const expected = createHash('sha256').update(content).digest('hex');

      expect(evaluateExpression(expr, context)).toBe(expected);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('supports multiple patterns and exclusions in hashFiles', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'actions-engine-hash-'));
    writeFileSync(join(workspace, 'one.txt'), 'one');
    writeFileSync(join(workspace, 'two.txt'), 'two');
    writeFileSync(join(workspace, 'skip.txt'), 'skip');

    try {
      const context = createContext();
      context.github.workspace = workspace;

      const expr = "${{ hashFiles('*.txt', '!skip.txt') }}";
      const oneHash = createHash('sha256').update('one').digest('hex');
      const twoHash = createHash('sha256').update('two').digest('hex');
      const expected = createHash('sha256')
        .update(oneHash)
        .update(twoHash)
        .digest('hex');

      expect(evaluateExpression(expr, context)).toBe(expected);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('expression multiline wrapper support', () => {
  it('evaluates expressions wrapped with ${{ }} across multiple lines', () => {
    const context = createContext();
    const expr = `\${{
      format('{0}-ok', github.actor)
    }}`;

    expect(evaluateExpression(expr, context)).toBe('tester-ok');
  });

  it('interpolates multiline expression blocks in template strings', () => {
    const context = createContext();
    const template = `actor=\${{
      github.actor
    }}`;

    expect(interpolateString(template, context)).toBe('actor=tester');
  });
});
