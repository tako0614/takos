import type { JSX } from 'solid-js';

interface Props {
  /** Retained for API compatibility; the mark is now the takos.jp logo image. */
  variant?: 'geometric' | 'inkdrop';
  size?: number;
  class?: string;
}

/** Wordmark = takos.jp logo tile + "Takos" text. */
export default function Wordmark(props: Props): JSX.Element {
  const size = () => props.size ?? 28;
  return (
    <a href='/' class={`wordmark ${props.class ?? ''}`} aria-label='Takos home'>
      <img class='wordmark-mark' src='/logo.png' alt='' width={size()} height={size()} decoding='async' />
      <span class='wordmark-text'>Takos</span>
    </a>
  );
}
