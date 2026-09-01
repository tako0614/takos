import { beforeEach, expect, test } from "bun:test";
import {
  useConfirmDialog,
  useConfirmDialogActions,
  useConfirmDialogState,
} from "../../store/confirm-dialog.ts";

beforeEach(() => {
  useConfirmDialogActions().handleCancel();
});

test("confirmation is global single-flight and never strands the first caller", async () => {
  const { confirm } = useConfirmDialog();
  const state = useConfirmDialogState();
  const actions = useConfirmDialogActions();

  const first = confirm({ title: "Delete A", message: "Delete A?" });
  const second = confirm({ title: "Delete B", message: "Delete B?" });

  expect(state().title).toBe("Delete A");
  expect(await second).toBe(false);

  actions.handleConfirm();
  expect(await first).toBe(true);
  expect(state().isOpen).toBe(false);
  expect(state().resolve).toBeNull();
});

test("cancelling settles the active confirmation and permits the next one", async () => {
  const { confirm } = useConfirmDialog();
  const state = useConfirmDialogState();
  const actions = useConfirmDialogActions();

  const first = confirm({ title: "Delete A", message: "Delete A?" });
  actions.handleCancel();
  expect(await first).toBe(false);

  const second = confirm({ title: "Delete B", message: "Delete B?" });
  expect(state().title).toBe("Delete B");
  actions.handleConfirm();
  expect(await second).toBe(true);
});
