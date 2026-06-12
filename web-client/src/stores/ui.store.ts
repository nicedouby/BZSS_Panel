import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";

export type UiTone = "ok" | "warn" | "error" | "idle";
export type UiTheme = "default" | "daylight" | "colorful" | "green";
export type UiVisualMode = "classic" | "tactical" | "glass";
export type UiDensity = "comfortable" | "compact";
export type UiAccent = "blueOrange" | "greenAmber" | "steelRed";
export type UiMotion = "normal" | "reduced";

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

export interface WarnPromptOptions {
  title: string;
  targetName: string;
  defaultMessage?: string;
  confirmText?: string;
}

interface WarnPromptState extends Required<WarnPromptOptions> {
  visible: boolean;
}

interface ConfirmState extends Required<Omit<ConfirmOptions, "tone">> {
  visible: boolean;
  tone: UiTone;
}

interface StoredUiPrefs {
  version?: number;
  theme?: UiTheme;
  visualMode?: UiVisualMode;
  globalDensity?: UiDensity;
  accent?: UiAccent;
  motion?: UiMotion;
  richBackground?: boolean;
  cardGlow?: boolean;
  showTeamPerspectiveHint?: boolean;
}

const UI_PREFS_STORAGE_KEY = "bzss.ui.preferences";
const themes: UiTheme[] = ["default", "daylight", "colorful", "green"];
const visualModes: UiVisualMode[] = ["classic", "tactical", "glass"];
const densities: UiDensity[] = ["comfortable", "compact"];
const accents: UiAccent[] = ["blueOrange", "greenAmber", "steelRed"];
const motions: UiMotion[] = ["normal", "reduced"];

let toastId = 0;

export const useUiStore = defineStore("ui", () => {
  const savedPrefs = readStoredUiPrefs();
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
  const warnPrompt = ref<WarnPromptState>({
    visible: false,
    title: "",
    targetName: "",
    defaultMessage: "",
    confirmText: "Send Warning",
  });
  const theme = ref<UiTheme>(savedPrefs.theme);
  const visualMode = ref<UiVisualMode>(savedPrefs.visualMode);
  const globalDensity = ref<UiDensity>(savedPrefs.globalDensity);
  const accent = ref<UiAccent>(savedPrefs.accent);
  const motion = ref<UiMotion>(savedPrefs.motion);
  const richBackground = ref(Boolean(savedPrefs.richBackground));
  const cardGlow = ref(Boolean(savedPrefs.cardGlow));
  const showTeamPerspectiveHint = ref(Boolean(savedPrefs.showTeamPerspectiveHint));

  const isSidebarExpanded = computed(() => !sidebarCollapsed.value);
  const uiClassList = computed(() => [
    `ui-theme-${theme.value}`,
    `ui-mode-${visualMode.value}`,
    `ui-density-${globalDensity.value}`,
    `ui-accent-${accent.value}`,
    `ui-motion-${motion.value}`,
    richBackground.value ? "ui-rich-background" : "ui-flat-background",
    cardGlow.value ? "ui-card-glow" : "ui-card-flat",
  ]);
  let confirmResolver: ((value: boolean) => void) | null = null;
  let warnPromptResolver: ((value: string | null) => void) | null = null;

  watch(
    theme,
    (next) => {
      if (typeof document === "undefined") return;
      document.documentElement.dataset.uiTheme = next;
    },
    { immediate: true },
  );

  watch(
    () => [
      theme.value,
      visualMode.value,
      globalDensity.value,
      accent.value,
      motion.value,
      richBackground.value,
      cardGlow.value,
      showTeamPerspectiveHint.value,
    ],
    () => {
      persistUiPrefs({
        version: 2,
        theme: theme.value,
        visualMode: visualMode.value,
        globalDensity: globalDensity.value,
        accent: accent.value,
        motion: motion.value,
        richBackground: richBackground.value,
        cardGlow: cardGlow.value,
        showTeamPerspectiveHint: showTeamPerspectiveHint.value,
      });
    },
    { immediate: true },
  );

  function toggleSidebarCollapsed() {
    sidebarCollapsed.value = !sidebarCollapsed.value;
  }

  function setSidebarCollapsed(next: boolean) {
    sidebarCollapsed.value = Boolean(next);
  }

  function setTheme(next: UiTheme) {
    theme.value = resolveUiValue(next, themes, "default");
  }

  function setVisualMode(next: UiVisualMode) {
    visualMode.value = resolveUiValue(next, visualModes, "tactical");
  }

  function setGlobalDensity(next: UiDensity) {
    globalDensity.value = resolveUiValue(next, densities, "comfortable");
  }

  function setAccent(next: UiAccent) {
    accent.value = resolveUiValue(next, accents, "blueOrange");
  }

  function setMotion(next: UiMotion) {
    motion.value = resolveUiValue(next, motions, "normal");
  }

  function setRichBackground(next: boolean) {
    richBackground.value = Boolean(next);
  }

  function setCardGlow(next: boolean) {
    cardGlow.value = Boolean(next);
  }

  function setShowTeamPerspectiveHint(next: boolean) {
    showTeamPerspectiveHint.value = Boolean(next);
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

  function openWarnPrompt(options: WarnPromptOptions) {
    warnPrompt.value = {
      visible: true,
      title: options.title,
      targetName: options.targetName,
      defaultMessage: options.defaultMessage ?? "请遵守服务器规则",
      confirmText: options.confirmText ?? "发送警告",
    };

    return new Promise<string | null>((resolve) => {
      warnPromptResolver = resolve;
    });
  }

  function resolveWarnPrompt(message: string | null) {
    warnPrompt.value.visible = false;
    warnPromptResolver?.(message);
    warnPromptResolver = null;
  }

  return {
    sidebarCollapsed,
    mobileSidebarOpen,
    isSidebarExpanded,
    toasts,
    confirm,
    warnPrompt,
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
    openWarnPrompt,
    resolveWarnPrompt,
    theme,
    visualMode,
    globalDensity,
    accent,
    motion,
    richBackground,
    cardGlow,
    showTeamPerspectiveHint,
    uiClassList,
    setTheme,
    setVisualMode,
    setGlobalDensity,
    setAccent,
    setMotion,
    setRichBackground,
    setCardGlow,
    setShowTeamPerspectiveHint,
  };
});

function readStoredUiPrefs(): Required<StoredUiPrefs> {
  const defaults = {
    version: 2,
    theme: "default" as UiTheme,
    visualMode: "tactical" as UiVisualMode,
    globalDensity: "compact" as UiDensity,
    accent: "blueOrange" as UiAccent,
    motion: "normal" as UiMotion,
    richBackground: true,
    cardGlow: true,
    showTeamPerspectiveHint: true,
  };

  if (typeof window === "undefined") {
    return defaults;
  }

  const raw = resolveStorage()?.getItem(UI_PREFS_STORAGE_KEY);
  if (!raw) return defaults;

  try {
    const parsed = JSON.parse(raw) as StoredUiPrefs;
    return {
      version: Number.isFinite(parsed.version) ? Number(parsed.version) : defaults.version,
      theme: resolveUiValue(parsed.theme, themes, defaults.theme),
      visualMode: resolveUiValue(parsed.visualMode, visualModes, defaults.visualMode),
      globalDensity: resolveUiValue(parsed.globalDensity, densities, defaults.globalDensity),
      accent: resolveUiValue(parsed.accent, accents, defaults.accent),
      motion: resolveUiValue(parsed.motion, motions, defaults.motion),
      richBackground: typeof parsed.richBackground === "boolean" ? parsed.richBackground : defaults.richBackground,
      cardGlow: typeof parsed.cardGlow === "boolean" ? parsed.cardGlow : defaults.cardGlow,
      showTeamPerspectiveHint: typeof parsed.showTeamPerspectiveHint === "boolean"
        ? parsed.showTeamPerspectiveHint
        : defaults.showTeamPerspectiveHint,
    };
  } catch {
    return defaults;
  }
}

function persistUiPrefs(prefs: Required<StoredUiPrefs>) {
  resolveStorage()?.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(prefs));
}

function resolveStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function resolveUiValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const text = String(value ?? "").trim();
  return (allowed as readonly string[]).includes(text) ? (text as T) : fallback;
}
