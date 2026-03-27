/**
 * Legacy re-export kept so that existing imports continue to resolve.
 * The implementation now lives in store/confirm-dialog.ts (Jotai atoms).
 *
 * New code should import directly from '../store/confirm-dialog'.
 */
export { useConfirmDialog } from '../store/confirm-dialog';
export type { ConfirmDialogOptions } from '../store/confirm-dialog';
