import { type Accessor, createMemo, onCleanup } from "solid-js";
import type { Thread } from "../../types/index.ts";
import { createLatestRequest } from "../../lib/createLatestRequest.ts";
import { type JsonResponseLike, rpcJson } from "../../lib/rpc.ts";
import type { WelcomeSubmissionResult } from "../../hooks/useWelcomeSubmission.ts";

interface CreatedThreadSelection {
  spaceId: string;
  thread: Thread;
  message: string;
  files: File[] | undefined;
  model: string;
}

interface SearchThreadSelection {
  thread: Thread;
  messageId: string;
  sequence: number;
}

interface ChatPageActionsOptions {
  spaceId: Accessor<string | null>;
  threadId: Accessor<string | undefined>;
  selectedModel: Accessor<string>;
  loadThread: (id: string) => Promise<JsonResponseLike>;
  createThread: (spaceId: string, message: string) => Promise<JsonResponseLike>;
  onCreated: (selection: CreatedThreadSelection) => void;
  onSearchSelected: (selection: SearchThreadSelection) => void;
  onError: (error: unknown, fallback: "failedToLoad" | "failedToCreate") => void;
}

/** Async navigation actions shared by the chat page's welcome and search UI. */
export function createChatPageActions(options: ChatPageActionsOptions) {
  const context = createMemo(() => ({
    spaceId: options.spaceId(),
    threadId: options.threadId(),
  }));
  const requests = createLatestRequest();
  let mounted = true;
  onCleanup(() => { mounted = false; });
  const claimNavigation = () => {
    // Keep the memo's identity, so leaving and returning to the same route
    // still retires its previous action. The server operation is not replayed
    // or undone; only its abandoned page's UI settlement is discarded.
    const requestedContext = context();
    return requests.claim(() => mounted && context() === requestedContext);
  };

  const openSearchResult = async (
    threadId: string,
    messageId: string,
    sequence: number,
  ) => {
    const claim = claimNavigation();
    try {
      const response = await options.loadThread(threadId);
      const { thread } = await rpcJson<{ thread: Thread }>(response, {
        isCurrent: claim.won,
      });
      if (!claim.won()) return;
      options.onSearchSelected({ thread, messageId, sequence });
    } catch (error) {
      if (!claim.won()) return;
      options.onError(error, "failedToLoad");
    }
  };

  const handleCreateThread = async (message: string, files?: File[]): Promise<WelcomeSubmissionResult> => {
    const spaceId = options.spaceId();
    if (!spaceId) return false;
    const model = options.selectedModel();
    const requestedThreadId = options.threadId();
    const claim = claimNavigation();
    let rejected = false;
    try {
      const response = await options.createThread(spaceId, message);
      // Only these product validation/access rejections precede thread create.
      // Other statuses (including a timeout) do not prove that no write ran.
      rejected = !response.ok && [400, 401, 403, 404].includes(response.status);
      const { thread } = await rpcJson<{ thread: Thread }>(response, {
        isCurrent: claim.won,
      });
      if (!thread || typeof thread.id !== "string" || !thread.id.trim()) {
        throw new Error("Chat creation could not be confirmed");
      }
      if (!claim.won()) {
        let resumed = false;
        return {
          kind: "created",
          resume: (draft, attachments) => {
            if (resumed || !mounted || options.spaceId() !== spaceId || options.threadId() !== requestedThreadId) return false;
            resumed = true;
            requests.next();
            options.onCreated({ spaceId, thread, message: draft, files: attachments, model: options.selectedModel() });
            return true;
          },
        };
      }
      options.onCreated({
        spaceId,
        thread,
        message,
        files,
        model,
      });
      return true;
    } catch (error) {
      if (claim.won()) options.onError(error, "failedToCreate");
      return rejected ? false : { kind: "unconfirmed" };
    }
  };

  return { openSearchResult, handleCreateThread };
}
