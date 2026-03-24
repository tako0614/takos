/**
 * Unified Error Classification.
 *
 * Consolidates error severity classification from executor.ts,
 * executor-host.ts, and workflow handlers into a single utility.
 */

export type ErrorSeverity = 'fatal' | 'retriable' | 'user_error';

export interface ErrorClassification {
  severity: ErrorSeverity;
  code?: string;
  category:
    | 'permission'
    | 'validation'
    | 'network'
    | 'timeout'
    | 'internal'
    | 'not_found'
    | 'rate_limit'
    | 'unknown';
  retryable: boolean;
  userFacing: boolean;
}

/* ------------------------------------------------------------------ */
/*  Pattern lists                                                      */
/* ------------------------------------------------------------------ */

const FATAL_PATTERNS = [
  'not configured',
  'permission denied',
  'unauthorized',
  'not found',
  'invalid path',
  'does not exist',
  'access denied',
];

const USER_ERROR_PATTERNS = [
  'invalid',
  'required',
  'missing',
  'malformed',
  'expected',
  'must be',
  'cannot be empty',
];

const NETWORK_PATTERNS = [
  'econnrefused',
  'econnreset',
  'etimedout',
  'dns',
  'socket hang up',
  'network',
  'fetch failed',
];

/* ------------------------------------------------------------------ */
/*  Error-code → category / severity mapping                           */
/* ------------------------------------------------------------------ */

interface CodeMapping {
  severity: ErrorSeverity;
  category: ErrorClassification['category'];
}

const CODE_MAP: Record<string, CodeMapping> = {
  E_CONFIG: { severity: 'fatal', category: 'internal' },
  E_PERMISSION: { severity: 'fatal', category: 'permission' },
  E_UNAUTHORIZED: { severity: 'fatal', category: 'permission' },
  E_NOT_FOUND: { severity: 'fatal', category: 'not_found' },
  E_INVALID_PATH: { severity: 'fatal', category: 'validation' },
  E_VALIDATION: { severity: 'fatal', category: 'validation' },
  E_INVALID_INPUT: { severity: 'user_error', category: 'validation' },
  E_MISSING_REQUIRED: { severity: 'user_error', category: 'validation' },
  E_INVALID_ARGUMENT: { severity: 'user_error', category: 'validation' },
  E_TIMEOUT: { severity: 'retriable', category: 'timeout' },
  E_NETWORK: { severity: 'retriable', category: 'network' },
  E_SERVICE_UNAVAILABLE: { severity: 'retriable', category: 'network' },
  E_RATE_LIMITED: { severity: 'retriable', category: 'rate_limit' },
  E_INTERNAL: { severity: 'retriable', category: 'internal' },
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function matchesAny(text: string, patterns: string[]): boolean {
  for (const p of patterns) {
    if (text.includes(p)) return true;
  }
  return false;
}

function categoryForFatal(text: string): ErrorClassification['category'] {
  if (text.includes('permission denied') || text.includes('unauthorized') || text.includes('access denied')) {
    return 'permission';
  }
  if (text.includes('not found') || text.includes('does not exist')) {
    return 'not_found';
  }
  return 'validation';
}

function categoryForNetwork(text: string): ErrorClassification['category'] {
  if (text.includes('etimedout')) return 'timeout';
  return 'network';
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Classify an error into severity, category, and retry information.
 *
 * Resolution order:
 * 1. Explicit error-code brackets, e.g. `[E_CONFIG]`
 * 2. Message-based pattern matching (fatal → user_error → network → retriable)
 */
export function classifyError(error: Error | string): ErrorClassification {
  const message = typeof error === 'string' ? error : error.message;
  const lower = message.toLowerCase();

  // 1. Try explicit error-code extraction  [E_XXX]
  const codeMatch = message.match(/\[(E_[A-Z_]+)\]/);
  if (codeMatch) {
    const code = codeMatch[1];
    const mapping = CODE_MAP[code];
    if (mapping) {
      return {
        severity: mapping.severity,
        code,
        category: mapping.category,
        retryable: mapping.severity === 'retriable',
        userFacing: mapping.severity === 'user_error' || mapping.severity === 'fatal',
      };
    }
  }

  // 2. Fatal patterns
  if (matchesAny(lower, FATAL_PATTERNS)) {
    const category = categoryForFatal(lower);
    return {
      severity: 'fatal',
      category,
      retryable: false,
      userFacing: true,
    };
  }

  // 3. User-error patterns
  if (matchesAny(lower, USER_ERROR_PATTERNS)) {
    return {
      severity: 'user_error',
      category: 'validation',
      retryable: false,
      userFacing: true,
    };
  }

  // 4. Network / transient patterns (retriable)
  if (matchesAny(lower, NETWORK_PATTERNS)) {
    const category = categoryForNetwork(lower);
    return {
      severity: 'retriable',
      category,
      retryable: true,
      userFacing: false,
    };
  }

  // 5. Fallback: unknown retriable error
  return {
    severity: 'retriable',
    category: 'unknown',
    retryable: true,
    userFacing: false,
  };
}

/**
 * Convenience wrapper — returns `true` when the error can be retried.
 */
export function isRetryable(error: Error | string): boolean {
  return classifyError(error).retryable;
}

/**
 * Return a short, user-facing hint that describes recovery options for the
 * given classification.
 */
export function getErrorHint(classification: ErrorClassification): string {
  switch (classification.category) {
    case 'permission':
      return '(Check your credentials and permissions)';
    case 'validation':
      return '(Review the input parameters for correctness)';
    case 'network':
      return '(A network error occurred — retrying may help)';
    case 'timeout':
      return '(The operation timed out — retrying may help)';
    case 'not_found':
      return '(The requested resource was not found)';
    case 'rate_limit':
      return '(Rate limited — wait before retrying)';
    case 'internal':
      if (classification.retryable) {
        return '(An internal error occurred — retrying may help)';
      }
      return '(This error cannot be resolved by retrying)';
    case 'unknown':
    default:
      if (!classification.retryable) {
        return '(This error cannot be resolved by retrying)';
      }
      return '(An unexpected error occurred — retrying may help)';
  }
}
