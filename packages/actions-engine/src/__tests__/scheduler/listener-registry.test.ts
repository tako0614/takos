import { describe, expect, it } from 'vitest';

import { createListenerRegistry } from '../../scheduler/job.js';

describe('listener registry snapshot emits', () => {
  it('keeps current emit stable when a listener is removed during emit', () => {
    const registry = createListenerRegistry<number>();
    const callOrder: string[] = [];

    let unsubscribeSecond = () => {};

    registry.on(() => {
      callOrder.push('first');
      unsubscribeSecond();
    });
    unsubscribeSecond = registry.on(() => {
      callOrder.push('second');
    });

    registry.emit(1);
    expect(callOrder).toEqual(['first', 'second']);

    callOrder.length = 0;
    registry.emit(2);
    expect(callOrder).toEqual(['first']);
  });

  it('defers listeners added during emit until the next emit cycle', () => {
    const registry = createListenerRegistry<number>();
    const callOrder: string[] = [];

    const lateListener = () => {
      callOrder.push('late');
    };

    registry.on(() => {
      callOrder.push('first');
      registry.on(lateListener);
    });

    registry.emit(1);
    expect(callOrder).toEqual(['first']);

    callOrder.length = 0;
    registry.emit(2);
    expect(callOrder).toEqual(['first', 'late']);
  });

  it('continues calling remaining listeners even if an earlier listener throws', () => {
    const registry = createListenerRegistry<number>();
    const callOrder: string[] = [];

    registry.on(() => {
      callOrder.push('first');
      throw new Error('listener failed');
    });
    registry.on(() => {
      callOrder.push('second');
    });
    registry.on(() => {
      callOrder.push('third');
    });

    expect(() => registry.emit(1)).not.toThrow();
    expect(callOrder).toEqual(['first', 'second', 'third']);
  });
});
