import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database } from '@takos/cloudflare-compat';

function createMockDrizzleDb() {
  const getMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    get: getMock,
  };
  return {
    select: vi.fn(() => chain),
    _: { get: getMock, chain },
  };
}

const db = createMockDrizzleDb();

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  return { ...actual, getDb: mocks.getDb };
});

import { getSpaceLocale } from '@/services/identity/locale';

describe('getSpaceLocale', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDb.mockReturnValue(db);
  });

  it('returns "ja" when metadata row contains "ja"', async () => {
    db._.get.mockResolvedValueOnce({ value: 'ja' });

    const result = await getSpaceLocale({} as D1Database, 'space-1');
    expect(result).toBe('ja');
  });

  it('returns "en" when metadata row contains "en"', async () => {
    db._.get.mockResolvedValueOnce({ value: 'en' });

    const result = await getSpaceLocale({} as D1Database, 'space-1');
    expect(result).toBe('en');
  });

  it('returns null when no metadata row exists', async () => {
    db._.get.mockResolvedValueOnce(null);

    const result = await getSpaceLocale({} as D1Database, 'space-1');
    expect(result).toBeNull();
  });

  it('returns null when metadata value is not a valid locale', async () => {
    db._.get.mockResolvedValueOnce({ value: 'fr' });

    const result = await getSpaceLocale({} as D1Database, 'space-1');
    expect(result).toBeNull();
  });

  it('returns null when metadata value is undefined', async () => {
    db._.get.mockResolvedValueOnce({ value: undefined });

    const result = await getSpaceLocale({} as D1Database, 'space-1');
    expect(result).toBeNull();
  });

  it('returns null when metadata value is null', async () => {
    db._.get.mockResolvedValueOnce({ value: null });

    const result = await getSpaceLocale({} as D1Database, 'space-1');
    expect(result).toBeNull();
  });
});
