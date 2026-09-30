import { onCleanup, onMount } from "solid-js";

export default function AdringWidget() {
  let container!: HTMLDivElement;
  let dispose: (() => void) | undefined;

  onMount(() => {
    const script = document.createElement("script");
    script.src = "https://ar-cdn.net/widget/v1.js";
    script.async = true;
    script.referrerPolicy = "origin";
    script.dataset.siteId = "f7c5561c-ba0b-4520-a684-7debfdb5e6ea";
    script.dataset.variant = "card";
    container.append(script);
    dispose = () => {
      (script as HTMLScriptElement & { __adringCleanup?: () => void }).__adringCleanup?.();
      container.replaceChildren();
    };
  });
  onCleanup(() => dispose?.());

  return (
    <aside
      aria-label="広告"
      style={{
        "box-sizing": "border-box",
        width: "100%",
        "max-width": "488px",
        "min-height": "196px",
        margin: "0 auto",
        padding: "24px",
      }}
    >
      <div ref={container} />
    </aside>
  );
}
