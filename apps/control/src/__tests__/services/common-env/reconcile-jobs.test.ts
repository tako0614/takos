import { describe, it, expect } from 'vitest';
import { CommonEnvReconcileJobStore } from '@/services/common-env/reconcile-jobs';

describe('CommonEnvReconcileJobStore.parseTargetKeys', () => {
  it('parses valid JSON array of strings', () => {
    const result = CommonEnvReconcileJobStore.parseTargetKeys({ targetKeysJson: '["MY_VAR","ANOTHER"]' });
    expect(result).toEqual(['MY_VAR', 'ANOTHER']);
  });

  it('returns undefined for null targetKeysJson', () => {
    const result = CommonEnvReconcileJobStore.parseTargetKeys({ targetKeysJson: null });
    expect(result).toBeUndefined();
  });

  it('returns undefined for invalid JSON', () => {
    const result = CommonEnvReconcileJobStore.parseTargetKeys({ targetKeysJson: 'not-json' });
    expect(result).toBeUndefined();
  });

  it('returns undefined for non-array JSON', () => {
    const result = CommonEnvReconcileJobStore.parseTargetKeys({ targetKeysJson: '{"key":"val"}' });
    expect(result).toBeUndefined();
  });

  it('filters out non-string elements', () => {
    const result = CommonEnvReconcileJobStore.parseTargetKeys({ targetKeysJson: '["MY_VAR", 123, null, "ANOTHER"]' });
    expect(result).toEqual(['MY_VAR', 'ANOTHER']);
  });

  it('returns undefined for empty array', () => {
    const result = CommonEnvReconcileJobStore.parseTargetKeys({ targetKeysJson: '[]' });
    expect(result).toBeUndefined();
  });

  it('returns undefined for array of all non-strings', () => {
    const result = CommonEnvReconcileJobStore.parseTargetKeys({ targetKeysJson: '[1, 2, 3]' });
    expect(result).toBeUndefined();
  });
});
