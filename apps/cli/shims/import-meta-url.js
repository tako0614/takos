// Shim for import.meta.url in CJS context
import { pathToFileURL } from 'url';
export const importMetaUrl = pathToFileURL(__filename).href;
