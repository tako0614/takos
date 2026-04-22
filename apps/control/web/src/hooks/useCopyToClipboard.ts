import { createSignal, onCleanup } from "solid-js";

export function useCopyToClipboard(resetMs = 2000) {
  const [copied, setCopied] = createSignal(false);
  const [copyFailed, setCopyFailed] = createSignal(false);
  let timerRef: ReturnType<typeof setTimeout> | null = null;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setCopyFailed(false);
      if (timerRef) clearTimeout(timerRef);
      timerRef = setTimeout(() => {
        setCopied(false);
        timerRef = null;
      }, resetMs);
    } catch (err) {
      console.debug("Failed to copy to clipboard:", err);
      setCopyFailed(true);
      if (timerRef) clearTimeout(timerRef);
      timerRef = setTimeout(() => {
        setCopyFailed(false);
        timerRef = null;
      }, resetMs);
    }
  };

  onCleanup(() => {
    if (timerRef) clearTimeout(timerRef);
  });

  return { copied, copyFailed, copy };
}
