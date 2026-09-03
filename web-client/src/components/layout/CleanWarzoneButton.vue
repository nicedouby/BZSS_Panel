<template>
  <Teleport defer to=".topbar-actions">
    <div v-if="canUse" class="clean-warzone-actions">
      <button type="button" class="clean-warzone-button" :data-enabled="warmupState ? 'true' : 'false'" :disabled="!warmupState || busy" title="Clean Warzone actions" @click="menuOpen = !menuOpen">
        <span class="clean-warzone-icon" aria-hidden="true">⌁</span>
        <span>{{ loopEnabled ? "Clean Loop On" : "Clean Warzone" }}</span>
        <span class="clean-warzone-chevron" aria-hidden="true">⌄</span>
      </button>
      <div v-if="menuOpen" class="clean-warzone-menu">
        <button type="button" @click="menuOpen = false; cleanWarzone()">立即清理</button>
        <button type="button" @click="toggleCleanWarzoneLoop(); menuOpen = false">{{ loopEnabled ? "关闭定时清理" : "开启定时清理" }}</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { executeBzssCoreCommand } from "../../app/bzssCoreApi";
import { t } from "../../i18n";
import { hasPermission } from "../../shared/rcon-permissions.js";
import { useAuthStore } from "../../stores/auth.store";
import { useServerStore } from "../../stores/server.store";
import { useUiStore } from "../../stores/ui.store";

const CLEAN_WARZONE_COMMAND = "CleanWarzone:1";
const CLEAN_WARZONE_INTERVAL_MS = 180_000;

const auth = useAuthStore();
const server = useServerStore();
const ui = useUiStore();
const busy = ref(false);
const menuOpen = ref(false);
const loopEnabled = ref(false);
let loopTimer: ReturnType<typeof setTimeout> | null = null;

const userPermissions = computed(() => auth.user?.permissions ?? []);
const canUse = computed(() => Boolean(
  auth.user?.isSuperAdmin || hasPermission(userPermissions.value, "bzss_core.use"),
));
const warmupState = computed(() => {
  const snapshot = server.snapshot ?? {};
  const webStatus = snapshot.webStatus ?? {};
  if (typeof webStatus.isWarmup === "boolean") return webStatus.isWarmup;
  if (typeof snapshot.isWarmup === "boolean") return snapshot.isWarmup;
  return false;
});

const immediateButtonTitle = computed(() => {
  if (busy.value) return "CleanWarzone:1 is running.";
  if (!warmupState.value) return "Available only while warmup mode is enabled.";
  return "Immediately execute CleanWarzone:1.";
});

const loopButtonTitle = computed(() => {
  if (!warmupState.value) return "Available only while warmup mode is enabled.";
  if (loopEnabled.value) return "Stop the 180-second CleanWarzone cleanup loop.";
  return "Start the 180-second CleanWarzone cleanup loop.";
});

async function executeCleanWarzone(showSuccessToast = true) {
  if (!warmupState.value || busy.value) return false;

  busy.value = true;
  try {
    const result = await executeBzssCoreCommand({
      command: CLEAN_WARZONE_COMMAND,
      raw: true,
    });
    const output = [result.stdout, result.stderr]
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .join(" / ");

    if (!result.ok) {
      throw new Error(result.message || output || "CleanWarzone:1 failed.");
    }

    if (showSuccessToast) {
      ui.pushToast({
        title: "Warzone cleaned",
        message: `${result.command || CLEAN_WARZONE_COMMAND} completed.${output ? ` ${output}` : ""}`,
        tone: "ok",
        durationMs: 4200,
      });
    }
    return true;
  } catch (error: any) {
    ui.pushToast({
      title: t("common.error"),
      message: error?.message || "CleanWarzone:1 failed.",
      tone: "error",
      durationMs: 7000,
    });
    return false;
  } finally {
    busy.value = false;
  }
}

async function cleanWarzone() {
  await executeCleanWarzone(true);
}

function stopCleanWarzoneLoop() {
  if (loopTimer) {
    clearTimeout(loopTimer);
    loopTimer = null;
  }
  loopEnabled.value = false;
}

function scheduleNextCleanWarzone() {
  if (!loopEnabled.value || !warmupState.value) return;

  loopTimer = setTimeout(async () => {
    loopTimer = null;
    await executeCleanWarzone(false);
    scheduleNextCleanWarzone();
  }, CLEAN_WARZONE_INTERVAL_MS);
}

async function startCleanWarzoneLoop() {
  if (!warmupState.value || loopEnabled.value) return;

  loopEnabled.value = true;
  await executeCleanWarzone(true);

  if (!loopEnabled.value || !warmupState.value) {
    stopCleanWarzoneLoop();
    return;
  }

  scheduleNextCleanWarzone();
}

function toggleCleanWarzoneLoop() {
  if (loopEnabled.value) {
    stopCleanWarzoneLoop();
    ui.pushToast({
      title: "Clean loop stopped",
      message: "The timed CleanWarzone cleanup loop has been stopped.",
      tone: "ok",
      durationMs: 3200,
    });
    return;
  }

  void startCleanWarzoneLoop();
}

watch(warmupState, (enabled) => {
  if (!enabled) stopCleanWarzoneLoop();
});

</script>

<style scoped>
.clean-warzone-actions {
  order: -1;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.clean-warzone-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 20;
  display: grid;
  min-width: 150px;
  padding: 5px;
  border: 1px solid rgba(251, 146, 60, 0.35);
  border-radius: 10px;
  background: var(--panel-surface, #17202a);
  box-shadow: var(--shadow-md);
}

.clean-warzone-menu button {
  padding: 8px 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-text, #fff);
  text-align: left;
  cursor: pointer;
}

.clean-warzone-menu button:hover {
  background: rgba(251, 146, 60, 0.16);
}

.clean-warzone-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 36px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(251, 146, 60, 0.5);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.018)), rgba(255, 255, 255, 0.006)),
    rgba(194, 65, 12, 0.2);
  color: #fed7aa;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease, color 0.15s ease, opacity 0.15s ease;
}

.clean-warzone-button:hover:not(:disabled) {
  border-color: rgba(251, 146, 60, 0.78);
  background: rgba(194, 65, 12, 0.32);
  color: #ffedd5;
}

.clean-warzone-button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
  border-color: rgba(122, 162, 184, 0.22);
  background: rgba(122, 162, 184, 0.08);
  color: var(--color-text-muted);
}

.clean-warzone-button[data-enabled="true"] .clean-warzone-icon,
.clean-warzone-button[data-enabled="true"] .clean-warzone-loop-icon {
  color: #fb923c;
  text-shadow: 0 0 8px rgba(251, 146, 60, 0.55);
}

.clean-warzone-loop-button[data-enabled="true"] {
  border-color: rgba(74, 222, 128, 0.56);
  background: rgba(22, 101, 52, 0.24);
  color: #bbf7d0;
}

.clean-warzone-loop-button[data-enabled="true"]:hover:not(:disabled) {
  border-color: rgba(74, 222, 128, 0.82);
  background: rgba(22, 101, 52, 0.34);
}

.clean-warzone-icon,
.clean-warzone-loop-icon {
  font-size: 15px;
  line-height: 1;
}

@media (max-width: 780px) {
  .clean-warzone-actions {
    gap: 4px;
  }

  .clean-warzone-button {
    min-height: 34px;
    padding: 0 10px;
    font-size: 11px;
  }

  .clean-warzone-button span:last-child {
    display: none;
  }
}
</style>
