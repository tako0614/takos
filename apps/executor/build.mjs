import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { buildContainer } from '../../scripts/build-container.mjs';

const appDir = dirname(fileURLToPath(import.meta.url));

await buildContainer({
  appDir,
  name: 'takos-executor',
  external: [
    '@takos/actions-engine',
    '@langchain/langgraph',
    '@langchain/core',
    '@langchain/openai',
    '@anthropic-ai/sdk',
    '@google/generative-ai',
    'jszip',
    'yaml',
  ],
});
