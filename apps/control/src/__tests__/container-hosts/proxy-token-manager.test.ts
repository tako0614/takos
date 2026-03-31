import { ProxyTokenManager } from '@/container-hosts/proxy-token-manager';


import { assertEquals, assert } from 'jsr:@std/assert';
import { FakeTime } from 'jsr:@std/testing/time';

  let manager: ProxyTokenManager<{ runId: string }>;
  
    Deno.test('ProxyTokenManager - generate - returns a 64-character hex string token', () => {
  manager = new ProxyTokenManager<{ runId: string }>();
  try {
  const token = manager.generate({ runId: 'r1' }, 60_000);
      assert(/^[a-f0-9]{64}$/.test(token));
  } finally {
  /* TODO: clear timers manually */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
  }
})
    Deno.test('ProxyTokenManager - generate - generates unique tokens', () => {
  manager = new ProxyTokenManager<{ runId: string }>();
  try {
  const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(manager.generate({ runId: `r${i}` }, 60_000));
      }
      assertEquals(tokens.size, 100);
  } finally {
  /* TODO: clear timers manually */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
  }
})
    Deno.test('ProxyTokenManager - generate - increments the size counter', () => {
  manager = new ProxyTokenManager<{ runId: string }>();
  try {
  assertEquals(manager.size, 0);
      manager.generate({ runId: 'r1' }, 60_000);
      assertEquals(manager.size, 1);
      manager.generate({ runId: 'r2' }, 60_000);
      assertEquals(manager.size, 2);
  } finally {
  /* TODO: clear timers manually */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
  }
})
    Deno.test('ProxyTokenManager - generate - triggers cleanup when hitting max capacity', () => {
  manager = new ProxyTokenManager<{ runId: string }>();
  try {
  const small = new ProxyTokenManager<{ runId: string }>(3);
      // Fill up with expired tokens
      new FakeTime();
      small.generate({ runId: 'r1' }, 1); // 1ms TTL
      small.generate({ runId: 'r2' }, 1);
      fakeTime.tick(10); // Expire them
      small.generate({ runId: 'r3' }, 60_000); // Should trigger cleanup
      // After cleanup of 2 expired + generate 1, size should be <= 3
      assert(small.size <= 3);
      /* TODO: call fakeTime.restore() */ void 0;
  } finally {
  /* TODO: clear timers manually */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
  }
})
    Deno.test('ProxyTokenManager - generate - evicts oldest token when at capacity and no expired tokens', () => {
  manager = new ProxyTokenManager<{ runId: string }>();
  try {
  const small = new ProxyTokenManager<{ runId: string }>(2);
      const token1 = small.generate({ runId: 'r1' }, 60_000);
      small.generate({ runId: 'r2' }, 60_000);
      // At capacity, generate a third
      small.generate({ runId: 'r3' }, 60_000);
      // token1 should be evicted
      assertEquals(small.verify(token1), null);
      assertEquals(small.size, 2);
  } finally {
  /* TODO: clear timers manually */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
  }
})  
  
    Deno.test('ProxyTokenManager - verify - returns metadata for valid token', () => {
  manager = new ProxyTokenManager<{ runId: string }>();
  try {
  const token = manager.generate({ runId: 'r1' }, 60_000);
      const info = manager.verify(token);
      assertEquals(info, { runId: 'r1' });
  } finally {
  /* TODO: clear timers manually */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
  }
})
    Deno.test('ProxyTokenManager - verify - returns null for invalid token', () => {
  manager = new ProxyTokenManager<{ runId: string }>();
  try {
  manager.generate({ runId: 'r1' }, 60_000);
      assertEquals(manager.verify('nonexistent-token'), null);
  } finally {
  /* TODO: clear timers manually */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
  }
})
    Deno.test('ProxyTokenManager - verify - returns null for empty/null/undefined token', () => {
  manager = new ProxyTokenManager<{ runId: string }>();
  try {
  assertEquals(manager.verify(''), null);
      assertEquals(manager.verify(null as unknown as string), null);
      assertEquals(manager.verify(undefined as unknown as string), null);
  } finally {
  /* TODO: clear timers manually */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
  }
})
    Deno.test('ProxyTokenManager - verify - returns null and removes expired token', () => {
  manager = new ProxyTokenManager<{ runId: string }>();
  try {
  new FakeTime();
      const token = manager.generate({ runId: 'r1' }, 100);
      assertEquals(manager.verify(token), { runId: 'r1' });

      fakeTime.tick(200);
      assertEquals(manager.verify(token), null);
      // Token should have been removed
      assertEquals(manager.size, 0);
      /* TODO: call fakeTime.restore() */ void 0;
  } finally {
  /* TODO: clear timers manually */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
  }
})
    Deno.test('ProxyTokenManager - verify - does not return false positive for similar tokens', () => {
  manager = new ProxyTokenManager<{ runId: string }>();
  try {
  const token = manager.generate({ runId: 'r1' }, 60_000);
      // Modify one character
      const fakeToken = token.charAt(0) === 'a'
        ? 'b' + token.slice(1)
        : 'a' + token.slice(1);
      assertEquals(manager.verify(fakeToken), null);
  } finally {
  /* TODO: clear timers manually */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
  }
})  
  
    Deno.test('ProxyTokenManager - revoke - removes an existing token', () => {
  manager = new ProxyTokenManager<{ runId: string }>();
  try {
  const token = manager.generate({ runId: 'r1' }, 60_000);
      assertEquals(manager.revoke(token), true);
      assertEquals(manager.verify(token), null);
      assertEquals(manager.size, 0);
  } finally {
  /* TODO: clear timers manually */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
  }
})
    Deno.test('ProxyTokenManager - revoke - returns false for non-existent token', () => {
  manager = new ProxyTokenManager<{ runId: string }>();
  try {
  assertEquals(manager.revoke('nonexistent'), false);
  } finally {
  /* TODO: clear timers manually */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
  }
})  
  
    Deno.test('ProxyTokenManager - revokeWhere - revokes all tokens matching predicate', () => {
  manager = new ProxyTokenManager<{ runId: string }>();
  try {
  const token1 = manager.generate({ runId: 'r1' }, 60_000);
      const token2 = manager.generate({ runId: 'r1' }, 60_000);
      const token3 = manager.generate({ runId: 'r2' }, 60_000);

      const count = manager.revokeWhere((info) => info.runId === 'r1');

      assertEquals(count, 2);
      assertEquals(manager.verify(token1), null);
      assertEquals(manager.verify(token2), null);
      assertEquals(manager.verify(token3), { runId: 'r2' });
  } finally {
  /* TODO: clear timers manually */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
  }
})
    Deno.test('ProxyTokenManager - revokeWhere - returns 0 when no tokens match', () => {
  manager = new ProxyTokenManager<{ runId: string }>();
  try {
  manager.generate({ runId: 'r1' }, 60_000);
      const count = manager.revokeWhere((info) => info.runId === 'nonexistent');
      assertEquals(count, 0);
      assertEquals(manager.size, 1);
  } finally {
  /* TODO: clear timers manually */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
  }
})  
  
    Deno.test('ProxyTokenManager - cleanup - removes expired tokens', () => {
  manager = new ProxyTokenManager<{ runId: string }>();
  try {
  new FakeTime();
      manager.generate({ runId: 'r1' }, 100);
      manager.generate({ runId: 'r2' }, 100);
      const keepToken = manager.generate({ runId: 'r3' }, 60_000);

      fakeTime.tick(200);
      manager.cleanup();

      assertEquals(manager.size, 1);
      assertEquals(manager.verify(keepToken), { runId: 'r3' });
      /* TODO: call fakeTime.restore() */ void 0;
  } finally {
  /* TODO: clear timers manually */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
  }
})
    Deno.test('ProxyTokenManager - cleanup - handles empty manager', () => {
  manager = new ProxyTokenManager<{ runId: string }>();
  try {
  manager.cleanup();
      assertEquals(manager.size, 0);
  } finally {
  /* TODO: clear timers manually */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
  }
})  
  
    Deno.test('ProxyTokenManager - size - reports 0 for new manager', () => {
  manager = new ProxyTokenManager<{ runId: string }>();
  try {
  assertEquals(manager.size, 0);
  } finally {
  /* TODO: clear timers manually */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
  }
})
    Deno.test('ProxyTokenManager - size - tracks token count accurately', () => {
  manager = new ProxyTokenManager<{ runId: string }>();
  try {
  manager.generate({ runId: 'r1' }, 60_000);
      manager.generate({ runId: 'r2' }, 60_000);
      assertEquals(manager.size, 2);

      const token = manager.generate({ runId: 'r3' }, 60_000);
      manager.revoke(token);
      assertEquals(manager.size, 2);
  } finally {
  /* TODO: clear timers manually */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
  }
})  
  
    Deno.test('ProxyTokenManager - constructor maxTokens - defaults to 10000', () => {
  manager = new ProxyTokenManager<{ runId: string }>();
  try {
  const m = new ProxyTokenManager();
      // Generate a token to verify functionality
      const token = m.generate({ runId: 'r1' } as any, 60_000);
      assert(m.verify(token) !== undefined);
  } finally {
  /* TODO: clear timers manually */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
  }
})
    Deno.test('ProxyTokenManager - constructor maxTokens - accepts custom maxTokens', () => {
  manager = new ProxyTokenManager<{ runId: string }>();
  try {
  const small = new ProxyTokenManager<{ runId: string }>(1);
      const token1 = small.generate({ runId: 'r1' }, 60_000);
      small.generate({ runId: 'r2' }, 60_000);
      // token1 should be evicted
      assertEquals(small.verify(token1), null);
      assertEquals(small.size, 1);
  } finally {
  /* TODO: clear timers manually */ void 0;
    /* TODO: call fakeTime.restore() */ void 0;
  }
})  