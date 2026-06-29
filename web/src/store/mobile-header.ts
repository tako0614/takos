import { createSignal } from "solid-js";
import type { Accessor, JSX, Setter } from "solid-js";

const [headerContent, setHeaderContent] = createSignal<JSX.Element | null>(
  null,
);

export function useMobileHeader(): {
  headerContent: Accessor<JSX.Element | null>;
  setHeaderContent: Setter<JSX.Element | null>;
} {
  return {
    headerContent,
    setHeaderContent,
  };
}
