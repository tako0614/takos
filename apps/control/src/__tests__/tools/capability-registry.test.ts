import { CapabilityRegistry } from "@/tools/capability-registry";
import type { CapabilityDescriptor } from "@/tools/capability-types";

import { assert, assertEquals } from "jsr:@std/assert";

function makeDescriptor(
  overrides: Partial<CapabilityDescriptor> & { id: string; name: string },
): CapabilityDescriptor {
  return {
    kind: "tool",
    namespace: "file",
    summary: "A test tool",
    tags: [],
    risk_level: "none",
    side_effects: false,
    source: "custom",
    discoverable: true,
    selectable: true,
    ...overrides,
  };
}

let registry: CapabilityRegistry;
Deno.test("CapabilityRegistry - registers and retrieves descriptors", () => {
  registry = new CapabilityRegistry();
  const d = makeDescriptor({ id: "tool:file_read", name: "file_read" });
  registry.register(d);

  assertEquals(registry.get("tool:file_read"), d);
  assertEquals(registry.size, 1);
});
Deno.test("CapabilityRegistry - registers multiple descriptors", () => {
  registry = new CapabilityRegistry();
  const d1 = makeDescriptor({ id: "tool:a", name: "a" });
  const d2 = makeDescriptor({ id: "tool:b", name: "b" });
  registry.registerAll([d1, d2]);

  assertEquals(registry.size, 2);
  assertEquals(registry.all().length, 2);
});
Deno.test("CapabilityRegistry - returns undefined for unknown id", () => {
  registry = new CapabilityRegistry();
  assertEquals(registry.get("tool:nonexistent"), undefined);
});
Deno.test("CapabilityRegistry - filters by kind", () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({ id: "tool:a", name: "a", kind: "tool" }));
  registry.register(
    makeDescriptor({ id: "skill:b", name: "b", kind: "skill" }),
  );

  assertEquals(registry.byKind("tool").length, 1);
  assertEquals(registry.byKind("skill").length, 1);
});
Deno.test("CapabilityRegistry - filters by namespace", () => {
  registry = new CapabilityRegistry();
  registry.register(
    makeDescriptor({ id: "tool:a", name: "a", namespace: "file" }),
  );
  registry.register(
    makeDescriptor({ id: "tool:b", name: "b", namespace: "web" }),
  );

  assertEquals(registry.byNamespace("file").length, 1);
  assertEquals(registry.byNamespace("web").length, 1);
});
Deno.test("CapabilityRegistry - filters by family", () => {
  registry = new CapabilityRegistry();
  registry.register(
    makeDescriptor({ id: "tool:a", name: "a", family: "file.ops" }),
  );
  registry.register(
    makeDescriptor({ id: "tool:b", name: "b", family: "file.ops" }),
  );
  registry.register(
    makeDescriptor({ id: "tool:c", name: "c", family: "web.fetch" }),
  );

  assertEquals(registry.byFamily("file.ops").length, 2);
  assertEquals(registry.byFamily("web.fetch").length, 1);
});
Deno.test("CapabilityRegistry - lists families with counts", () => {
  registry = new CapabilityRegistry();
  registry.register(
    makeDescriptor({ id: "tool:a", name: "a", family: "file.ops" }),
  );
  registry.register(
    makeDescriptor({ id: "tool:b", name: "b", family: "file.ops" }),
  );
  registry.register(
    makeDescriptor({ id: "tool:c", name: "c", family: "web.fetch" }),
  );

  const families = registry.families();
  assert(
    families.some((item: any) =>
      JSON.stringify(item) ===
        JSON.stringify({ family: "web.fetch", count: 1 })
    ),
  );
  assert(
    families.some((item: any) =>
      JSON.stringify(item) === JSON.stringify({ family: "file.ops", count: 2 })
    ),
  );
});

Deno.test("CapabilityRegistry - search - finds tools by name", () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    summary: "Read file contents",
    tags: ["file", "read"],
  }));
  registry.register(makeDescriptor({
    id: "tool:file_write",
    name: "file_write",
    summary: "Write content to a file",
    tags: ["file", "write"],
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    summary: "Fetch a URL",
    tags: ["web"],
  }));
  const results = registry.search("file_read");
  assertEquals(results[0].name, "file_read");
});
Deno.test("CapabilityRegistry - search - finds tools by summary text", () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    summary: "Read file contents",
    tags: ["file", "read"],
  }));
  registry.register(makeDescriptor({
    id: "tool:file_write",
    name: "file_write",
    summary: "Write content to a file",
    tags: ["file", "write"],
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    summary: "Fetch a URL",
    tags: ["web"],
  }));
  const results = registry.search("fetch url");
  assertEquals(results[0].name, "web_fetch");
});
Deno.test("CapabilityRegistry - search - finds tools by tags", () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    summary: "Read file contents",
    tags: ["file", "read"],
  }));
  registry.register(makeDescriptor({
    id: "tool:file_write",
    name: "file_write",
    summary: "Write content to a file",
    tags: ["file", "write"],
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    summary: "Fetch a URL",
    tags: ["web"],
  }));
  const results = registry.search("write");
  assertEquals(results.some((d) => d.name === "file_write"), true);
});
Deno.test("CapabilityRegistry - search - respects limit", () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    summary: "Read file contents",
    tags: ["file", "read"],
  }));
  registry.register(makeDescriptor({
    id: "tool:file_write",
    name: "file_write",
    summary: "Write content to a file",
    tags: ["file", "write"],
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    summary: "Fetch a URL",
    tags: ["web"],
  }));
  const results = registry.search("file", { limit: 1 });
  assertEquals(results.length, 1);
});
Deno.test("CapabilityRegistry - search - returns all on empty query with limit", () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    summary: "Read file contents",
    tags: ["file", "read"],
  }));
  registry.register(makeDescriptor({
    id: "tool:file_write",
    name: "file_write",
    summary: "Write content to a file",
    tags: ["file", "write"],
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    summary: "Fetch a URL",
    tags: ["web"],
  }));
  const results = registry.search("", { limit: 2 });
  assertEquals(results.length, 2);
});
Deno.test("CapabilityRegistry - search - returns empty for unmatched query", () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    summary: "Read file contents",
    tags: ["file", "read"],
  }));
  registry.register(makeDescriptor({
    id: "tool:file_write",
    name: "file_write",
    summary: "Write content to a file",
    tags: ["file", "write"],
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    summary: "Fetch a URL",
    tags: ["web"],
  }));
  const results = registry.search("zzz_nonexistent");
  assertEquals(results.length, 0);
});

Deno.test("CapabilityRegistry - search - finds manuals by id and manual aliases", () => {
  registry = new CapabilityRegistry();
  registry.register(makeDescriptor({
    id: "skill:research-brief",
    kind: "skill",
    name: "Research Brief",
    namespace: "web",
    summary: "Research workflow manual",
    tags: ["research"],
    source: "managed_skill",
    selectable: false,
  }));

  assertEquals(registry.search("research-brief")[0].id, "skill:research-brief");
  assertEquals(registry.search("取説")[0].id, "skill:research-brief");
});
