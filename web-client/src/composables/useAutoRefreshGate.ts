import { computed, ref, toValue, type MaybeRefOrGetter } from "vue";

const EDIT_IDLE_DELAY_MS = 1500;

const isEditingInput = ref(false);

let listenersAttached = false;
let idleTimer: number | null = null;
let composing = false;

export function useAutoRefreshGate(enabled: MaybeRefOrGetter<boolean> = true) {
  ensureAutoRefreshGate();

  return {
    isEditingInput,
    canAutoRefresh: computed(() => Boolean(toValue(enabled)) && !isEditingInput.value),
  };
}

export function ensureAutoRefreshGate() {
  if (listenersAttached || typeof document === "undefined") return;

  document.addEventListener("focusin", handleFocusIn, true);
  document.addEventListener("focusout", handleFocusOut, true);
  document.addEventListener("input", handleInput, true);
  document.addEventListener("compositionstart", handleCompositionStart, true);
  document.addEventListener("compositionend", handleCompositionEnd, true);
  document.addEventListener("visibilitychange", syncEditingState, true);
  listenersAttached = true;
  syncEditingState();
}

export function canAutoRefreshNow() {
  ensureAutoRefreshGate();
  return !isEditingInput.value;
}

export function isAutoRefreshEditing() {
  ensureAutoRefreshGate();
  return isEditingInput.value;
}

export function resetAutoRefreshGateForTest() {
  clearIdleTimer();
  composing = false;
  isEditingInput.value = false;

  if (!listenersAttached || typeof document === "undefined") return;

  document.removeEventListener("focusin", handleFocusIn, true);
  document.removeEventListener("focusout", handleFocusOut, true);
  document.removeEventListener("input", handleInput, true);
  document.removeEventListener("compositionstart", handleCompositionStart, true);
  document.removeEventListener("compositionend", handleCompositionEnd, true);
  document.removeEventListener("visibilitychange", syncEditingState, true);
  listenersAttached = false;
}

function handleFocusIn(event: Event) {
  if (!isEditableTarget(event.target)) return;
  setEditing();
}

function handleFocusOut() {
  scheduleIdleCheck();
}

function handleInput(event: Event) {
  if (!isEditableTarget(event.target)) return;
  setEditing();
  scheduleIdleCheck();
}

function handleCompositionStart(event: Event) {
  if (!isEditableTarget(event.target)) return;
  composing = true;
  setEditing();
}

function handleCompositionEnd() {
  composing = false;
  scheduleIdleCheck();
}

function setEditing() {
  clearIdleTimer();
  isEditingInput.value = true;
}

function scheduleIdleCheck() {
  clearIdleTimer();
  idleTimer = window.setTimeout(() => {
    idleTimer = null;
    syncEditingState();
  }, EDIT_IDLE_DELAY_MS);
}

function syncEditingState() {
  if (composing) {
    isEditingInput.value = true;
    return;
  }

  isEditingInput.value = hasEditableFocus();
}

function hasEditableFocus() {
  if (typeof document === "undefined") return false;
  return isEditableTarget(document.activeElement);
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  const editable = target.closest("input, textarea, select, [contenteditable]");
  if (!(editable instanceof HTMLElement)) return false;

  if (editable instanceof HTMLInputElement) {
    const type = editable.type.toLowerCase();
    return type !== "hidden" && !editable.disabled && !editable.readOnly;
  }

  if (editable instanceof HTMLTextAreaElement) {
    return !editable.disabled && !editable.readOnly;
  }

  if (editable instanceof HTMLSelectElement) {
    return !editable.disabled;
  }

  const contentEditable = editable.getAttribute("contenteditable");
  return contentEditable !== null && contentEditable.toLowerCase() !== "false";
}

function clearIdleTimer() {
  if (idleTimer == null) return;
  window.clearTimeout(idleTimer);
  idleTimer = null;
}
