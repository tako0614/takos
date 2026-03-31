import type { BillingMode, BillingTopupPack } from '../../types/index.ts';

export function sortBillingTopupPacks(packs: BillingTopupPack[]): BillingTopupPack[] {
  return [...packs].sort((left, right) => {
    if (left.featured !== right.featured) {
      return left.featured ? -1 : 1;
    }
    if (left.credits_cents !== right.credits_cents) {
      return left.credits_cents - right.credits_cents;
    }
    return left.label.localeCompare(right.label);
  });
}

export function formatBillingCurrency(cents: number, language: 'ja' | 'en', currency = 'USD'): string {
  const locale = language === 'ja' ? 'ja-JP' : 'en-US';
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(cents / 100);
  }
}

export function formatBillingDate(
  value: string | number | null | undefined,
  language: 'ja' | 'en',
): string {
  if (value == null) {
    return '-';
  }

  const date = typeof value === 'number'
    ? new Date(value * 1000)
    : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat(language === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function describeBillingMode(mode: BillingMode): 'free' | 'plus' | 'pro' {
  if (mode === 'plus_subscription') {
    return 'plus';
  }
  if (mode === 'pro_prepaid') {
    return 'pro';
  }
  return 'free';
}
