import type { JSX } from "solid-js";

interface ConsentLayoutProps {
  children: JSX.Element;
}

export function ConsentLayout(props: ConsentLayoutProps) {
  return (
    <div class="flex items-center justify-center min-h-screen bg-[var(--color-bg-primary)] p-4">
      <div class="w-full max-w-sm bg-[var(--color-surface-primary)] border border-[var(--color-border-primary)] rounded-2xl p-8 text-center">
        {props.children}
      </div>
    </div>
  );
}

function isSafeImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

export function ConsentLogo(props: { src?: string | null }) {
  if (props.src && isSafeImageUrl(props.src)) {
    return (
      <img
        src={props.src}
        alt=""
        class="w-12 h-12 rounded-xl mx-auto mb-4"
      />
    );
  }
  return (
    <div class="flex justify-center mb-4">
      <img src="/logo.png" alt="Takos" class="w-12 h-12 rounded-xl" />
    </div>
  );
}
