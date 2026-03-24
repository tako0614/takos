import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(fileURLToPath(import.meta.url));

export const migrationsDir = resolve(packageDir, '../migrations');

export default {
  migrationsDir,
};
