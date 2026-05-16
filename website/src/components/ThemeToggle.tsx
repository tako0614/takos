import { createSignal, onMount, Show } from "solid-js";

type Mode = "auto" | "light" | "dark";

function readMode(): Mode {
  if (typeof localStorage === "undefined") return "auto";
  const v = localStorage.getItem("tg-theme");
  return v === "light" || v === "dark" ? v : "auto";
}

function apply(mode: Mode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
}

export default function ThemeToggle() {
  const [mode, setMode] = createSignal<Mode>("auto");

  onMount(() => {
    const m = readMode();
    setMode(m);
    apply(m);
  });

  const cycle = () => {
    const next: Mode = mode() === "auto" ? "light" : mode() === "light" ? "dark" : "auto";
    setMode(next);
    apply(next);
    if (typeof localStorage !== "undefined") {
      if (next === "auto") localStorage.removeItem("tg-theme");
      else localStorage.setItem("tg-theme", next);
    }
  };

  return (
    <button
      class="nav-icon theme-toggle"
      type="button"
      onClick={cycle}
      title={`Theme: ${mode()}`}
      aria-label={`Theme: ${mode()}`}
      data-mode={mode()}
    >
      <Show when={mode() === "auto"}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
      </Show>
      <Show when={mode() === "light"}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </Show>
      <Show when={mode() === "dark"}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
      </Show>
    </button>
  );
}
