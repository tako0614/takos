import { expect, test } from "bun:test";
import { createRoot } from "solid-js";
import { useCreateSpaceForm } from "../../hooks/useCreateSpaceForm.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("create Workspace form is single-flight", async () => {
  const pending = deferred();
  let calls = 0;
  let dispose: (() => void) | undefined;
  try {
    await new Promise<void>((done) => {
      createRoot((rootDispose) => {
        dispose = rootDispose;
        const form = useCreateSpaceForm({
          onCreate: async () => {
            calls += 1;
            await pending.promise;
          },
          nameRequiredMessage: "required",
          failedToCreateMessage: "failed",
        });
        form.setName("Work");
        const first = form.submit();
        const second = form.submit();
        expect(calls).toBe(1);
        expect(form.loading()).toBe(true);
        pending.resolve();
        void Promise.all([first, second]).then(() => {
          expect(form.loading()).toBe(false);
          done();
        });
      });
    });
  } finally {
    dispose?.();
  }
});

test("create Workspace retries reuse an operation only for the normalized draft", async () => {
  const operations: string[] = [];
  let attempts = 0;
  let dispose: (() => void) | undefined;
  try {
    await new Promise<void>((done) => {
      createRoot((rootDispose) => {
        dispose = rootDispose;
        const form = useCreateSpaceForm({
          onCreate: async (_name, _description, _featured, operationId) => {
            operations.push(operationId);
            attempts += 1;
            if (attempts < 3) throw new Error("retry");
          },
          nameRequiredMessage: "required",
          failedToCreateMessage: "failed",
        });
        form.setName("Work");
        void form.submit().then(async () => {
          form.setName("  Work  ");
          await form.submit();
          form.setDescription("changed");
          await form.submit();
          expect(operations[1]).toBe(operations[0]);
          expect(operations[2]).not.toBe(operations[1]);
          expect(operations.every((operation) => /^[a-f0-9]{32}$/.test(operation)))
            .toBe(true);
          done();
        });
      });
    });
  } finally {
    dispose?.();
  }
});
