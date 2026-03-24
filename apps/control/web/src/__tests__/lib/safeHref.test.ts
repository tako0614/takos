import { describe, expect, it } from 'vitest';

import { toSafeHref } from '../../lib/safeHref';

describe('toSafeHref', () => {
  it('blocks dangerous schemes even when obfuscated with whitespace', () => {
    expect(toSafeHref('javascript:alert(1)')).toBeNull();
    expect(toSafeHref('java\nscript:alert(1)')).toBeNull();
    expect(toSafeHref(' data:text/html;base64,PGgxPkJvb208L2gxPg==')).toBeNull();
  });

  it('accepts relative paths and allowed schemes', () => {
    expect(toSafeHref('/store/installed')).toBe('/store/installed');
    expect(toSafeHref('https://takos.jp')).toBe('https://takos.jp');
    expect(toSafeHref('mailto:hello@takos.jp')).toBe('mailto:hello@takos.jp');
  });
});
