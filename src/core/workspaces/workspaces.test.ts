import { expect, test } from "bun:test";

import {
  createWorkspaceCore,
  type NewWorkspace,
  type Workspace,
  type WorkspacePersistence,
} from "./index.ts";

class MemoryWorkspacePersistence implements WorkspacePersistence {
  readonly #rows = new Map<string, Workspace[]>();

  seed(principalId: string, workspace: Workspace): void {
    this.#rows.set(principalId, [
      ...(this.#rows.get(principalId) ?? []),
      workspace,
    ]);
  }

  async isWorkspaceIdAvailable(id: string): Promise<boolean> {
    return !Array.from(this.#rows.values()).flat().some((row) => row.id === id);
  }

  async isWorkspaceSlugAvailable(slug: string): Promise<boolean> {
    return !Array.from(this.#rows.values()).flat().some((row) =>
      row.slug === slug
    );
  }

  async createForPrincipal(
    principalId: string,
    workspace: NewWorkspace,
  ): Promise<Workspace> {
    const row: Workspace = { ...workspace };
    this.#rows.set(principalId, [
      ...(this.#rows.get(principalId) ?? []),
      row,
    ]);
    return row;
  }

  async listForPrincipal(principalId: string): Promise<readonly Workspace[]> {
    return this.#rows.get(principalId) ?? [];
  }

  async resolveForPrincipal(
    principalId: string,
    idOrSlug: string,
  ): Promise<Workspace | null> {
    return (this.#rows.get(principalId) ?? []).find((row) =>
      (idOrSlug === "me" && row.isDefault) || row.id === idOrSlug ||
      row.slug === idOrSlug
    ) ?? null;
  }

  async updateForPrincipal(
    principalId: string,
    workspaceId: string,
    updates: Partial<Workspace>,
  ): Promise<Workspace | null> {
    const rows = this.#rows.get(principalId) ?? [];
    const index = rows.findIndex((row) => row.id === workspaceId);
    if (index === -1) return null;
    const updated = { ...rows[index], ...updates };
    rows[index] = updated;
    return updated;
  }

  async deleteForPrincipal(
    principalId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const rows = this.#rows.get(principalId) ?? [];
    const remaining = rows.filter((row) => row.id !== workspaceId);
    if (remaining.length === rows.length) return false;
    this.#rows.set(principalId, remaining);
    return true;
  }
}

test("a Principal creates and lists only its private Workspace", async () => {
  const workspaces = createWorkspaceCore({
    persistence: new MemoryWorkspacePersistence(),
    clock: { now: () => "2026-08-27T12:00:00.000Z" },
    ids: { nextWorkspaceId: () => "workspace-1" },
  });

  const created = await workspaces.create("principal-a", {
    name: "Deep work",
    description: "Private focus context",
  });

  expect(created).toEqual({
    id: "workspace-1",
    name: "Deep work",
    slug: "deep-work",
    description: "Private focus context",
    isDefault: false,
    securityPosture: "standard",
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
  });
  expect(await workspaces.list("principal-a")).toEqual([created]);
  expect(await workspaces.list("principal-b")).toEqual([]);
});

test("a Workspace resolves by ID or slug only for its Principal", async () => {
  const workspaces = createWorkspaceCore({
    persistence: new MemoryWorkspacePersistence(),
    clock: { now: () => "2026-08-27T12:00:00.000Z" },
    ids: { nextWorkspaceId: () => "workspace-1" },
  });
  const created = await workspaces.create("principal-a", {
    name: "Deep work",
  });

  expect(await workspaces.resolve("principal-a", "workspace-1")).toEqual(
    created,
  );
  expect(await workspaces.resolve("principal-a", "deep-work")).toEqual(
    created,
  );
  expect(await workspaces.resolve("principal-b", "workspace-1")).toBeNull();
});

test("only the Principal can update Workspace metadata", async () => {
  let now = "2026-08-27T12:00:00.000Z";
  const workspaces = createWorkspaceCore({
    persistence: new MemoryWorkspacePersistence(),
    clock: { now: () => now },
    ids: { nextWorkspaceId: () => "workspace-1" },
  });
  await workspaces.create("principal-a", { name: "Deep work" });

  now = "2026-08-27T13:00:00.000Z";
  expect(
    await workspaces.update("principal-a", "deep-work", {
      name: "Focused work",
      description: "  Quiet context  ",
      securityPosture: "restricted_egress",
    }),
  ).toMatchObject({
    id: "workspace-1",
    name: "Focused work",
    description: "Quiet context",
    securityPosture: "restricted_egress",
    updatedAt: now,
  });
  expect(
    await workspaces.update("principal-b", "workspace-1", {
      name: "Spoofed",
    }),
  ).toBeNull();
  expect(await workspaces.resolve("principal-a", "workspace-1"))
    .toHaveProperty("name", "Focused work");
});

test("only the Principal can delete a non-default Workspace", async () => {
  const workspaces = createWorkspaceCore({
    persistence: new MemoryWorkspacePersistence(),
    clock: { now: () => "2026-08-27T12:00:00.000Z" },
    ids: { nextWorkspaceId: () => "workspace-1" },
  });
  await workspaces.create("principal-a", { name: "Deep work" });

  expect(await workspaces.delete("principal-b", "workspace-1")).toBe(false);
  expect(await workspaces.delete("principal-a", "deep-work")).toBe(true);
  expect(await workspaces.resolve("principal-a", "workspace-1")).toBeNull();
});

test("the core rejects blank, oversized, and malformed identity inputs", async () => {
  const persistence = new MemoryWorkspacePersistence();
  const createCore = (workspaceId: string) =>
    createWorkspaceCore({
      persistence,
      clock: { now: () => "2026-08-27T12:00:00.000Z" },
      ids: { nextWorkspaceId: () => workspaceId },
    });

  await expect(createCore("workspace-1").create("principal-a", { name: " " }))
    .rejects.toThrow("Workspace name");
  await expect(
    createCore("workspace-1").create("principal-a", { name: "x".repeat(121) }),
  ).rejects.toThrow("Workspace name");
  await expect(
    createCore("workspace-1").create("principal-a", {
      name: "Valid",
      description: "x".repeat(2_001),
    }),
  ).rejects.toThrow("Workspace description");
  await expect(createCore("workspace-1").create(" ", { name: "Valid" }))
    .rejects.toThrow("Principal ID");
  await expect(
    createCore("workspace-1").create("p".repeat(129), { name: "Valid" }),
  ).rejects.toThrow("Principal ID");
  await expect(createCore("bad workspace id").create("principal-a", {
    name: "Valid",
  })).rejects.toThrow("Workspace ID");
  await expect(createCore("w".repeat(129)).create("principal-a", {
    name: "Valid",
  })).rejects.toThrow("Workspace ID");
  await expect(
    createCore("workspace-1").resolve("principal-a", "w".repeat(129)),
  ).rejects.toThrow("Workspace ID");
});

test("the default Workspace cannot be deleted", async () => {
  const persistence = new MemoryWorkspacePersistence();
  persistence.seed("principal-a", {
    id: "principal-a",
    name: "Default",
    slug: "principal-a",
    description: null,
    isDefault: true,
    securityPosture: "standard",
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
  });
  const workspaces = createWorkspaceCore({
    persistence,
    clock: { now: () => "2026-08-27T12:00:00.000Z" },
    ids: { nextWorkspaceId: () => "workspace-1" },
  });

  expect(await workspaces.delete("principal-a", "me")).toBe(false);
  expect(await workspaces.resolve("principal-a", "principal-a"))
    .not.toBeNull();
});

test("slug allocation preserves a uniqueness suffix at the length boundary", async () => {
  const persistence = new MemoryWorkspacePersistence();
  const workspaces = createWorkspaceCore({
    persistence,
    clock: { now: () => "2026-08-27T12:00:00.000Z" },
    ids: { nextWorkspaceId: () => "workspace-2" },
  });
  persistence.seed("principal-a", {
    id: "workspace-1",
    name: "Existing",
    slug: "a".repeat(32),
    description: null,
    isDefault: false,
    securityPosture: "standard",
    createdAt: "2026-08-27T12:00:00.000Z",
    updatedAt: "2026-08-27T12:00:00.000Z",
  });

  const created = await workspaces.create("principal-a", {
    name: "a".repeat(32),
  });

  expect(created.slug).toBe(`${"a".repeat(30)}-1`);
});
