import { onCleanup, onMount } from 'solid-js';

function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Reveal-on-scroll. Add `use:reveal` to an element; it starts at
 * `.reveal` (hidden) and gains `.is-visible` when it enters the viewport.
 * No-ops (and reveals immediately) when reduced motion is requested or
 * IntersectionObserver is unavailable.
 */
export function reveal(el: HTMLElement, accessor?: () => number | true): void {
  const raw = accessor?.();
  const delay = typeof raw === 'number' ? raw : 0;
  el.classList.add('reveal');
  if (delay) el.style.setProperty('--reveal-delay', `${delay}ms`);

  if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') {
    el.classList.add('is-visible');
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          el.classList.add('is-visible');
          io.disconnect();
        }
      }
    },
    { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
  );
  io.observe(el);
  onCleanup(() => io.disconnect());
}

/**
 * Subtle parallax: translates the element on scroll by `speed` × scrollY,
 * clamped while the hero is on screen. Disabled under reduced motion.
 */
export function useParallax(getEl: () => HTMLElement | undefined, speed = 0.12): void {
  onMount(() => {
    if (prefersReducedMotion()) return;
    let ticking = false;
    const update = () => {
      ticking = false;
      const el = getEl();
      if (!el) return;
      const y = globalThis.scrollY ?? 0;
      if (y > globalThis.innerHeight) return; // only while hero is in view
      el.style.transform = `translate3d(0, ${y * speed}px, 0)`;
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    };
    update();
    globalThis.addEventListener('scroll', onScroll, { passive: true });
    onCleanup(() => globalThis.removeEventListener('scroll', onScroll));
  });
}

/** Copy text to the clipboard, resolving to whether it succeeded. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'absolute';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// Register the `reveal` directive use with Solid's JSX typing.
declare module 'solid-js' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface Directives {
      reveal: number | true;
    }
  }
}
