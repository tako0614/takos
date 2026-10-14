import { createResource, createSignal, onMount, Suspense } from "solid-js";

export const metrics = { fetches: 0 };

export default function Workspace() {
  const [clicks, setClicks] = createSignal(0);
  const [status, setStatus] = createSignal("pending");
  const [workspace] = createResource(async () => {
    metrics.fetches += 1;
    return {
      label: "Takos <workspace>",
      created: new Date("2026-10-14T12:00:00Z"),
      url: new URL("https://example.test/workspace"),
      counts: new Map([["messages", 3]]),
      ready: Promise.resolve("restored promise"),
    };
  });
  onMount(async () => setStatus(await workspace().ready));
  return (
    <section>
      <Suspense fallback={<p>Loading</p>}>
        <p id="workspace-label">{workspace()?.label}</p>
        <p id="workspace-date">{workspace()?.created.toISOString()}</p>
        <p id="workspace-host">{workspace()?.url.hostname}</p>
        <p id="workspace-count">{workspace()?.counts.get("messages")}</p>
      </Suspense>
      <button id="increment" onClick={() => setClicks((value) => value + 1)}>
        {clicks()}
      </button>
      <p id="promise-status">{status()}</p>
    </section>
  );
}
