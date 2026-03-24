import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '@/tools/types';
import type { D1Database } from '@takos/cloudflare-compat';
import type { Env } from '@/types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSelectGet = vi.fn();
const mockSelectAll = vi.fn();
const platformServiceMocks = vi.hoisted(() => ({
  resolveServiceReferenceRecord: vi.fn(),
  getServiceRouteRecord: vi.fn(),
}));

vi.mock('@/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db')>();
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    get: vi.fn(() => mockSelectGet()),
    all: vi.fn(() => mockSelectAll()),
  };
  return {
    ...actual,
    getDb: () => ({
      select: vi.fn(() => chain),
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          run: vi.fn(async () => ({})),
        })),
      })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => ({})),
        })),
      })),
      delete: vi.fn(() => ({
        where: vi.fn(async () => ({})),
      })),
    }),
  };
});

const mockDesiredState = {
  listLocalEnvVarSummaries: vi.fn(),
  replaceLocalEnvVars: vi.fn(),
  listResourceBindings: vi.fn(),
  replaceResourceBindings: vi.fn(),
  getRuntimeConfig: vi.fn(),
  saveRuntimeConfig: vi.fn(),
  getRoutingTarget: vi.fn(),
};

vi.mock('@/services/platform/worker-desired-state', () => ({
  createWorkerDesiredStateService: vi.fn(() => mockDesiredState),
  createServiceDesiredStateService: vi.fn(() => mockDesiredState),
}));

const mockDeploymentService = {
  getDeploymentHistory: vi.fn(),
  getDeploymentById: vi.fn(),
  getDeploymentEvents: vi.fn(),
  getMaskedEnvVars: vi.fn(),
  getBindings: vi.fn(),
  rollback: vi.fn(),
};

vi.mock('@/services/deployment/index', () => ({
  createDeploymentService: vi.fn(() => mockDeploymentService),
}));

vi.mock('@/services/platform/workers', () => ({
  resolveWorkerReferenceRecord: platformServiceMocks.resolveServiceReferenceRecord,
  resolveServiceReferenceRecord: platformServiceMocks.resolveServiceReferenceRecord,
  getWorkerRouteRecord: platformServiceMocks.getServiceRouteRecord,
  getServiceRouteRecord: platformServiceMocks.getServiceRouteRecord,
}));

vi.mock('@/services/common-env', () => ({
  createCommonEnvService: vi.fn(() => ({
    reconcileWorkerCommonEnv: vi.fn(),
  })),
}));

vi.mock('@/services/common-env/crypto', () => ({
  normalizeCommonEnvName: vi.fn((name: string) => name),
}));

vi.mock('@/services/routing', () => ({
  upsertHostnameRouting: vi.fn(),
  deleteHostnameRouting: vi.fn(),
}));

vi.mock('@/platform/providers/cloudflare/custom-domains', () => ({
  deleteCloudflareCustomHostname: vi.fn(),
}));

vi.mock('@/shared/utils', () => ({
  generateId: vi.fn(() => 'gen-id'),
  now: vi.fn(() => '2026-01-01T00:00:00.000Z'),
  toIsoString: vi.fn((v: unknown) => typeof v === 'string' ? v : null),
  safeJsonParseOrDefault: vi.fn((_raw: unknown, fallback: unknown) => fallback),
}));

import { resolveServiceReferenceRecord, getServiceRouteRecord } from '@/services/platform/workers';

import {
  PLATFORM_TOOLS,
  PLATFORM_HANDLERS,
  SERVICE_ENV_GET,
  SERVICE_ENV_SET,
  SERVICE_BINDINGS_GET,
  SERVICE_BINDINGS_SET,
  SERVICE_RUNTIME_GET,
  SERVICE_RUNTIME_SET,
  workerEnvGetHandler,
  workerEnvSetHandler,
  workerRuntimeSetHandler,
  DOMAIN_LIST,
  DOMAIN_ADD,
  DOMAIN_VERIFY,
  DOMAIN_REMOVE,
  domainListHandler,
  domainAddHandler,
  domainRemoveHandler,
  SERVICE_LIST,
  SERVICE_CREATE,
  SERVICE_DELETE,
  workerListHandler,
  workerCreateHandler,
  workerDeleteHandler,
  DEPLOYMENT_HISTORY,
  DEPLOYMENT_GET,
  DEPLOYMENT_ROLLBACK,
  deploymentHistoryHandler,
  deploymentGetHandler,
  deploymentRollbackHandler,
} from '@/tools/builtin/platform';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    spaceId: 'ws-test',
    threadId: 'thread-1',
    runId: 'run-1',
    userId: 'user-1',
    capabilities: [],
    env: {
      TENANT_BASE_DOMAIN: 'takos.dev',
    } as unknown as Env,
    db: {} as D1Database,
    setSessionId: vi.fn(),
    getLastContainerStartFailure: vi.fn(() => undefined),
    setLastContainerStartFailure: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Aggregate definitions
// ---------------------------------------------------------------------------

describe('PLATFORM_TOOLS and PLATFORM_HANDLERS', () => {
  it('exports combined tool list with all sub-modules', () => {
    const names = PLATFORM_TOOLS.map((t) => t.name);
    // Worker settings
    expect(names).toContain('service_env_get');
    expect(names).toContain('service_env_set');
    expect(names).toContain('service_bindings_get');
    expect(names).toContain('service_bindings_set');
    expect(names).toContain('service_runtime_get');
    expect(names).toContain('service_runtime_set');
    // Domains
    expect(names).toContain('domain_list');
    expect(names).toContain('domain_add');
    expect(names).toContain('domain_verify');
    expect(names).toContain('domain_remove');
    // Deployments
    expect(names).toContain('service_list');
    expect(names).toContain('service_create');
    expect(names).toContain('service_delete');
    // Deployment history
    expect(names).toContain('deployment_history');
    expect(names).toContain('deployment_get');
    expect(names).toContain('deployment_rollback');
  });

  it('all tools have deploy category', () => {
    for (const def of PLATFORM_TOOLS) {
      expect(def.category).toBe('deploy');
    }
  });

  it('PLATFORM_HANDLERS maps all tools', () => {
    for (const def of PLATFORM_TOOLS) {
      expect(PLATFORM_HANDLERS).toHaveProperty(def.name);
    }
  });
});

// ---------------------------------------------------------------------------
// Worker settings definitions
// ---------------------------------------------------------------------------

describe('service settings definitions', () => {
  it('service_env_get requires service_name', () => {
    expect(SERVICE_ENV_GET.parameters.required).toEqual(['service_name']);
  });

  it('service_env_set requires service_name and env', () => {
    expect(SERVICE_ENV_SET.parameters.required).toEqual(['service_name', 'env']);
  });

  it('service_runtime_set requires service_name', () => {
    expect(SERVICE_RUNTIME_SET.parameters.required).toEqual(['service_name']);
  });
});

// ---------------------------------------------------------------------------
// workerEnvGetHandler
// ---------------------------------------------------------------------------

describe('workerEnvGetHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when service not found', async () => {
    vi.mocked(resolveServiceReferenceRecord).mockResolvedValue(null);
    mockSelectGet.mockResolvedValue(null);

    await expect(
      workerEnvGetHandler({ service_name: 'missing' }, makeContext()),
    ).rejects.toThrow('Service not found');
  });

  it('returns env vars for a service slot', async () => {
    vi.mocked(resolveServiceReferenceRecord).mockResolvedValue({
      id: 'w-1',
      accountId: 'ws-test',
    } as any);
    mockDesiredState.listLocalEnvVarSummaries.mockResolvedValue([
      { name: 'API_KEY', type: 'secret_text' },
      { name: 'DEBUG', type: 'plain_text' },
    ]);

    const result = await workerEnvGetHandler(
      { service_name: 'my-worker' },
      makeContext(),
    );
    expect(result).toContain('API_KEY');
    expect(result).toContain('secret_text');
    expect(result).toContain('DEBUG');
    expect(result).toContain('plain_text');
  });
});

// ---------------------------------------------------------------------------
// workerEnvSetHandler
// ---------------------------------------------------------------------------

describe('workerEnvSetHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects mutation on deployment artifacts', async () => {
    vi.mocked(resolveServiceReferenceRecord).mockResolvedValue(null);
    mockSelectGet.mockResolvedValue({
      id: 'd-1',
      workerId: 'w-1',
      accountId: 'ws-test',
    });

    await expect(
      workerEnvSetHandler(
        { service_name: 'deploy-ref', env: [{ name: 'X', value: 'Y' }] },
        makeContext(),
      ),
    ).rejects.toThrow('immutable');
  });

  it('saves env vars for a service slot', async () => {
    vi.mocked(resolveServiceReferenceRecord).mockResolvedValue({
      id: 'w-1',
      accountId: 'ws-test',
    } as any);

    const result = await workerEnvSetHandler(
      { service_name: 'my-worker', env: [{ name: 'KEY', value: 'VAL' }] },
      makeContext(),
    );

    expect(result).toContain('Saved 1 environment variable');
    expect(mockDesiredState.replaceLocalEnvVars).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// workerRuntimeSetHandler
// ---------------------------------------------------------------------------

describe('workerRuntimeSetHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves runtime config', async () => {
    vi.mocked(resolveServiceReferenceRecord).mockResolvedValue({
      id: 'w-1',
      accountId: 'ws-test',
    } as any);

    const result = await workerRuntimeSetHandler(
      { service_name: 'my-worker', compatibility_date: '2026-01-01' },
      makeContext(),
    );

    expect(result).toContain('Updated runtime configuration');
    expect(mockDesiredState.saveRuntimeConfig).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Domain definitions
// ---------------------------------------------------------------------------

describe('domain definitions', () => {
  it('domain_list requires service_id', () => {
    expect(DOMAIN_LIST.parameters.required).toEqual(['service_id']);
  });

  it('domain_add requires service_id and domain', () => {
    expect(DOMAIN_ADD.parameters.required).toEqual(['service_id', 'domain']);
  });

  it('domain_verify requires service_id and domain', () => {
    expect(DOMAIN_VERIFY.parameters.required).toEqual(['service_id', 'domain']);
  });

  it('domain_remove requires service_id and domain', () => {
    expect(DOMAIN_REMOVE.parameters.required).toEqual(['service_id', 'domain']);
  });
});

describe('domainListHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns no domains message when empty', async () => {
    mockSelectAll.mockResolvedValue([]);

    const result = await domainListHandler({ service_id: 'w-1' }, makeContext());
    expect(result).toContain('No custom domains');
  });

  it('lists domains with status icons', async () => {
    mockSelectAll.mockResolvedValue([
      { domain: 'app.example.com', status: 'active', createdAt: '2026-01-01' },
      { domain: 'staging.example.com', status: 'pending', createdAt: '2026-01-02' },
    ]);

    const result = await domainListHandler({ service_id: 'w-1' }, makeContext());
    expect(result).toContain('app.example.com');
    expect(result).toContain('staging.example.com');
  });
});

describe('domainAddHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects invalid domain format', async () => {
    await expect(
      domainAddHandler({ service_id: 'w-1', domain: 'not valid!' }, makeContext()),
    ).rejects.toThrow('Invalid domain format');
  });
});

describe('domainRemoveHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when domain not found', async () => {
    mockSelectGet.mockResolvedValue(null);

    await expect(
      domainRemoveHandler(
        { service_id: 'w-1', domain: 'missing.example.com' },
        makeContext(),
      ),
    ).rejects.toThrow('Domain not found');
  });
});

// ---------------------------------------------------------------------------
// Worker deployment definitions
// ---------------------------------------------------------------------------

describe('service deployment definitions', () => {
  it('service_list has no required params', () => {
    expect(SERVICE_LIST.parameters.required).toBeUndefined();
  });

  it('service_create requires name and type', () => {
    expect(SERVICE_CREATE.parameters.required).toEqual(['name', 'type']);
  });

  it('service_delete requires service_id and confirm', () => {
    expect(SERVICE_DELETE.parameters.required).toEqual(['service_id', 'confirm']);
  });
});

describe('workerListHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns no workers message when empty', async () => {
    mockSelectAll.mockResolvedValue([]);

    const result = await workerListHandler({}, makeContext());
    expect(result).toBe('No services found.');
  });
});

describe('workerCreateHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a service slot and returns details', async () => {
    const result = await workerCreateHandler(
      { name: 'My App', type: 'app' },
      makeContext(),
    );

    expect(result).toContain('Service slot created');
    expect(result).toContain('gen-id');
    expect(result).toContain('My App');
    expect(result).toContain('app');
  });
});

describe('workerDeleteHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when confirm is not true', async () => {
    await expect(
      workerDeleteHandler({ service_id: 'w-1', confirm: false }, makeContext()),
    ).rejects.toThrow('Must set confirm=true');
  });

  it('throws when service not found', async () => {
    vi.mocked(getServiceRouteRecord).mockResolvedValue(null);

    await expect(
      workerDeleteHandler({ service_id: 'w-1', confirm: true }, makeContext()),
    ).rejects.toThrow('Service not found');
  });
});

// ---------------------------------------------------------------------------
// Deployment history definitions
// ---------------------------------------------------------------------------

describe('deployment history definitions', () => {
  it('deployment_history requires service_id', () => {
    expect(DEPLOYMENT_HISTORY.parameters.required).toEqual(['service_id']);
  });

  it('deployment_get requires service_id and deployment_id', () => {
    expect(DEPLOYMENT_GET.parameters.required).toEqual(['service_id', 'deployment_id']);
  });

  it('deployment_rollback requires service_id', () => {
    expect(DEPLOYMENT_ROLLBACK.parameters.required).toEqual(['service_id']);
  });
});

describe('deploymentHistoryHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when service_id is empty', async () => {
    await expect(
      deploymentHistoryHandler({ service_id: '' }, makeContext()),
    ).rejects.toThrow('service_id is required');
  });

  it('returns deployment history as JSON', async () => {
    mockSelectGet.mockResolvedValue({ id: 'w-1' }); // ensureWorkerInWorkspace
    mockDeploymentService.getDeploymentHistory.mockResolvedValue([
      { id: 'd-1', version: 1, status: 'deployed', created_at: '2026-01-01' },
    ]);

    const result = JSON.parse(
      await deploymentHistoryHandler({ service_id: 'w-1' }, makeContext()),
    );
    expect(result.count).toBe(1);
    expect(result.deployments).toHaveLength(1);
  });
});

describe('deploymentGetHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when service_id is empty', async () => {
    await expect(
      deploymentGetHandler({ service_id: '', deployment_id: 'd-1' }, makeContext()),
    ).rejects.toThrow('service_id is required');
  });

  it('throws when deployment_id is empty', async () => {
    await expect(
      deploymentGetHandler({ service_id: 'w-1', deployment_id: '' }, makeContext()),
    ).rejects.toThrow('deployment_id is required');
  });

  it('throws when deployment not found', async () => {
    mockSelectGet.mockResolvedValue({ id: 'w-1' }); // ensureWorkerInWorkspace
    mockDeploymentService.getDeploymentById.mockResolvedValue(null);

    await expect(
      deploymentGetHandler({ service_id: 'w-1', deployment_id: 'd-1' }, makeContext()),
    ).rejects.toThrow('Deployment not found');
  });
});

describe('deploymentRollbackHandler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when service_id is empty', async () => {
    await expect(
      deploymentRollbackHandler({ service_id: '' }, makeContext()),
    ).rejects.toThrow('service_id is required');
  });

  it('performs rollback', async () => {
    mockSelectGet.mockResolvedValue({ id: 'w-1' }); // ensureWorkerInWorkspace
    mockDeploymentService.rollback.mockResolvedValue({
      id: 'd-2',
      status: 'deploying',
    });

    const result = JSON.parse(
      await deploymentRollbackHandler({ service_id: 'w-1' }, makeContext()),
    );
    expect(result.success).toBe(true);
    expect(result.deployment.id).toBe('d-2');
  });
});
