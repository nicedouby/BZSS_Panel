import { computed, ref } from "vue";
import { defineStore } from "pinia";

export type UiTone = "ok" | "warn" | "error" | "idle";

export interface ToastInput {
  title?: string;
  message: string;
  tone?: UiTone;
  durationMs?: number;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: UiTone;
}

interface ToastItem extends Required<Pick<ToastInput, "message">> {
  id: number;
  title: string;
  tone: UiTone;
  durationMs: number;
}

interface ConfirmState extends Required<Omit<ConfirmOptions, "tone">> {
  visible: boolean;
  tone: UiTone;
}

let toastId = 0;

export const useUiStore = defineStore("ui", () => {
  const sidebarCollapsed = ref(false);
  const mobileSidebarOpen = ref(false);
  const toasts = ref<ToastItem[]>([]);
  const confirm = ref<ConfirmState>({
    visible: false,
    title: "",
    message: "",
    confirmText: "Confirm",
    cancelText: "Cancel",
    tone: "warn",
  });

  const isSidebarExpanded = computed(() => !sidebarCollapsed.value);
  let confirmResolver: ((value: boolean) => void) | null = null;

  function toggleSidebarCollapsed() {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  }

  function setSidebarCollapsed(next: boolean) {
    sidebarCollapsed.value = Boolean(next);
  }

  function openMobileSidebar() {
    mobileSidebarOpen.value = true;
  }

  function closeMobileSidebar() {
    mobileSidebarOpen.value = false;
  }

  function toggleMobileSidebar() {
    mobileSidebarOpen.value = !mobileSidebarOpen.value;
  }

  function pushToast(input: ToastInput) {
    const item: ToastItem = {
      id: ++toastId,
      title: input.title?.trim() ?? "",
      message: input.message,
      tone: input.tone ?? "idle",
      durationMs: Math.max(1200, Number(input.durationMs ?? 2600)),
    };

    toasts.value = [...toasts.value, item];
    window.setTimeout(() => {
      dismissToast(item.id);
    }, item.durationMs);
    return item.id;
  }

  function dismissToast(id: number) {
    toasts.value = toasts.value.filter((item) => item.id !== id);
  }

  function clearToasts() {
    toasts.value = [];
  }

  function openConfirm(options: ConfirmOptions) {
    confirm.value = {
      visible: true,
      title: options.title,
      message: options.message,
      confirmText: options.confirmText?.trim() || "Confirm",
      cancelText: options.cancelText?.trim() || "Cancel",
      tone: options.tone ?? "warn",
    };

    return new Promise<boolean>((resolve) => {
      confirmResolver = resolve;
    });
  }

  function resolveConfirm(result: boolean) {
    confirm.value.visible = false;
    confirmResolver?.(result);
    confirmResolver = null;
  }

  function confirmAccept() {
    resolveConfirm(true);
  }

  function confirmCancel() {
    resolveConfirm(false);
  }

  return {
    sidebarCollapsed,
    mobileSidebarOpen,
    isSidebarExpanded,
    toasts,
    confirm,
    toggleSidebarCollapsed,
    setSidebarCollapsed,
    openMobileSidebar,
    closeMobileSidebar,
    toggleMobileSidebar,
    pushToast,
    dismissToast,
    clearToasts,
    openConfirm,
    confirmAccept,
    confirmCancel,
  };
});
