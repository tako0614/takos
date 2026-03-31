import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { assertStringIncludes } from 'jsr:@std/assert';

  Deno.test('runtime app shell - uses the workspace package in ts mode and the built service artifact in js mode', async () => {
  const source = await readFile(
      path.resolve(import.meta.dirname, '../src/index.ts'),
      'utf8',
    );

    assertStringIncludes(source, "const pkg = 'takos-runtime-service';");
    assertStringIncludes(source, "await import(pkg)");
    assertStringIncludes(source, "../../../packages/runtime-service/dist/index.js");
})