import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { buildContainer } from '../../scripts/build-container.mjs';

const appDir = dirname(fileURLToPath(import.meta.url));

await buildContainer({
  appDir,
  name: 'takos-browser',
  external: ['playwright-core'],
});
