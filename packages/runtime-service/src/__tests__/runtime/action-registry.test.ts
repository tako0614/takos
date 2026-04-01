import {
  buildInputEnv,
  parseActionRef,
  resolveInputs,
  validateActionComponent,
} from "../../runtime/actions/action-registry.ts";

import { assertEquals, assertThrows } from "jsr:@std/assert";

Deno.test("parseActionRef", () => {
  assertEquals(parseActionRef("actions/checkout@v4"), {
    owner: "actions",
    repo: "checkout",
    actionPath: "",
    ref: "v4",
  });
  assertEquals(parseActionRef("actions/toolkit/packages/core@v1"), {
    owner: "actions",
    repo: "toolkit",
    actionPath: "packages/core",
    ref: "v1",
  });
  assertEquals(parseActionRef("owner/repo"), {
    owner: "owner",
    repo: "repo",
    actionPath: "",
    ref: "main",
  });
  assertEquals(parseActionRef("owner/repo@"), {
    owner: "owner",
    repo: "repo",
    actionPath: "",
    ref: "main",
  });
  assertEquals(parseActionRef("single@v1"), {
    owner: "single",
    repo: "",
    actionPath: "",
    ref: "v1",
  });
  assertEquals(parseActionRef("org/repo/a/b/c@v2"), {
    owner: "org",
    repo: "repo",
    actionPath: "a/b/c",
    ref: "v2",
  });
});

Deno.test("validateActionComponent", () => {
  validateActionComponent("actions", "owner");
  validateActionComponent("my-repo_v2", "repo");
  validateActionComponent("v1.0.0", "ref");
  assertThrows(() => validateActionComponent("path/to", "owner"));
  assertThrows(() => validateActionComponent("has space", "repo"));
  assertThrows(() => validateActionComponent("bad@char", "ref"));
  assertThrows(() => validateActionComponent("", "owner"));
});

Deno.test("resolveInputs", () => {
  const definitions = {
    name: { description: "Name", required: true },
  };
  assertEquals(resolveInputs(definitions, { name: "John" }), {
    resolvedInputs: { name: "John" },
    missing: [],
  });

  assertEquals(
    resolveInputs({ name: { description: "Name", default: "Default" } }, {}),
    {
      resolvedInputs: { name: "Default" },
      missing: [],
    },
  );

  assertEquals(resolveInputs(definitions, {}), {
    resolvedInputs: {},
    missing: ["name"],
  });

  assertEquals(
    resolveInputs({ Name: { description: "Name", required: true } }, {
      name: "John",
    }),
    {
      resolvedInputs: { Name: "John" },
      missing: [],
    },
  );

  assertEquals(resolveInputs(undefined, { extra: "value" }), {
    resolvedInputs: { extra: "value" },
    missing: [],
  });

  assertEquals(
    resolveInputs({ flag: { description: "Flag", default: true } }, {}),
    {
      resolvedInputs: { flag: "true" },
      missing: [],
    },
  );

  assertEquals(
    resolveInputs({ val: { description: "Val", default: null } }, {}),
    {
      resolvedInputs: { val: "" },
      missing: [],
    },
  );

  assertEquals(
    resolveInputs({ defined: { description: "Defined" } }, {
      defined: "yes",
      extra: "bonus",
    }),
    {
      resolvedInputs: { defined: "yes", extra: "bonus" },
      missing: [],
    },
  );
});

Deno.test("buildInputEnv", () => {
  assertEquals(buildInputEnv({ name: "John", version: "1.0" }), {
    INPUT_NAME: "John",
    INPUT_VERSION: "1.0",
  });
  assertEquals(buildInputEnv({ "my-input": "value" }), {
    INPUT_MY_INPUT: "value",
  });
  assertEquals(buildInputEnv({}), {});
  assertEquals(buildInputEnv({ "dotted.key": "val" }), {
    INPUT_DOTTED_KEY: "val",
  });
});
