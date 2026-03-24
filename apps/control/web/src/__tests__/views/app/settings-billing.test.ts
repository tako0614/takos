import { describe, expect, it } from 'vitest';

import {
  describeBillingMode,
  formatBillingCurrency,
  formatBillingDate,
  sortBillingTopupPacks,
} from '../../../views/app/settings-billing';

describe('settings billing helpers', () => {
  it('sorts featured packs first and then by credit size', () => {
    expect(sortBillingTopupPacks([
      { id: 'team', label: 'Team', price_id: 'price_team', credits_cents: 10000, featured: false, badge: null },
      { id: 'starter', label: 'Starter', price_id: 'price_starter', credits_cents: 2500, featured: true, badge: 'Popular' },
      { id: 'growth', label: 'Growth', price_id: 'price_growth', credits_cents: 5000, featured: false, badge: null },
    ]).map((pack) => pack.id)).toEqual(['starter', 'growth', 'team']);
  });

  it('formats billing amounts as USD currency', () => {
    expect(formatBillingCurrency(2500, 'en')).toBe('$25.00');
    expect(formatBillingCurrency(2500, 'ja')).toContain('25');
  });

  it('formats billing dates from ISO strings and unix seconds', () => {
    expect(formatBillingDate('2026-03-12T00:00:00.000Z', 'en')).toContain('2026');
    expect(formatBillingDate(1773273600, 'en')).toContain('2026');
    expect(formatBillingDate(null, 'en')).toBe('-');
  });

  it('maps billing modes to display buckets', () => {
    expect(describeBillingMode('free')).toBe('free');
    expect(describeBillingMode('plus_subscription')).toBe('plus');
    expect(describeBillingMode('pro_prepaid')).toBe('pro');
  });
});
