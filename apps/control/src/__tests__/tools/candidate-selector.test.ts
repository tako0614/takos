import {
  CandidateSelector,
  DISCOVERY_TOOL_NAMES,
  type SelectionContext,
} from "@/tools/candidate-selector";
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
let selector: CandidateSelector;
const baseCtx: SelectionContext = {
  capabilities: [],
  userQuery: "",
};

Deno.test("CandidateSelector - selects tools up to topK", () => {
  registry = new CapabilityRegistry();
  selector = new CandidateSelector({ topKTools: 5, topKSkills: 2 });
  for (let i = 0; i < 10; i++) {
    registry.register(makeDescriptor({
      id: `tool:t${i}`,
      name: `tool_${i}`,
      family: `fam_${i}`,
    }));
  }

  const result = selector.select(registry, baseCtx);
  assertEquals(result.tools.length, 5);
  assertEquals(result.totalAvailable, 10);
});
Deno.test("CandidateSelector - separates tools from skills", () => {
  registry = new CapabilityRegistry();
  selector = new CandidateSelector({ topKTools: 5, topKSkills: 2 });
  registry.register(makeDescriptor({ id: "tool:a", name: "a", kind: "tool" }));
  registry.register(
    makeDescriptor({ id: "skill:b", name: "b", kind: "skill" }),
  );

  const result = selector.select(registry, baseCtx);
  assertEquals(result.tools.length, 1);
  assertEquals(result.skills.length, 1);
});
Deno.test("CandidateSelector - applies hard filter on policy.selectable", () => {
  registry = new CapabilityRegistry();
  selector = new CandidateSelector({ topKTools: 5, topKSkills: 2 });
  registry.register(makeDescriptor({
    id: "tool:hidden",
    name: "hidden",
    discoverable: true,
    selectable: false,
  }));
  registry.register(makeDescriptor({
    id: "tool:visible",
    name: "visible",
  }));

  const result = selector.select(registry, baseCtx);
  assertEquals(result.tools.map((d) => d.name), ["visible"]);
});
Deno.test("CandidateSelector - filters out high-risk tools for viewers", () => {
  registry = new CapabilityRegistry();
  selector = new CandidateSelector({ topKTools: 5, topKSkills: 2 });
  registry.register(makeDescriptor({
    id: "tool:deploy",
    name: "deploy",
    risk_level: "high",
  }));
  registry.register(makeDescriptor({
    id: "tool:read",
    name: "read",
    risk_level: "none",
  }));

  const result = selector.select(registry, { ...baseCtx, role: "viewer" });
  assertEquals(result.tools.map((d) => d.name), ["read"]);
});
Deno.test("CandidateSelector - scores higher for query-matching tools", () => {
  registry = new CapabilityRegistry();
  selector = new CandidateSelector({ topKTools: 5, topKSkills: 2 });
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
    tags: ["file"],
    summary: "Read a file",
    family: "file.ops",
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    tags: ["web"],
    summary: "Fetch a URL",
    family: "web.fetch",
  }));

  const result = selector.select(registry, {
    ...baseCtx,
    userQuery: "read a file",
  });
  assertEquals(result.tools[0].name, "file_read");
});
Deno.test("CandidateSelector - applies container session state boost", () => {
  registry = new CapabilityRegistry();
  selector = new CandidateSelector({ topKTools: 5, topKSkills: 2 });
  registry.register(makeDescriptor({
    id: "tool:file_list",
    name: "file_list",
    namespace: "file",
    family: "file.ops",
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    namespace: "web",
    family: "web.fetch",
  }));

  const result = selector.select(registry, {
    ...baseCtx,
    sessionState: { hasActiveContainer: true },
  });
  assertEquals(result.tools[0].name, "file_list");
});
Deno.test("CandidateSelector - boosts recently used tools", () => {
  registry = new CapabilityRegistry();
  selector = new CandidateSelector({ topKTools: 5, topKSkills: 2 });
  registry.register(makeDescriptor({
    id: "tool:a",
    name: "a",
    family: "fam_a",
  }));
  registry.register(makeDescriptor({
    id: "tool:b",
    name: "b",
    family: "fam_b",
  }));

  const result = selector.select(registry, {
    ...baseCtx,
    recentToolCalls: ["b"],
  });
  assertEquals(result.tools[0].name, "b");
});
Deno.test("CandidateSelector - enforces diversity (MAX_PER_FAMILY)", () => {
  registry = new CapabilityRegistry();
  selector = new CandidateSelector({ topKTools: 5, topKSkills: 2 });
  // Create 12 tools in the same family — only 8 should survive diversity filter
  for (let i = 0; i < 12; i++) {
    registry.register(makeDescriptor({
      id: `tool:same_${i}`,
      name: `same_${i}`,
      family: "same_family",
    }));
  }

  const bigSelector = new CandidateSelector({ topKTools: 15, topKSkills: 0 });
  const result = bigSelector.select(registry, baseCtx);
  assert(result.tools.length <= 8);
});
Deno.test("CandidateSelector - applies boosted families from skills", () => {
  registry = new CapabilityRegistry();
  selector = new CandidateSelector({ topKTools: 5, topKSkills: 2 });
  registry.register(makeDescriptor({
    id: "tool:container_start",
    name: "container_start",
    family: "container.lifecycle",
  }));
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    family: "web.fetch",
  }));

  const result = selector.select(registry, {
    ...baseCtx,
    boostedFamilies: ["container.lifecycle"],
  });
  assertEquals(result.tools[0].name, "container_start");
});
Deno.test("CandidateSelector - checks required_capabilities", () => {
  registry = new CapabilityRegistry();
  selector = new CandidateSelector({ topKTools: 5, topKSkills: 2 });
  registry.register(makeDescriptor({
    id: "tool:web_fetch",
    name: "web_fetch",
    required_capabilities: ["egress.http"],
  }));
  registry.register(makeDescriptor({
    id: "tool:file_read",
    name: "file_read",
  }));

  // Without egress.http capability → web_fetch filtered out
  const result = selector.select(registry, {
    ...baseCtx,
    capabilities: [],
  });
  // web_fetch has no required_capabilities check in hard filter (it only checks if ALL are present)
  // Since web_fetch has required_capabilities=['egress.http'] and ctx.capabilities=[], it should be filtered
  assertEquals(result.tools.some((d) => d.name === "web_fetch"), false);
  assertEquals(result.tools.some((d) => d.name === "file_read"), true);
});
Deno.test("CandidateSelector - excludes discovery tools from scoring", () => {
  registry = new CapabilityRegistry();
  selector = new CandidateSelector({ topKTools: 5, topKSkills: 2 });
  for (const name of DISCOVERY_TOOL_NAMES) {
    registry.register(makeDescriptor({
      id: `tool:${name}`,
      name,
      namespace: "discovery",
      family: "discovery.search",
    }));
  }
  registry.register(makeDescriptor({ id: "tool:real", name: "real_tool" }));

  const result = selector.select(registry, baseCtx);
  // Discovery tools should NOT be in selected tools
  assertEquals(
    result.tools.every((d) => !DISCOVERY_TOOL_NAMES.has(d.name)),
    true,
  );
  assertEquals(result.tools.some((d) => d.name === "real_tool"), true);
});
Deno.test("CandidateSelector - handles zero tools after filtering", () => {
  registry = new CapabilityRegistry();
  selector = new CandidateSelector({ topKTools: 5, topKSkills: 2 });
  // All tools require a capability the context doesn't have
  registry.register(makeDescriptor({
    id: "tool:gated",
    name: "gated",
    required_capabilities: ["special.cap"],
  }));

  const result = selector.select(registry, { ...baseCtx, capabilities: [] });
  assertEquals(result.tools.length, 0);
  assertEquals(result.totalAvailable, 1);
});
Deno.test("CandidateSelector - limits query terms to prevent performance issues", () => {
  registry = new CapabilityRegistry();
  selector = new CandidateSelector({ topKTools: 5, topKSkills: 2 });
  registry.register(makeDescriptor({
    id: "tool:a",
    name: "a",
    summary: "A tool",
    tags: ["test"],
  }));

  // 200-word query should not cause issues (capped at 50 terms internally)
  const longQuery = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
  const result = selector.select(registry, {
    ...baseCtx,
    userQuery: longQuery,
  });
  assert(result.tools !== undefined);
});
