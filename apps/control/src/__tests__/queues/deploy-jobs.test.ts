import { assertEquals, assert, assertRejects } from 'jsr:@std/assert';
import { assertSpyCalls, assertSpyCallArgs } from 'jsr:@std/testing/mock';

const mocks = ({
  DeploymentService: ((..._args: any[]) => undefined) as any,
  getDb: ((..._args: any[]) => undefined) as any,
});

// [Deno] vi.mock removed - manually stub imports from '@/services/deployment'
// [Deno] vi.mock removed - manually stub imports from '@/db'
import {
  isValidDeploymentQueueMessage,
  handleDeploymentJob,
  handleDeploymentJobDlq,
  type DeploymentQueueMessage,
} from '@/queues/deploy-jobs';

// ---------------------------------------------------------------------------
// Drizzle mock helper
// ---------------------------------------------------------------------------

function createDrizzleMock(opts: {
  updateWhere?: ReturnType<typeof vi.fn>;
} = {}) {
  const updateWhere = opts.updateWhere ?? (async () => ({ meta: { changes: 1 } }));

  return {
    update: () => ({
      set: (() => ({
        where: updateWhere,
      })),
    }),
  };
}

function validDeployMessage(): DeploymentQueueMessage {
  return {
    version: 1,
    type: 'deployment',
    deploymentId: 'deploy-1',
    timestamp: Date.now(),
  };
}
// ---------------------------------------------------------------------------
// isValidDeploymentQueueMessage
// ---------------------------------------------------------------------------


  Deno.test('isValidDeploymentQueueMessage - accepts valid deployment message', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(isValidDeploymentQueueMessage(validDeployMessage()), true);
})
  Deno.test('isValidDeploymentQueueMessage - rejects null', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(isValidDeploymentQueueMessage(null), false);
})
  Deno.test('isValidDeploymentQueueMessage - rejects undefined', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(isValidDeploymentQueueMessage(undefined), false);
})
  Deno.test('isValidDeploymentQueueMessage - rejects non-object', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(isValidDeploymentQueueMessage('string'), false);
    assertEquals(isValidDeploymentQueueMessage(42), false);
})
  Deno.test('isValidDeploymentQueueMessage - rejects wrong version', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(isValidDeploymentQueueMessage({ ...validDeployMessage(), version: 2 }), false);
})
  Deno.test('isValidDeploymentQueueMessage - rejects wrong type', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(isValidDeploymentQueueMessage({ ...validDeployMessage(), type: 'job' }), false);
})
  Deno.test('isValidDeploymentQueueMessage - rejects missing deploymentId', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const msg = { ...validDeployMessage() } as Record<string, unknown>;
    delete msg.deploymentId;
    assertEquals(isValidDeploymentQueueMessage(msg), false);
})
  Deno.test('isValidDeploymentQueueMessage - rejects non-string deploymentId', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(isValidDeploymentQueueMessage({ ...validDeployMessage(), deploymentId: 123 }), false);
})
  Deno.test('isValidDeploymentQueueMessage - rejects missing timestamp', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const msg = { ...validDeployMessage() } as Record<string, unknown>;
    delete msg.timestamp;
    assertEquals(isValidDeploymentQueueMessage(msg), false);
})
  Deno.test('isValidDeploymentQueueMessage - rejects non-number timestamp', () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  assertEquals(isValidDeploymentQueueMessage({ ...validDeployMessage(), timestamp: 'now' }), false);
})
// ---------------------------------------------------------------------------
// handleDeploymentJob
// ---------------------------------------------------------------------------


  Deno.test('handleDeploymentJob - calls executeDeployment on the deployment service', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const executeDeployment = (async () => undefined);
    mocks.DeploymentService = () => ({ executeDeployment }) as any;

    await handleDeploymentJob(validDeployMessage(), {} as any);

    assert(mocks.DeploymentService.calls.length > 0);
    assertSpyCallArgs(executeDeployment, 0, ['deploy-1']);
})
  Deno.test('handleDeploymentJob - throws when executeDeployment fails (allowing queue retry)', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const error = new Error('deployment failed');
    mocks.DeploymentService = () => ({
      executeDeployment: (async () => { throw error; }),
    }) as any;

    await await assertRejects(async () => { await handleDeploymentJob(validDeployMessage(), {} as any); }, 'deployment failed');
})
// ---------------------------------------------------------------------------
// handleDeploymentJobDlq
// ---------------------------------------------------------------------------


  Deno.test('handleDeploymentJobDlq - marks deployment as failed when still in progress', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dbMock = createDrizzleMock();
    mocks.getDb = (() => dbMock) as any;
    mocks.DeploymentService = () => ({
      getDeploymentById: (async () => ({ id: 'deploy-1', status: 'building' })),
    }) as any;

    await handleDeploymentJobDlq(validDeployMessage(), { DB: {} } as any, 5);

    assert(dbMock.update.calls.length > 0);
})
  Deno.test('handleDeploymentJobDlq - does not update when deployment is already successful', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dbMock = createDrizzleMock();
    mocks.getDb = (() => dbMock) as any;
    mocks.DeploymentService = () => ({
      getDeploymentById: (async () => ({ id: 'deploy-1', status: 'success' })),
    }) as any;

    await handleDeploymentJobDlq(validDeployMessage(), { DB: {} } as any, 3);

    assertSpyCalls(dbMock.update, 0);
})
  Deno.test('handleDeploymentJobDlq - does not update when deployment is already rolled_back', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dbMock = createDrizzleMock();
    mocks.getDb = (() => dbMock) as any;
    mocks.DeploymentService = () => ({
      getDeploymentById: (async () => ({ id: 'deploy-1', status: 'rolled_back' })),
    }) as any;

    await handleDeploymentJobDlq(validDeployMessage(), { DB: {} } as any, 3);

    assertSpyCalls(dbMock.update, 0);
})
  Deno.test('handleDeploymentJobDlq - does not update when deployment is not found', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const dbMock = createDrizzleMock();
    mocks.getDb = (() => dbMock) as any;
    mocks.DeploymentService = () => ({
      getDeploymentById: (async () => null),
    }) as any;

    await handleDeploymentJobDlq(validDeployMessage(), { DB: {} } as any, 3);

    assertSpyCalls(dbMock.update, 0);
})
  Deno.test('handleDeploymentJobDlq - throws when deployment status update fails', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  mocks.DeploymentService = () => ({
      getDeploymentById: (async () => { throw new Error('db read failed'); }),
    }) as any;

    await await assertRejects(async () => { await 
      handleDeploymentJobDlq(validDeployMessage(), { DB: {} } as any, 3)
    ; }, 'db read failed');
})
  Deno.test('handleDeploymentJobDlq - updates with correct failure fields', async () => {
  /* mocks cleared (no-op in Deno) */ void 0;
  const updateWhere = (async () => ({ meta: { changes: 1 } }));
    const setFn = (() => ({ where: updateWhere }));
    const dbMock = {
      update: (() => ({ set: setFn })),
    };
    mocks.getDb = (() => dbMock) as any;
    mocks.DeploymentService = () => ({
      getDeploymentById: (async () => ({ id: 'deploy-1', status: 'pending' })),
    }) as any;

    await handleDeploymentJobDlq(validDeployMessage(), { DB: {} } as any, 4);

    assertSpyCallArgs(setFn, 0, [({
      status: 'failed',
      deployState: 'failed',
      stepError: expect.stringContaining('DLQ'),
    })]);
})