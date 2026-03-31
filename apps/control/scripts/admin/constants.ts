/**
 * Pattern constants, limits, and table/prefix tokens for admin-cli.
 */

import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Path constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SCRIPTS_DIR = path.resolve(__dirname, '..');
export const CONTROL_APP_DIR = path.resolve(SCRIPTS_DIR, '..');
export const WRANGLER_TOML_PATH = path.resolve(CONTROL_APP_DIR, 'wrangler.toml');
export const AUDIT_LOG_DIR = Deno.env.get('TAKOS_DB_AUDIT_LOG_DIR')?.trim() || path.join(os.homedir(), '.takos', 'audit');
export const AUDIT_LOG_FILE = path.join(AUDIT_LOG_DIR, 'admin-cli-operations.jsonl');

// ---------------------------------------------------------------------------
// Validation patterns and limits
// ---------------------------------------------------------------------------

export const VALID_USER_ID_PATTERN = /^[a-zA-Z0-9_-]{8,64}$/;
export const APPROVAL_ID_PATTERN = /^[A-Za-z0-9._:-]{6,128}$/;
export const DEFAULT_QUERY_LIMIT = 50;
export const MAX_QUERY_LIMIT = 500;
export const DEFAULT_R2_PAGE_SIZE = 100;
export const MAX_R2_PAGE_SIZE = 1000;

export const TENANT_SQL_TABLE_TOKENS = [
  'threads',
  'messages',
  'runs',
  'artifacts',
  'run_events',
  'files',
  'blobs',
  'snapshots',
  'space_stats',
  'usage_events',
  'usage_rollups',
  'repositories',
  'resources',
  'service_bindings',
  'deployments',
  'spaces',
];

export const TENANT_R2_PREFIXES = [
  'threads/',
  'spaces/',
  'tenants/',
  'users/',
  'messages/',
  'runs/',
  'artifacts/',
  'snapshots/',
  'blobs/',
  'repos/',
  'deployments/',
];
