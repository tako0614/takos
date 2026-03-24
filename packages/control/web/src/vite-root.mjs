import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = dirname(fileURLToPath(import.meta.url));

export const controlWebRoot = resolve(packageDir, '../../../../apps/control/web');

export default controlWebRoot;
