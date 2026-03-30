import { describe, expect, it } from 'vitest';

import { JobScheduler, type JobSchedulerEvent } from '../../scheduler/job.js';
import { createBaseContext } from '../../context.js';
import type { Workflow } from '../../workflow-models.js';

/**
 * JobScheduler インスタンス生成用の最小ワークフロー
 */
function createMinimalWorkflow(): Workflow {
  return {
    name: 'listener-test',
    on: 'push',
    jobs: {
      a: { 'runs-on': 'ubuntu-latest', steps: [{ run: 'echo ok' }] },
    },
  };
}

describe('JobScheduler listener management', () => {
  it('keeps current emit stable when a listener is removed during emit', async () => {
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
    expect(callOrder[0]).toBe('first');
    expect(callOrder[1]).toBe('second');
    // 1回目以降は二番目のリスナーは削除されるため、
    // 次の emit では 'first' のみになる。
    const afterFirstEmit = callOrder.slice(2);
    expect(afterFirstEmit.every((v) => v === 'first')).toBe(true);
  });

  it('defers listeners added during emit until the next emit cycle', async () => {
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
    expect(callOrder[0]).toBe('first');
    expect(callOrder[1]).not.toBe('late');
  });

  it('continues calling remaining listeners even if an earlier listener throws', async () => {
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
    await expect(scheduler.run(createBaseContext())).resolves.toBeDefined();

    // 最低 1 回目の emit では 3 つのリスナーすべてが呼ばれる
    expect(callOrder.includes('first')).toBe(true);
    expect(callOrder.includes('second')).toBe(true);
    expect(callOrder.includes('third')).toBe(true);
  });
});
