import { describe, expect, test } from "bun:test";
import { submitWelcomeDraft } from "../../../../views/app/space/welcome-submission.ts";

describe("welcome submission", () => {
  test("keeps an unsuccessful draft unsubmitted", async () => {
    const calls: string[] = [];
    const submitted = await submitWelcomeDraft({
      message: "  keep this draft  ",
      files: [],
      createThread: async (message) => {
        calls.push(message);
        return false;
      },
    });

    expect(submitted).toBe(false);
    expect(calls).toEqual(["keep this draft"]);
  });

  test("reports success only after thread creation completes", async () => {
    let resolveCreation: ((created: boolean) => void) | undefined;
    const creation = new Promise<boolean>((resolve) => {
      resolveCreation = resolve;
    });
    let settled = false;
    const submission = submitWelcomeDraft({
      message: "hello",
      files: [],
      createThread: () => creation,
    }).then((created) => {
      settled = true;
      return created;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    resolveCreation?.(true);
    expect(await submission).toBe(true);
  });

  test("passes attachments without inventing an empty array", async () => {
    const attachment = new File(["content"], "notes.txt", {
      type: "text/plain",
    });
    let receivedFiles: File[] | undefined;

    expect(
      await submitWelcomeDraft({
        message: "",
        files: [attachment],
        createThread: async (_message, files) => {
          receivedFiles = files;
          return true;
        },
      }),
    ).toBe(true);
    expect(receivedFiles).toEqual([attachment]);
  });
});
