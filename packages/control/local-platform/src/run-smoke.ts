import { disposeNodePlatformState } from '../../src/node-platform/env-builder.ts';
import { runLocalSmoke } from '../../src/local-platform/run-smoke.ts';
import { isDirectEntrypoint, logEntrypointError } from './direct-entrypoint.ts';

export { runLocalSmoke };

export async function runLocalSmokeCommand(): Promise<void> {
  try {
    const payload = await runLocalSmoke();
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await disposeNodePlatformState();
  }
}

if (await isDirectEntrypoint(import.meta.url)) {
  runLocalSmokeCommand().catch(logEntrypointError);
}
