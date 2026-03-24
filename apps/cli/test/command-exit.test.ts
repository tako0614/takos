import { describe, expect, it } from 'vitest';
import { CliCommandExit, cliExit, isCliCommandExit } from '../src/lib/command-exit.js';

describe('command exit helper', () => {
  it('throws typed exit error with requested code', () => {
    try {
      cliExit(7);
      throw new Error('unreachable');
    } catch (error) {
      expect(error).toBeInstanceOf(CliCommandExit);
      expect(isCliCommandExit(error)).toBe(true);
      expect((error as CliCommandExit).code).toBe(7);
    }
  });

  it('narrows only command exit errors', () => {
    expect(isCliCommandExit(new Error('test'))).toBe(false);
  });
});
