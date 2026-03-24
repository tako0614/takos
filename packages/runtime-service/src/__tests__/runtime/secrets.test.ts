import { describe, expect, it } from 'vitest';
import {
  SecretsSanitizer,
  mightExposeSecrets,
  shouldBlockForSecretExposure,
  createSecretsSanitizer,
  collectSensitiveEnvValues,
} from '../../runtime/actions/secrets.js';

// ---------------------------------------------------------------------------
// SecretsSanitizer
// ---------------------------------------------------------------------------

describe('SecretsSanitizer', () => {
  it('sanitizes known secret values', () => {
    const sanitizer = new SecretsSanitizer();
    sanitizer.registerSecrets({ API_KEY: 'my-secret-key' });

    expect(sanitizer.sanitize('token is my-secret-key here')).toBe('token is *** here');
  });

  it('sanitizes multiple secrets', () => {
    const sanitizer = new SecretsSanitizer();
    sanitizer.registerSecrets({
      KEY1: 'secret1',
      KEY2: 'secret2',
    });

    expect(sanitizer.sanitize('secret1 and secret2')).toBe('*** and ***');
  });

  it('handles empty secrets', () => {
    const sanitizer = new SecretsSanitizer();
    sanitizer.registerSecrets({});
    expect(sanitizer.sanitize('no secrets here')).toBe('no secrets here');
  });

  it('ignores empty string values in secrets', () => {
    const sanitizer = new SecretsSanitizer();
    sanitizer.registerSecrets({ EMPTY: '' });
    expect(sanitizer.sanitize('some text')).toBe('some text');
  });

  it('returns input unchanged when no secrets registered', () => {
    const sanitizer = new SecretsSanitizer();
    expect(sanitizer.sanitize('hello world')).toBe('hello world');
  });

  it('returns empty string unchanged', () => {
    const sanitizer = new SecretsSanitizer();
    sanitizer.registerSecrets({ KEY: 'secret' });
    expect(sanitizer.sanitize('')).toBe('');
  });

  it('handles regex special characters in secrets', () => {
    const sanitizer = new SecretsSanitizer();
    sanitizer.registerSecrets({ KEY: 'special.chars+and*more' });

    expect(sanitizer.sanitize('has special.chars+and*more in it')).toBe('has *** in it');
  });

  it('handles multiple occurrences of same secret', () => {
    const sanitizer = new SecretsSanitizer();
    sanitizer.registerSecrets({ KEY: 'abc' });

    expect(sanitizer.sanitize('abc abc abc')).toBe('*** *** ***');
  });

  it('sanitizes logs array', () => {
    const sanitizer = new SecretsSanitizer();
    sanitizer.registerSecrets({ KEY: 'secret' });

    const logs = ['line with secret', 'clean line', 'another secret'];
    const sanitized = sanitizer.sanitizeLogs(logs);
    expect(sanitized).toEqual(['line with ***', 'clean line', 'another ***']);
  });

  it('handles long secrets via string replacement fallback', () => {
    const longSecret = 'a'.repeat(5000);
    const sanitizer = new SecretsSanitizer();
    sanitizer.registerSecrets({ KEY: longSecret });

    const text = `prefix ${longSecret} suffix`;
    expect(sanitizer.sanitize(text)).toBe('prefix *** suffix');
  });

  it('registerSecretValues adds values', () => {
    const sanitizer = new SecretsSanitizer();
    sanitizer.registerSecretValues(['val1', 'val2']);

    expect(sanitizer.sanitize('val1 and val2')).toBe('*** and ***');
  });

  it('clear removes all secrets', () => {
    const sanitizer = new SecretsSanitizer();
    sanitizer.registerSecrets({ KEY: 'secret' });
    sanitizer.clear();

    expect(sanitizer.sanitize('secret')).toBe('secret');
  });
});

// ---------------------------------------------------------------------------
// createSecretsSanitizer
// ---------------------------------------------------------------------------

describe('createSecretsSanitizer', () => {
  it('creates sanitizer with secrets', () => {
    const sanitizer = createSecretsSanitizer({ KEY: 'value' });
    expect(sanitizer.sanitize('the value is here')).toBe('the *** is here');
  });

  it('masks non-empty secrets regardless of length', () => {
    const sanitizer = createSecretsSanitizer({
      ONE: 'x',
      THREE: 'abc',
      EMPTY: '',
    });

    expect(sanitizer.sanitize('x abc value')).toBe('*** *** value');
  });

  it('creates sanitizer with extra values', () => {
    const sanitizer = createSecretsSanitizer({}, ['extra']);
    expect(sanitizer.sanitize('extra text')).toBe('*** text');
  });

  it('creates sanitizer with both secrets and extras', () => {
    const sanitizer = createSecretsSanitizer({ KEY: 'secret' }, ['extra']);
    expect(sanitizer.sanitize('secret and extra')).toBe('*** and ***');
  });
});

// ---------------------------------------------------------------------------
// mightExposeSecrets
// ---------------------------------------------------------------------------

describe('mightExposeSecrets', () => {
  it('detects bare "env" command', () => {
    expect(mightExposeSecrets('env')).not.toBeNull();
    expect(mightExposeSecrets('  env  ')).not.toBeNull();
  });

  it('detects bare "printenv" command', () => {
    expect(mightExposeSecrets('printenv')).not.toBeNull();
  });

  it('detects "export -p"', () => {
    expect(mightExposeSecrets('export -p')).not.toBeNull();
  });

  it('returns null for safe commands', () => {
    expect(mightExposeSecrets('echo hello')).toBeNull();
    expect(mightExposeSecrets('npm install')).toBeNull();
  });

  it('returns null for env with arguments', () => {
    expect(mightExposeSecrets('env VAR=value command')).toBeNull();
  });

  it('returns null for printenv with arguments', () => {
    expect(mightExposeSecrets('printenv HOME')).toBeNull();
  });

  it('skips comment lines', () => {
    expect(mightExposeSecrets('# env')).toBeNull();
  });

  it('skips empty lines', () => {
    expect(mightExposeSecrets('\n\n')).toBeNull();
  });

  it('detects in multiline command', () => {
    expect(mightExposeSecrets('echo hello\nenv')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// shouldBlockForSecretExposure
// ---------------------------------------------------------------------------

describe('shouldBlockForSecretExposure', () => {
  it('blocks bare env', () => {
    expect(shouldBlockForSecretExposure('env')).toBe(true);
  });

  it('does not block safe commands', () => {
    expect(shouldBlockForSecretExposure('npm test')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// collectSensitiveEnvValues
// ---------------------------------------------------------------------------

describe('collectSensitiveEnvValues', () => {
  it('returns empty array for undefined env', () => {
    expect(collectSensitiveEnvValues(undefined)).toEqual([]);
  });

  it('returns empty array for env with no sensitive keys', () => {
    expect(collectSensitiveEnvValues({ CI: 'true', NODE_ENV: 'test' })).toEqual([]);
  });

  it('collects TAKOS_TOKEN value', () => {
    expect(collectSensitiveEnvValues({ TAKOS_TOKEN: 'tok123' })).toEqual(['tok123']);
  });

  it('collects TAKOS_SESSION_ID value', () => {
    expect(collectSensitiveEnvValues({ TAKOS_SESSION_ID: 'sess123' })).toEqual(['sess123']);
  });

  it('collects keys matching SECRET pattern', () => {
    expect(collectSensitiveEnvValues({ MY_SECRET: 'val' })).toEqual(['val']);
  });

  it('collects keys matching PASSWORD pattern', () => {
    expect(collectSensitiveEnvValues({ DB_PASSWORD: 'pass' })).toEqual(['pass']);
  });

  it('collects keys matching TOKEN pattern', () => {
    expect(collectSensitiveEnvValues({ API_TOKEN: 'tok' })).toEqual(['tok']);
  });

  it('collects keys matching API_KEY pattern', () => {
    expect(collectSensitiveEnvValues({ MY_API_KEY: 'key' })).toEqual(['key']);
  });

  it('collects keys matching AUTH pattern', () => {
    expect(collectSensitiveEnvValues({ AUTH_HEADER: 'bearer xyz' })).toEqual(['bearer xyz']);
  });

  it('skips empty values', () => {
    expect(collectSensitiveEnvValues({ MY_SECRET: '' })).toEqual([]);
  });

  it('collects multiple sensitive values', () => {
    const result = collectSensitiveEnvValues({
      TAKOS_TOKEN: 'tok',
      MY_SECRET: 'sec',
      SAFE_KEY: 'safe',
    });
    expect(result).toContain('tok');
    expect(result).toContain('sec');
    expect(result).not.toContain('safe');
  });
});
