import {
  describeBillingMode,
  formatBillingCurrency,
  formatBillingDate,
  sortBillingTopupPacks,
} from '../../../views/app/settings-billing';


import { assertEquals, assertStringIncludes } from 'jsr:@std/assert';

  Deno.test('settings billing helpers - sorts featured packs first and then by credit size', () => {
  assertEquals(sortBillingTopupPacks([
      { id: 'team', label: 'Team', price_id: 'price_team', credits_cents: 10000, featured: false, badge: null },
      { id: 'starter', label: 'Starter', price_id: 'price_starter', credits_cents: 2500, featured: true, badge: 'Popular' },
      { id: 'growth', label: 'Growth', price_id: 'price_growth', credits_cents: 5000, featured: false, badge: null },
    ]).map((pack) => pack.id), ['starter', 'growth', 'team']);
})
  Deno.test('settings billing helpers - formats billing amounts as USD currency', () => {
  assertEquals(formatBillingCurrency(2500, 'en'), '$25.00');
    assertStringIncludes(formatBillingCurrency(2500, 'ja'), '25');
})
  Deno.test('settings billing helpers - formats billing dates from ISO strings and unix seconds', () => {
  assertStringIncludes(formatBillingDate('2026-03-12T00:00:00.000Z', 'en'), '2026');
    assertStringIncludes(formatBillingDate(1773273600, 'en'), '2026');
    assertEquals(formatBillingDate(null, 'en'), '-');
})
  Deno.test('settings billing helpers - maps billing modes to display buckets', () => {
  assertEquals(describeBillingMode('free'), 'free');
    assertEquals(describeBillingMode('plus_subscription'), 'plus');
    assertEquals(describeBillingMode('pro_prepaid'), 'pro');
})