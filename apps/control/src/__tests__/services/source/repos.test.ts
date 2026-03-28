import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { D1Database, R2Bucket } from '@cloudflare/workers-types';

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  checkWorkspaceAccess: vi.fn(),
  isValidOpaqueId: vi.fn().mockReturnValue(true),
  generateId: vi.fn().mockReturnValue('repo-new-id'),
  now: vi.fn().mockReturnValue('2026-03-24T00:00:00.000Z'),
  initRepository: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/db')>()),
  getDb: mocks.getDb,
}));

vi.mock('@/shared/utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/utils')>()),
  checkWorkspaceAccess: mocks.checkWorkspaceAccess,
  generateId: mocks.generateId,
  now: mocks.now,
}));

vi.mock('@/shared/utils/db-guards', () => ({
  isValidOpaqueId: mocks.isValidOpaqueId,
}));

vi.mock('@/services/git-smart', () => ({
  initRepository: mocks.initRepository,
}));

import {
  checkRepoAccess,
  getRepositoryById,
  listRepositoriesBySpace,
  createRepository,
  toApiRepositoryFromDb,
  RepositoryCreationError,
} from '@/services/source/repos';
import { sanitizeRepoName as sanitizeRepositoryName } from '@/utils';

function createDrizzleMock() {
  const getMock = vi.fn();
  const allMock = vi.fn();
  const runMock = vi.fn();
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: getMock,
    all: allMock,
    run: runMock,
  };
  return {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    _: { get: getMock, all: allMock, run: runMock, chain },
  };
}

const makeRepoRow = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'repo-1',
  accountId: 'ws-1',
  name: 'my-repo',
  description: 'Test repo',
  visibility: 'private',
  defaultBranch: 'main',
  forkedFromId: null,
  stars: 5,
  forks: 2,
  gitEnabled: true,
  isOfficial: false,
  officialCategory: null,
  officialMaintainer: null,
  featured: false,
  installCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('sanitizeRepositoryName', () => {
  it('lowercases and replaces invalid characters', () => {
    expect(sanitizeRepositoryName('My Repo!')).toBe('my-repo-');
  });

  it('trims whitespace', () => {
    expect(sanitizeRepositoryName('  hello  ')).toBe('hello');
  });

  it('preserves valid characters', () => {
    expect(sanitizeRepositoryName('my_repo-123')).toBe('my_repo-123');
  });
});

describe('toApiRepositoryFromDb', () => {
  it('maps DB row to API format', () => {
    const row = makeRepoRow();
    const result = toApiRepositoryFromDb(row as any);

    expect(result.id).toBe('repo-1');
    expect(result.space_id).toBe('ws-1');
    expect(result.name).toBe('my-repo');
    expect(result.visibility).toBe('private');
    expect(result.default_branch).toBe('main');
    expect(result.stars).toBe(5);
    expect(result.forks).toBe(2);
  });

  it('normalizes public visibility', () => {
    const row = makeRepoRow({ visibility: 'public' });
    const result = toApiRepositoryFromDb(row as any);
    expect(result.visibility).toBe('public');
  });

  it('defaults non-public visibility to private', () => {
    const row = makeRepoRow({ visibility: 'internal' });
    const result = toApiRepositoryFromDb(row as any);
    expect(result.visibility).toBe('private');
  });
});

describe('checkRepoAccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for invalid repoId', async () => {
    mocks.isValidOpaqueId.mockReturnValueOnce(false);
    const env = { DB: {} as D1Database } as any;
    const result = await checkRepoAccess(env, 'bad-id', 'user-1');
    expect(result).toBeNull();
  });

  it('returns null when repo not found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined);
    mocks.getDb.mockReturnValue(drizzle);
    const env = { DB: {} as D1Database } as any;

    const result = await checkRepoAccess(env, 'repo-1', 'user-1');
    expect(result).toBeNull();
  });

  it('returns access for workspace member', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(makeRepoRow());
    mocks.getDb.mockReturnValue(drizzle);
    mocks.checkWorkspaceAccess.mockResolvedValue({ member: { role: 'editor' } });
    const env = { DB: {} as D1Database } as any;

    const result = await checkRepoAccess(env, 'repo-1', 'user-1');
    expect(result).not.toBeNull();
    expect(result!.role).toBe('editor');
    expect(result!.spaceId).toBe('ws-1');
  });

  it('allows public read for public repos when option set', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(makeRepoRow({ visibility: 'public' }));
    mocks.getDb.mockReturnValue(drizzle);
    mocks.checkWorkspaceAccess.mockResolvedValue(null);
    const env = { DB: {} as D1Database } as any;

    const result = await checkRepoAccess(env, 'repo-1', null, undefined, { allowPublicRead: true });
    expect(result).not.toBeNull();
    expect(result!.role).toBe('viewer');
  });

  it('returns null for private repos without membership', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(makeRepoRow({ visibility: 'private' }));
    mocks.getDb.mockReturnValue(drizzle);
    mocks.checkWorkspaceAccess.mockResolvedValue(null);
    const env = { DB: {} as D1Database } as any;

    const result = await checkRepoAccess(env, 'repo-1', 'user-1');
    expect(result).toBeNull();
  });
});

describe('getRepositoryById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null for invalid id', async () => {
    mocks.isValidOpaqueId.mockReturnValueOnce(false);
    const result = await getRepositoryById({} as D1Database, 'bad');
    expect(result).toBeNull();
  });

  it('returns mapped repo when found', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(makeRepoRow());
    mocks.getDb.mockReturnValue(drizzle);

    const result = await getRepositoryById({} as D1Database, 'repo-1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('repo-1');
  });
});

describe('listRepositoriesBySpace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array when no repos exist', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await listRepositoriesBySpace({} as D1Database, 'ws-1');
    expect(result).toEqual([]);
  });

  it('maps all repo rows', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.all.mockResolvedValueOnce([makeRepoRow(), makeRepoRow({ id: 'repo-2', name: 'second' })]);
    mocks.getDb.mockReturnValue(drizzle);

    const result = await listRepositoriesBySpace({} as D1Database, 'ws-1');
    expect(result).toHaveLength(2);
  });
});

describe('createRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws INVALID_NAME for empty name', async () => {
    const drizzle = createDrizzleMock();
    mocks.getDb.mockReturnValue(drizzle);

    await expect(
      createRepository({} as D1Database, {} as R2Bucket, { spaceId: 'ws-1', name: '!!!' }),
    ).rejects.toThrow(RepositoryCreationError);
  });

  it('throws SPACE_NOT_FOUND when workspace does not exist', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get.mockResolvedValueOnce(undefined); // workspace lookup
    mocks.getDb.mockReturnValue(drizzle);

    try {
      await createRepository({} as D1Database, {} as R2Bucket, { spaceId: 'ws-1', name: 'my-repo' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RepositoryCreationError);
      expect((err as RepositoryCreationError).code).toBe('SPACE_NOT_FOUND');
    }
  });

  it('throws REPOSITORY_EXISTS when name is taken', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get
      .mockResolvedValueOnce({ id: 'ws-1' }) // workspace found
      .mockResolvedValueOnce({ id: 'existing-repo' }); // existing repo
    mocks.getDb.mockReturnValue(drizzle);

    try {
      await createRepository({} as D1Database, {} as R2Bucket, { spaceId: 'ws-1', name: 'my-repo' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RepositoryCreationError);
      expect((err as RepositoryCreationError).code).toBe('REPOSITORY_EXISTS');
    }
  });

  it('throws GIT_STORAGE_NOT_CONFIGURED when bucket is undefined', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get
      .mockResolvedValueOnce({ id: 'ws-1' }) // workspace found
      .mockResolvedValueOnce(undefined); // no existing repo
    mocks.getDb.mockReturnValue(drizzle);

    try {
      await createRepository({} as D1Database, undefined, { spaceId: 'ws-1', name: 'my-repo' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RepositoryCreationError);
      expect((err as RepositoryCreationError).code).toBe('GIT_STORAGE_NOT_CONFIGURED');
    }
  });

  it('rolls back on git init failure', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get
      .mockResolvedValueOnce({ id: 'ws-1' }) // workspace found
      .mockResolvedValueOnce(undefined) // no existing repo
      .mockResolvedValueOnce(undefined); // actor lookup
    mocks.getDb.mockReturnValue(drizzle);
    mocks.initRepository.mockRejectedValue(new Error('git init failed'));

    try {
      await createRepository({} as D1Database, {} as R2Bucket, { spaceId: 'ws-1', name: 'my-repo' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(RepositoryCreationError);
      expect((err as RepositoryCreationError).code).toBe('INIT_FAILED');
      expect(drizzle.delete).toHaveBeenCalled();
    }
  });

  it('creates repo and initializes git successfully', async () => {
    const drizzle = createDrizzleMock();
    drizzle._.get
      .mockResolvedValueOnce({ id: 'ws-1' }) // workspace found
      .mockResolvedValueOnce(undefined) // no existing repo
      .mockResolvedValueOnce({ name: 'User', slug: 'user', email: 'user@test.com' }) // actor
      .mockResolvedValueOnce(makeRepoRow({ id: 'repo-new-id' })); // re-read after insert
    mocks.getDb.mockReturnValue(drizzle);
    mocks.initRepository.mockResolvedValue(undefined);

    const result = await createRepository({} as D1Database, {} as R2Bucket, {
      spaceId: 'ws-1',
      name: 'my-repo',
      actorAccountId: 'user-1',
    });

    expect(result.id).toBe('repo-new-id');
    expect(drizzle.insert).toHaveBeenCalled();
    expect(mocks.initRepository).toHaveBeenCalled();
  });
});
