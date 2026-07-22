import DOMPurify from 'dompurify';

export const TAKOS_MONACO_DOMPURIFY_VERSION = '3.4.12';
export const TAKOS_MONACO_DOMPURIFY_PROOF = 'takos.monaco-dompurify@3.4.12';

if (DOMPurify.version !== TAKOS_MONACO_DOMPURIFY_VERSION) {
  throw new Error(
    `${TAKOS_MONACO_DOMPURIFY_PROOF}: expected DOMPurify ${TAKOS_MONACO_DOMPURIFY_VERSION}`,
  );
}

export default DOMPurify;
