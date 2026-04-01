import { assert, assertEquals } from "jsr:@std/assert";
import { FakeTime } from "jsr:@std/testing/time";
import { ProxyTokenManager } from "@/container-hosts/proxy-token-manager";

function withManager(
  fn: (manager: ProxyTokenManager<{ runId: string }>) => void,
): void {
  const manager = new ProxyTokenManager<{ runId: string }>();
  fn(manager);
}

function withFakeTime(fn: (fakeTime: FakeTime) => void): void {
  const fakeTime = new FakeTime();
  try {
    fn(fakeTime);
  } finally {
    fakeTime.restore();
  }
}

Deno.test("ProxyTokenManager generate returns a 64-character hex token", () => {
  withManager((manager) => {
    const token = manager.generate({ runId: "run-1" }, 60_000);
    assert(/^[a-f0-9]{64}$/.test(token));
  });
});

Deno.test("ProxyTokenManager generate produces unique tokens and tracks size", () => {
  withManager((manager) => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) {
      tokens.add(manager.generate({ runId: `run-${i}` }, 60_000));
    }

    assertEquals(tokens.size, 100);
    assertEquals(manager.size, 100);
  });
});

Deno.test("ProxyTokenManager generate cleans up expired entries at capacity", () => {
  withFakeTime((fakeTime) => {
    const manager = new ProxyTokenManager<{ runId: string }>(3);
    manager.generate({ runId: "run-1" }, 1);
    manager.generate({ runId: "run-2" }, 1);
    fakeTime.tick(10);

    manager.generate({ runId: "run-3" }, 60_000);

    assert(manager.size <= 3);
  });
});

Deno.test("ProxyTokenManager generate evicts the oldest live token at capacity", () => {
  withFakeTime((fakeTime) => {
    const manager = new ProxyTokenManager<{ runId: string }>(2);
    const firstToken = manager.generate({ runId: "run-1" }, 60_000);
    fakeTime.tick(1);
    manager.generate({ runId: "run-2" }, 60_000);
    fakeTime.tick(1);
    manager.generate({ runId: "run-3" }, 60_000);

    assertEquals(manager.verify(firstToken), null);
    assertEquals(manager.size, 2);
  });
});

Deno.test("ProxyTokenManager verify returns metadata for valid tokens", () => {
  withManager((manager) => {
    const token = manager.generate({ runId: "run-1" }, 60_000);
    assertEquals(manager.verify(token), { runId: "run-1" });
  });
});

Deno.test("ProxyTokenManager verify rejects invalid empty and lookalike tokens", () => {
  withManager((manager) => {
    const token = manager.generate({ runId: "run-1" }, 60_000);
    const fakeToken = token[0] === "a"
      ? `b${token.slice(1)}`
      : `a${token.slice(1)}`;

    assertEquals(manager.verify(""), null);
    assertEquals(manager.verify("missing-token"), null);
    assertEquals(manager.verify(fakeToken), null);
  });
});

Deno.test("ProxyTokenManager verify removes expired tokens", () => {
  withFakeTime((fakeTime) => {
    const manager = new ProxyTokenManager<{ runId: string }>();
    const token = manager.generate({ runId: "run-1" }, 100);

    assertEquals(manager.verify(token), { runId: "run-1" });
    fakeTime.tick(200);
    assertEquals(manager.verify(token), null);
    assertEquals(manager.size, 0);
  });
});

Deno.test("ProxyTokenManager revoke removes matching tokens only", () => {
  withManager((manager) => {
    const token = manager.generate({ runId: "run-1" }, 60_000);

    assertEquals(manager.revoke(token), true);
    assertEquals(manager.revoke(token), false);
    assertEquals(manager.size, 0);
  });
});

Deno.test("ProxyTokenManager revokeWhere removes all matching entries", () => {
  withManager((manager) => {
    const token1 = manager.generate({ runId: "run-1" }, 60_000);
    const token2 = manager.generate({ runId: "run-1" }, 60_000);
    const token3 = manager.generate({ runId: "run-2" }, 60_000);

    const revoked = manager.revokeWhere((info) => info.runId === "run-1");

    assertEquals(revoked, 2);
    assertEquals(manager.verify(token1), null);
    assertEquals(manager.verify(token2), null);
    assertEquals(manager.verify(token3), { runId: "run-2" });
  });
});

Deno.test("ProxyTokenManager cleanup drops expired tokens and keeps live ones", () => {
  withFakeTime((fakeTime) => {
    const manager = new ProxyTokenManager<{ runId: string }>();
    manager.generate({ runId: "run-1" }, 100);
    manager.generate({ runId: "run-2" }, 100);
    const keepToken = manager.generate({ runId: "run-3" }, 60_000);

    fakeTime.tick(200);
    manager.cleanup();

    assertEquals(manager.size, 1);
    assertEquals(manager.verify(keepToken), { runId: "run-3" });
  });
});

Deno.test("ProxyTokenManager constructor defaults remain usable", () => {
  const manager = new ProxyTokenManager<{ runId: string }>();
  const token = manager.generate({ runId: "run-1" }, 60_000);
  assert(manager.verify(token) !== null);
});
