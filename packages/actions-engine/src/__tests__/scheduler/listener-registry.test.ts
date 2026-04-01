import { JobScheduler } from '../../scheduler/job.ts';
import { createBaseContext } from '../../context.ts';
import type { Workflow } from '../../workflow-models.ts';

/**
 * JobScheduler インスタンス生成用の最小ワークフロー
 */
import { assertEquals, assertNotEquals, assert } from 'jsr:@std/assert';

function createMinimalWorkflow(): Workflow {
  return {
    name: 'listener-test',
    on: 'push',
    jobs: {
      a: { 'runs-on': 'ubuntu-latest', steps: [{ run: 'echo ok' }] },
    },
  };
}


  Deno.test('JobScheduler listener management - keeps current emit stable when a listener is removed during emit', async () => {
  const scheduler = new JobScheduler(createMinimalWorkflow());
    const callOrder: string[] = [];

    let unsubscribeSecond = () => {};

    scheduler.on(() => {
      callOrder.push('first');
      unsubscribeSecond();
    });
    unsubscribeSecond = scheduler.on(() => {
      callOrder.push('second');
    });

    // リスナー実行は複数回の emit を発生させる。最初の emit を確認する
    await scheduler.run(createBaseContext());

    // 最初に送信されるイベントは 'workflow:start'。スナップショットを
    // 元にした emit なので、1回目には 2 つのリスナーが呼ばれるはず。
    assertEquals(callOrder[0], 'first');
    assertEquals(callOrder[1], 'second');
    // 1回目以降は二番目のリスナーは削除されるため、
    // 次の emit では 'first' のみになる。
    const afterFirstEmit = callOrder.slice(2);
    assertEquals(afterFirstEmit.every((v) => v === 'first'), true);
})
  Deno.test('JobScheduler listener management - defers listeners added during emit until the next emit cycle', async () => {
  const scheduler = new JobScheduler(createMinimalWorkflow());
    const callOrder: string[] = [];

    const lateListener = () => {
      callOrder.push('late');
    };

    let addedLate = false;
    scheduler.on(() => {
      callOrder.push('first');
      if (!addedLate) {
        scheduler.on(lateListener);
        addedLate = true;
      }
    });

    await scheduler.run(createBaseContext());

    // 'late' は 1回目の emit には出現せず、後続の emit のみ。
    assertEquals(callOrder[0], 'first');
    assertNotEquals(callOrder[1], 'late');
})
  Deno.test('JobScheduler listener management - continues calling remaining listeners even if an earlier listener throws', async () => {
  const scheduler = new JobScheduler(createMinimalWorkflow());
    const callOrder: string[] = [];

    scheduler.on(() => {
      callOrder.push('first');
      throw new Error('listener failed');
    });
    scheduler.on(() => {
      callOrder.push('second');
    });
    scheduler.on(() => {
      callOrder.push('third');
    });

    // リスナー内で例外が発生しても実行は継続
    await assert((await scheduler.run(createBaseContext())) !== undefined);

    // 最低 1 回目の emit では 3 つのリスナーすべてが呼ばれる
    assertEquals(callOrder.includes('first'), true);
    assertEquals(callOrder.includes('second'), true);
    assertEquals(callOrder.includes('third'), true);
})
