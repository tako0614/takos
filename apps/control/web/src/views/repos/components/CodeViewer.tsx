import { For, Show } from "solid-js";

type BlameLine = {
  line: number;
  content: string;
  commit_sha: string;
  author_name: string;
  author_email: string;
  date: string;
  message: string;
};

export type BlameResponse = {
  path: string;
  ref: string;
  truncated: boolean;
  lines: BlameLine[];
};

interface CodeViewerProps {
  lines: string[];
  language: string;
  initialLine?: number;
  blameEnabled: boolean;
  blameError: string | null;
  blameData: BlameResponse | null;
}

export function CodeViewer(props: CodeViewerProps) {
  const blameByLine = () => {
    if (!props.blameData?.lines) return null;
    const map = new Map<number, BlameLine>();
    for (const ln of props.blameData.lines) {
      map.set(ln.line, ln);
    }
    return map;
  };

  return (
    <div class="flex text-sm font-mono">
      <Show when={props.blameEnabled}>
        <div class="flex flex-col py-3 px-3 bg-zinc-50 dark:bg-zinc-800 border-r border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 select-none w-64">
          <Show
            when={props.blameError}
            fallback={
              <For each={props.lines}>
                {(_, index) => {
                  const lineNo = () => index() + 1;
                  const blame = () => blameByLine()?.get(lineNo());
                  const shaShort = () =>
                    blame()?.commit_sha ? blame()!.commit_sha.slice(0, 7) : "";
                  const author = () => blame()?.author_name || "";
                  const title = () =>
                    blame()
                      ? `${blame()!.commit_sha}\n${blame()!.author_name} <${
                        blame()!.author_email
                      }>\n${blame()!.message}`
                      : "";
                  return (
                    <div
                      class="leading-6 flex items-center gap-2 min-w-0"
                      title={title()}
                    >
                      <span class="font-mono text-zinc-400 w-14 flex-shrink-0">
                        {shaShort()}
                      </span>
                      <span class="truncate text-zinc-500 dark:text-zinc-400">
                        {author()}
                      </span>
                    </div>
                  );
                }}
              </For>
            }
          >
            <div class="text-xs text-red-600 leading-5">
              {props.blameError}
            </div>
          </Show>
        </div>
      </Show>
      <div class="flex flex-col py-3 px-3 bg-zinc-50 dark:bg-zinc-800 border-r border-zinc-200 dark:border-zinc-700 text-right text-zinc-500 dark:text-zinc-400 select-none">
        <For each={props.lines}>
          {(_, index) => (
            <span
              class={`leading-6 ${
                props.initialLine === index() + 1
                  ? "text-zinc-900 dark:text-zinc-100 font-semibold"
                  : ""
              }`}
            >
              {index() + 1}
            </span>
          )}
        </For>
      </div>
      <pre
        class={`flex-1 py-3 px-4 overflow-x-auto language-${props.language}`}
      >
        <code class="text-zinc-900 dark:text-zinc-100">
          <For each={props.lines}>{(line, index) => (
            <div
              id={`line-${index() + 1}`}
              class={`leading-6 ${props.initialLine === index() + 1 ? 'bg-yellow-50 dark:bg-yellow-900/20' : ''}`}
            >
              {line || ' '}
            </div>
          )}</For>
        </code>
      </pre>
    </div>
  );
}
