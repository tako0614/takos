import { expect, test } from "bun:test";

test("Workspace core imports only neutral sibling modules", async () => {
  const productionFiles = [
    "index.ts",
    "types.ts",
    "workspaces.ts",
  ];

  for (const filename of productionFiles) {
    const source = await Bun.file(`${import.meta.dir}/${filename}`).text();
    const importSpecifiers = Array.from(
      source.matchAll(/from\s+["']([^"']+)["']/g),
      (match) => match[1],
    );

    expect(importSpecifiers.every((specifier) => specifier.startsWith("./")))
      .toBe(true);
    expect(source).not.toMatch(
      /(?:hono|drizzle|cloudflare|takosumi|takoform|@takos\/)/i,
    );
    expect(source).not.toMatch(/\bEnv\b/);
  }
});
