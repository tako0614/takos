import { createContext, createSignal, type JSX, onMount, useContext } from 'solid-js';
import { type CloudUrls, resolveCloudUrls } from './cloud-url';

const CloudContext = createContext<() => CloudUrls>(() => resolveCloudUrls(''));

/**
 * Resolves Takosumi cloud URLs once (SSR renders the production fallback, then
 * onMount re-resolves against the real hostname so local-substrate `.test`
 * hosts get rewritten links) and shares them through context, instead of every
 * CTA component re-resolving on its own.
 */
export function CloudProvider(props: { children: JSX.Element }): JSX.Element {
  const [urls, setUrls] = createSignal<CloudUrls>(resolveCloudUrls(''));
  onMount(() => setUrls(resolveCloudUrls()));
  return <CloudContext.Provider value={urls}>{props.children}</CloudContext.Provider>;
}

export function useCloudUrls(): () => CloudUrls {
  return useContext(CloudContext);
}
