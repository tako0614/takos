async function main(): Promise<void> {
  // In dev we run this file via ts-node, so importing the TS workspace package is fine.
  // In production we run `node dist/index.js`, so we must import a JS build artifact.
  const pkg = '@takoserver/runtime-service';
  const mod: typeof import('@takoserver/runtime-service') = import.meta.url.endsWith('.ts')
    ? await import(pkg)
    : await import(new URL('../../../packages/runtime-service/dist/index.js', import.meta.url).href);

  mod.startRuntimeService();
}

void main();
