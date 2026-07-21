<template>
  <Teleport defer to=".topbar-actions">
    <button
      v-if="canUse"
      type="button"
      class="clean-warzone-button"
      :data-enabled="warmupState ? 'true' : 'false'"
      :disabled="!warmupState || busy"
      :title="buttonTitle"
      @click="cleanWarzone"
    >
      <span class="clean-warzone-icon" aria-hidden="true">⌁</span>
      <span>{{ busy ? "Cleaning..." : "Clean Warzone" }}</span>
    </button>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { executeBzssCoreCommand } from "../../app/bzssCoreApi";
import { t } from "../../i18n";
import { hasPermission } from "../../shared/rcon-permissions.js";
import { useAuthStore } from "../../stores/auth.store";
import { useServerStore } from "../../stores/server.store";
import { useUiStore } from "../../stores/ui.store";

const CLEAN_WARZONE_COMMAND = "CleanWarzone:1";

const auth = useAuthStore();
const server = useServerStore();
const ui = useUiStore();
const busy = ref(false);

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
const buttonTitle = computed(() => {
  if (busy.value) return "CleanWarzone:1 is running.";
  if (!warmupState.value) return "Available only while warmup mode is enabled.";
  return "Immediately execute CleanWarzone:1 through the BZSS-Core raw command channel.";
});

async function cleanWarzone() {
  if (!warmupState.value || busy.value) return;

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

    ui.pushToast({
      title: "Warzone cleaned",
      message: `${result.command || CLEAN_WARZONE_COMMAND} completed.${output ? ` ${output}` : ""}`,
      tone: "ok",
      durationMs: 4200,
    });
  } catch (error: any) {
    ui.pushToast({
      title: t("common.error"),
      message: error?.message || "CleanWarzone:1 failed.",
      tone: "error",
      durationMs: 7000,
    });
  } finally {
    busy.value = false;
  }
}
</script>

<style scoped>
.clean-warzone-button {
  order: -1;
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

.clean-warzone-button[data-enabled="true"] .clean-warzone-icon {
  color: #fb923c;
  text-shadow: 0 0 8px rgba(251, 146, 60, 0.55);
}

.clean-warzone-icon {
  font-size: 15px;
  line-height: 1;
}

@media (max-width: 780px) {
  .clean-warzone-button {
    min-height: 34px;
    padding: 0 10px;
    font-size: 11px;
  }
}
</style>
