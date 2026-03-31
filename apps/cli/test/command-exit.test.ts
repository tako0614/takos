import { CliCommandExit, cliExit, isCliCommandExit } from '../src/lib/command-exit.ts';


import { assertEquals, assert } from 'jsr:@std/assert';

  Deno.test('command exit helper - throws typed exit error with requested code', () => {
  try {
      cliExit(7);
      throw new Error('unreachable');
    } catch (error) {
      assert(error instanceof CliCommandExit);
      assertEquals(isCliCommandExit(error), true);
      assertEquals((error as CliCommandExit).code, 7);
    }
})
  Deno.test('command exit helper - narrows only command exit errors', () => {
  assertEquals(isCliCommandExit(new Error('test')), false);
})