import type { JSX } from 'solid-js';
import GeometricMark from './GeometricMark';
import InkdropMark from './InkdropMark';

interface Props {
  variant?: 'geometric' | 'inkdrop';
  size?: number;
  class?: string;
}

/** Wordmark = mark + "Takos" text. Mark inherits from the takosumi-ecosystem
 *  ink visual family; Takos uses the inkdrop variant to differentiate from
 *  Takosumi's geometric default. */
export default function Wordmark(props: Props): JSX.Element {
  const Mark = () =>
    props.variant === 'geometric' ? <GeometricMark size={props.size ?? 28} /> : <InkdropMark size={props.size ?? 28} />;
  return (
    <a href='/' class={`wordmark ${props.class ?? ''}`} aria-label='Takos home'>
      <Mark />
      <span class='wordmark-text'>Takos</span>
    </a>
  );
}
