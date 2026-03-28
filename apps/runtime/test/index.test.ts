import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('runtime app shell', () => {
  it('uses the workspace package in ts mode and the built service artifact in js mode', async () => {
    const source = await readFile(
      path.resolve(import.meta.dirname, '../src/index.ts'),
      'utf8',
    );

    expect(source).toContain("const pkg = 'takos-runtime-service';");
    expect(source).toContain("await import(pkg)");
    expect(source).toContain("../../../packages/runtime-service/dist/index.js");
  });
});
