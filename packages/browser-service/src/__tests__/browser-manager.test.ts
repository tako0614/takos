// deno-lint-ignore-file no-import-prefix no-unversioned-import require-await
import { Buffer } from "node:buffer";
import { BrowserManager } from "../browser-manager.ts";
import { chromium } from "playwright-core";
import { assertEquals, assertRejects } from "jsr:@std/assert";
import { stub } from "jsr:@std/testing/mock";

type MockResponse = { status: () => number };

type MockElement = {
  evaluate: (
    fn: (
      node: {
        tagName: string;
        attributes: Array<{ name: string; value: string }>;
      },
    ) => unknown,
  ) => Promise<unknown>;
  textContent: () => Promise<string | null>;
  scrollIntoViewIfNeeded: () => Promise<void>;
};

type MockPage = {
  goto: (
    url: string,
    options: { waitUntil: "load"; timeout: number },
  ) => Promise<MockResponse | null>;
  url: () => string;
  title: () => Promise<string>;
  content: () => Promise<string>;
  screenshot: (options: { type: "png"; fullPage: boolean }) => Promise<Buffer>;
  pdf: (options: { format: "A4" }) => Promise<Buffer>;
  evaluate: (script: string) => Promise<unknown>;
  $: (selector: string) => Promise<MockElement | null>;
  $$: (selector: string) => Promise<MockElement[]>;
  click: (
    selector: string,
    options?: { button?: "left" | "right" | "middle"; clickCount?: number },
  ) => Promise<void>;
  fill: (selector: string, text: string) => Promise<void>;
  selectOption: (selector: string, value: string) => Promise<void>;
  hover: (selector: string) => Promise<void>;
  check: (selector: string) => Promise<void>;
  uncheck: (selector: string) => Promise<void>;
  focus: (selector: string) => Promise<void>;
  keyboard: { press: (key: string) => Promise<void> };
  mouse: { wheel: (dx: number, dy: number) => Promise<void> };
  close: () => Promise<void>;
  bringToFront: () => Promise<void>;
};

type MockContext = {
  pages: () => MockPage[];
  newPage: () => Promise<MockPage>;
  close: () => Promise<void>;
};

function createPage(overrides: Partial<{
  url: string;
  title: string;
  content: string;
  gotoResponse: MockResponse | null;
  evaluateResult: unknown;
  elements: MockElement[];
  singleElement: MockElement | null;
  screenshot: Buffer;
  pdf: Buffer;
}> = {}): MockPage {
  let currentUrl = overrides.url ?? "about:blank";
  const currentTitle = overrides.title ?? "";
  let currentContent = overrides.content ?? "";

  return {
    goto: async (url) => {
      currentUrl = url;
      return overrides.gotoResponse ?? null;
    },
    url: () => currentUrl,
    title: async () => currentTitle,
    content: async () => currentContent,
    screenshot: async () =>
      overrides.screenshot ?? Buffer.from("fake-png-data"),
    pdf: async () => overrides.pdf ?? Buffer.from("fake-pdf-data"),
    evaluate: async () => overrides.evaluateResult,
    $: async () => overrides.singleElement ?? null,
    $$: async () => overrides.elements ?? [],
    click: async () => undefined,
    fill: async (_selector, text) => {
      currentContent = text;
    },
    selectOption: async () => undefined,
    hover: async () => undefined,
    check: async () => undefined,
    uncheck: async () => undefined,
    focus: async () => undefined,
    keyboard: { press: async () => undefined },
    mouse: { wheel: async () => undefined },
    close: async () => undefined,
    bringToFront: async () => undefined,
  };
}

function createElement(
  tag = "div",
  text = "Hello World",
  attributes: Record<string, string> = { class: "item", id: "el1" },
): MockElement {
  let evalCount = 0;
  return {
    evaluate: async () => {
      if (evalCount++ === 0) {
        return tag;
      }
      return attributes;
    },
    textContent: async () => `  ${text}  `,
    scrollIntoViewIfNeeded: async () => undefined,
  };
}

function attachPageLifecycle(page: MockPage, pages: MockPage[]) {
  page.close = async () => {
    const index = pages.indexOf(page);
    if (index >= 0) {
      pages.splice(index, 1);
    }
  };
}

function createContext(options: {
  pages?: MockPage[];
  closeImpl?: () => Promise<void>;
} = {}): { context: MockContext; pages: MockPage[]; closeCalls: () => number } {
  const pages = [...(options.pages ?? [])];
  let closeCalls = 0;

  for (const page of pages) {
    attachPageLifecycle(page, pages);
  }

  const context: MockContext = {
    pages: () => pages,
    newPage: async () => {
      const page = createPage();
      attachPageLifecycle(page, pages);
      pages.push(page);
      return page;
    },
    close: async () => {
      closeCalls += 1;
      if (options.closeImpl) {
        await options.closeImpl();
      }
    },
  };

  return { context, pages, closeCalls: () => closeCalls };
}

async function withBrowserHarness(
  options: {
    pages?: MockPage[];
    closeImpl?: () => Promise<void>;
  } = {},
  fn: (
    tools: {
      manager: BrowserManager;
      pages: MockPage[];
      closeCalls: () => number;
    },
  ) => Promise<void>,
) {
  const harness = createContext(options);
  const chromiumMock = chromium as unknown as {
    launchPersistentContext: (...args: unknown[]) => Promise<unknown>;
  };
  const launchStub = stub(
    chromiumMock,
    "launchPersistentContext",
    async () => harness.context,
  );

  try {
    await fn({
      manager: new BrowserManager(),
      pages: harness.pages,
      closeCalls: harness.closeCalls,
    });
  } finally {
    launchStub.restore();
  }
}

async function expectRejects(fn: () => Promise<unknown>, message: string) {
  await assertRejects(fn, Error, message);
}

Deno.test("BrowserManager - isAlive returns false when context is not started", () => {
  const manager = new BrowserManager();
  assertEquals(manager.isAlive(), false);
});

Deno.test("BrowserManager - rejects page operations before bootstrap", async () => {
  const manager = new BrowserManager();
  await expectRejects(
    () => manager.action({ type: "click", selector: "#btn" }),
    "No active page",
  );
  await expectRejects(
    () => manager.goto({ url: "https://example.com" }),
    "No active page",
  );
  await expectRejects(() => manager.html(), "No active page");
  await expectRejects(() => manager.screenshot(), "No active page");
  await expectRejects(() => manager.pdf(), "No active page");
  await expectRejects(
    () => manager.extract({ selector: "div" }),
    "No active page",
  );
  await expectRejects(() => manager.newTab(), "Browser not started");
  await expectRejects(() => manager.closeTab(0), "Browser not started");
  await expectRejects(() => manager.switchTab(0), "Browser not started");
});

Deno.test("BrowserManager - bootstrap launches context and returns the initial page state", async () => {
  const page = createPage({ title: "New Tab" });

  await withBrowserHarness({ pages: [page] }, async ({ manager }) => {
    const result = await manager.bootstrap({});
    assertEquals(result, { ok: true, url: "about:blank", title: "New Tab" });
    assertEquals(manager.isAlive(), true);
  });
});

Deno.test("BrowserManager - bootstrap navigates when url is provided", async () => {
  const page = createPage({ title: "Example" });

  await withBrowserHarness({ pages: [page] }, async ({ manager }) => {
    const result = await manager.bootstrap({ url: "https://example.com" });
    assertEquals(result.url, "https://example.com");
    assertEquals(result.title, "Example");
  });
});

Deno.test("BrowserManager - bootstrap creates a page when none exists", async () => {
  await withBrowserHarness({ pages: [] }, async ({ manager, pages }) => {
    const result = await manager.bootstrap({});
    assertEquals(result.ok, true);
    assertEquals(pages.length, 1);
    assertEquals(pages[0].url(), "about:blank");
  });
});

Deno.test("BrowserManager - bootstrap closes an existing context before re-bootstrap", async () => {
  const page = createPage();

  await withBrowserHarness(
    { pages: [page] },
    async ({ manager, closeCalls }) => {
      await manager.bootstrap({});
      await manager.bootstrap({});
      assertEquals(closeCalls(), 1);
    },
  );
});

Deno.test("BrowserManager - goto returns url, title and status", async () => {
  const page = createPage({
    title: "Page Title",
    gotoResponse: { status: () => 200 },
  });

  await withBrowserHarness({ pages: [page] }, async ({ manager }) => {
    await manager.bootstrap({});
    const result = await manager.goto({ url: "https://example.com/page" });
    assertEquals(result, {
      url: "https://example.com/page",
      title: "Page Title",
      status: 200,
    });
  });
});

Deno.test("BrowserManager - goto returns null status when navigation does not produce a response", async () => {
  const page = createPage({ gotoResponse: null });

  await withBrowserHarness({ pages: [page] }, async ({ manager }) => {
    await manager.bootstrap({});
    const result = await manager.goto({ url: "https://example.com" });
    assertEquals(result.status, null);
  });
});

Deno.test("BrowserManager - action dispatches the requested browser operations", async () => {
  await withBrowserHarness({ pages: [createPage()] }, async ({ manager }) => {
    await manager.bootstrap({});

    const click = await manager.action({ type: "click", selector: "#btn" });
    const type = await manager.action({
      type: "type",
      selector: "#input",
      text: "hello",
    });
    const select = await manager.action({
      type: "select",
      selector: "#dropdown",
      value: "opt1",
    });
    const hover = await manager.action({ type: "hover", selector: "#link" });
    const press = await manager.action({
      type: "press",
      key: "c",
      modifiers: ["Control"],
    });
    const check = await manager.action({
      type: "check",
      selector: "#checkbox",
    });
    const uncheck = await manager.action({
      type: "uncheck",
      selector: "#checkbox",
    });
    const focus = await manager.action({ type: "focus", selector: "#input" });
    const clear = await manager.action({ type: "clear", selector: "#input" });
    const scroll = await manager.action({ type: "scroll", direction: "down" });

    assertEquals(click.message, "Clicked #btn");
    assertEquals(type.message, "Typed into #input");
    assertEquals(select.message, 'Selected "opt1" in #dropdown');
    assertEquals(hover.message, "Hovered over #link");
    assertEquals(press.message, "Pressed Control+c");
    assertEquals(check.message, "Checked #checkbox");
    assertEquals(uncheck.message, "Unchecked #checkbox");
    assertEquals(focus.message, "Focused #input");
    assertEquals(clear.message, "Cleared #input");
    assertEquals(scroll.message, "Scrolled down by 500px");
  });
});

Deno.test("BrowserManager - action rejects unknown action types", async () => {
  await withBrowserHarness({ pages: [createPage()] }, async ({ manager }) => {
    await manager.bootstrap({});
    await expectRejects(
      () => manager.action({ type: "unknown-action" } as never),
      "Unknown action type: unknown-action",
    );
  });
});

Deno.test("BrowserManager - extract returns selector data and evaluate results", async () => {
  const element = createElement();
  const page = createPage({
    elements: [element],
    evaluateResult: { count: 42 },
  });

  await withBrowserHarness({ pages: [page] }, async ({ manager }) => {
    await manager.bootstrap({});

    const bySelector = await manager.extract({ selector: ".item" });
    const byEvaluate = await manager.extract({
      evaluate: 'document.querySelectorAll("a").length',
    });

    assertEquals(bySelector.data, [
      {
        tag: "div",
        text: "Hello World",
        attributes: { class: "item", id: "el1" },
      },
    ]);
    assertEquals(byEvaluate.data, { count: 42 });
  });
});

Deno.test("BrowserManager - html screenshot pdf and tabs return the expected data", async () => {
  const pageOne = createPage({
    title: "Page A",
    content: "<html><body><h1>Hello</h1></body></html>",
  });
  const pageTwo = createPage({
    url: "https://b.com",
    title: "Page B",
  });
  const screenshotBuffer = Buffer.from("fake-png-data");
  const pdfBuffer = Buffer.from("fake-pdf-data");
  pageOne.screenshot = async () => screenshotBuffer;
  pageOne.pdf = async () => pdfBuffer;

  await withBrowserHarness(
    { pages: [pageOne, pageTwo] },
    async ({ manager, pages }) => {
      await manager.bootstrap({});
      const html = await manager.html();
      const screenshot = await manager.screenshot();
      const pdf = await manager.pdf();
      const tabs = await manager.tabs();

      assertEquals(html, {
        html: "<html><body><h1>Hello</h1></body></html>",
        url: "about:blank",
      });
      assertEquals(screenshot, screenshotBuffer);
      assertEquals(pdf, pdfBuffer);
      assertEquals(tabs, [
        { index: 0, url: "about:blank", title: "Page A", active: true },
        { index: 1, url: "https://b.com", title: "Page B", active: false },
      ]);
      assertEquals(pages.length, 2);
    },
  );
});

Deno.test("BrowserManager - newTab closeTab switchTab and close behave as expected", async () => {
  const pageOne = createPage({ title: "Page A" });
  const pageTwo = createPage({ url: "https://b.com", title: "Page B" });

  await withBrowserHarness(
    { pages: [pageOne, pageTwo] },
    async ({ manager, pages }) => {
      await manager.bootstrap({});

      const newTab = await manager.newTab();
      assertEquals(newTab.index, 2);
      assertEquals(newTab.url, "about:blank");

      const switched = await manager.switchTab(1);
      assertEquals(switched, { url: "https://b.com", title: "Page B" });

      const closed = await manager.closeTab(0);
      assertEquals(closed, { ok: true });
      assertEquals(pages.length, 2);

      await manager.close();
      assertEquals(manager.isAlive(), false);
    },
  );
});

Deno.test("BrowserManager - close ignores context close failures", async () => {
  await withBrowserHarness(
    {
      pages: [createPage()],
      closeImpl: async () => {
        throw new Error("Browser crashed");
      },
    },
    async ({ manager }) => {
      await manager.bootstrap({});
      await manager.close();
      assertEquals(manager.isAlive(), false);
    },
  );
});
