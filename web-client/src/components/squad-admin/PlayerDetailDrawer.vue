<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open && props.player" class="drawer-root" @click.self="close">
        <aside class="player-detail-drawer">
          <header class="drawer-header">
            <div class="drawer-header-content">
              <h2 class="drawer-player-name">{{ props.player.name }}</h2>
              <div class="drawer-header-badges">
                <StatusBadge :tone="props.player.isOnline ? 'ok' : 'idle'">
                  {{ props.player.isOnline ? t("common.online") : t("common.offline") }}
                </StatusBadge>
                <StatusBadge v-if="props.player.isLeader" tone="ok">{{ t("match.squadLeader") }}</StatusBadge>
              </div>
            </div>
            <button type="button" class="drawer-close-button" @click="close" :title="`${t('common.close')} (Esc)`">
              x
            </button>
          </header>

          <div class="drawer-body">
            <section class="detail-section">
              <div class="detail-section-title">{{ t("player.player") }}</div>
              <div class="player-summary">
                <div class="summary-row">
                  <span class="summary-label">{{ t("player.role") }}</span>
                  <span class="summary-value">{{ displayRole(props.player.role) }}</span>
                </div>
                <div class="summary-row">
                  <span class="summary-label">{{ t("player.team") }}</span>
                  <span class="summary-value team-badge" :class="teamColorClass">
                    {{ t("player.team") }} {{ props.player.teamId ?? "?" }}
                  </span>
                </div>
                <div class="summary-row">
                  <span class="summary-label">{{ t("player.squad") }}</span>
                  <span class="summary-value">{{ t("player.squad") }} {{ props.player.squadId ?? t("match.unassigned") }}</span>
                </div>
                <div v-if="props.player.playtimeHours" class="summary-row">
                  <span class="summary-label">{{ t("player.steamTime") }}</span>
                  <span class="summary-value">{{ props.player.playtimeHours }}h</span>
                </div>
              </div>
            </section>

            <section class="detail-section">
              <div class="detail-section-title">{{ t("player.identity") }}</div>
              <CopyableValue :label="t('player.steamId')" :value="props.player.steamId" :truncate="32" />
              <CopyableValue :label="t('player.eosId')" :value="props.player.eosId" :truncate="32" />
              <div class="identity-ip-block">
                <CopyableValue :label="t('player.ip')" :value="displayIp" :empty-text="ipEmptyText" />
                <small class="identity-ip-hint">{{ resolveIpError || ipSourceHint }}</small>
              </div>
            </section>

            <section class="detail-section">
              <div class="detail-section-title">{{ t("player.currentMatch") }}</div>
              <div class="detail-rows">
                <div class="detail-row">
                  <span class="detail-label">{{ t("player.playerId") }}</span>
                  <span class="detail-value">{{ props.player.playerId ?? "-" }}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">{{ t("player.teamId") }}</span>
                  <span class="detail-value">{{ props.player.teamId ?? "-" }}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">{{ t("player.squadId") }}</span>
                  <span class="detail-value">{{ props.player.squadId ?? "-" }}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">{{ t("player.leader") }}</span>
                  <span class="detail-value">{{ props.player.isLeader ? t("common.yes") : t("common.no") }}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">{{ t("common.status") }}</span>
                  <span class="detail-value">{{ props.player.isOnline ? t("common.online") : t("common.offline") }}</span>
                </div>
              </div>
            </section>

            <section class="detail-section">
              <div class="detail-section-title">{{ t("common.actions") }}</div>
              <button type="button" class="action-button primary" @click="openDatabase">
                {{ t("player.openDatabase") }}
              </button>
              <button
                type="button"
                class="action-button secondary"
                @click="copyValue(props.player.steamId, t('player.steamId'))"
                :disabled="!props.player.steamId"
              >
                {{ t("player.copySteamId") }}
              </button>
              <button
                type="button"
                class="action-button secondary"
                @click="copyValue(props.player.eosId, t('player.eosId'))"
                :disabled="!props.player.eosId"
              >
                {{ t("player.copyEosId") }}
              </button>
              <button
                type="button"
                class="action-button secondary"
                @click="copyValue(displayIp, t('player.ip'))"
                :disabled="!displayIp"
              >
                {{ t("player.copyIp") }}
              </button>
            </section>

            <section class="detail-section advanced-section">
              <button type="button" class="detail-section-title advanced-toggle" @click="showAdvanced = !showAdvanced">
                {{ showAdvanced ? "▼" : "▶" }} {{ t("player.advanced") }}
              </button>
              <div v-if="showAdvanced" class="advanced-content">
                <div class="detail-rows">
                  <div class="detail-row">
                    <span class="detail-label">{{ t("common.source") }}</span>
                    <span class="detail-value">{{ props.player.source || t("common.unknown") }}</span>
                  </div>
                  <div v-if="props.player.controller" class="detail-row">
                    <span class="detail-label">{{ t("player.controller") }}</span>
                    <span class="detail-value ellipsis">{{ props.player.controller }}</span>
                  </div>
                </div>
                <pre v-if="props.player.raw" class="raw-data"><code>{{ JSON.stringify(props.player.raw, null, 2) }}</code></pre>
              </div>
            </section>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRouter } from "vue-router";
import type { PlayerDetailViewModel } from "../../types/squad-admin.types";
import { useUiStore } from "../../stores/ui.store";
import { copyTextWithToast } from "../../utils/clipboard";
import { goToPlayerDatabaseSearch } from "../../utils/player-database";
import { resolvePlayerIdentityIp } from "../../app/playerIdentityApi";
import StatusBadge from "../common/StatusBadge.vue";
import CopyableValue from "./CopyableValue.vue";
import { t } from "../../i18n";

const props = withDefaults(
  defineProps<{
    player: PlayerDetailViewModel | null;
    open: boolean;
  }>(),
  {
    player: null,
  },
);

const emit = defineEmits<{
  (event: "close"): void;
}>();

const ui = useUiStore();
const router = useRouter();
const showAdvanced = ref(false);
const resolvedLastIp = ref("");
const resolvingIp = ref(false);
const resolveIpError = ref("");
const lookupToken = ref(0);

const currentIp = computed(() => String(props.player?.ip ?? "").trim());
const displayIp = computed(() => currentIp.value || resolvedLastIp.value.trim());
const ipEmptyText = computed(() => (resolvingIp.value ? t("common.resolving") : "--"));
const ipSourceHint = computed(() => {
  if (currentIp.value) return t("common.current");
  if (resolvingIp.value) return t("common.resolving");
  if (resolvedLastIp.value.trim()) return t("common.lastKnown");
  return t("common.none");
});

const teamColorClass = computed(() => {
  if (!props.player) return "neutral";
  if (props.player.teamId === 1) return "team1";
  if (props.player.teamId === 2) return "team2";
  return "neutral";
});

function close() {
  emit("close");
}

function handleEscape(e: KeyboardEvent) {
  if (e.key === "Escape" && props.open) {
    close();
  }
}

async function copyValue(value: string | null | undefined, label: string) {
  if (!value) return;
  await copyTextWithToast(value, ui, {
    label: `${label} ${t("common.copied")}`,
    successMessage: value,
  });
}

function openDatabase() {
  if (!props.player) return;
  const searchKey = props.player.name || props.player.steamId || props.player.eosId || "";
  if (searchKey) {
    goToPlayerDatabaseSearch(router, searchKey);
  }
}

function buildLookupKey() {
  return [
    String(props.player?.steamId ?? "").trim(),
    String(props.player?.eosId ?? "").trim(),
    String(props.player?.name ?? "").trim(),
  ].filter(Boolean).join("|");
}

watch(
  () => [props.open, props.player?.steamId, props.player?.eosId, props.player?.name, props.player?.ip],
  async () => {
    lookupToken.value += 1;

    if (!props.open || !props.player) {
      resolvingIp.value = false;
      resolveIpError.value = "";
      resolvedLastIp.value = "";
      return;
    }

    resolveIpError.value = "";

    if (currentIp.value) {
      resolvedLastIp.value = "";
      resolvingIp.value = false;
      return;
    }

    const lookupKey = buildLookupKey();
    if (!lookupKey) {
      resolvedLastIp.value = "";
      resolvingIp.value = false;
      return;
    }

    resolvedLastIp.value = "";
    resolvingIp.value = true;

    const token = lookupToken.value;
    try {
      const result = await resolvePlayerIdentityIp({
        steamId: props.player.steamId,
        eosId: props.player.eosId,
        name: props.player.name,
      });

      if (token !== lookupToken.value) return;

      resolvedLastIp.value = result.source === "last" ? result.ip : "";
      resolvingIp.value = false;
    } catch {
      if (token !== lookupToken.value) return;
      resolvedLastIp.value = "";
      resolvingIp.value = false;
      resolveIpError.value = t("common.error");
    }
  },
  { immediate: true },
);

function displayRole(role: string | null | undefined) {
  const raw = String(role ?? "").trim();
  if (!raw) return t("role.unknownRole");
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const keyMap: Record<string, string> = {
    squadleader: "role.squadLeader",
    medic: "role.medic",
    heavyantitank: "role.heavyAntiTank",
    lightantitank: "role.lightAntiTank",
    machinegunner: "role.machineGunner",
    automaticrifleman: "role.automaticRifleman",
    engineer: "role.engineer",
    sapper: "role.sapper",
    marksman: "role.marksman",
    sniper: "role.sniper",
    grenadier: "role.grenadier",
    crewman: "role.crewman",
    pilot: "role.pilot",
    rifleman: "role.rifleman",
  };
  const key = keyMap[normalized];
  return key ? t(key, raw) : raw;
}

onMounted(() => {
  document.addEventListener("keydown", handleEscape);
});

onUnmounted(() => {
  document.removeEventListener("keydown", handleEscape);
});
</script>

<style scoped>
.drawer-root {
  position: fixed;
  inset: 0;
  z-index: 40;
}

.player-detail-drawer {
  position: absolute;
  top: 0;
  right: 0;
  height: 100dvh;
  width: 420px;
  background: var(--color-bg-panel);
  border-left: 1px solid var(--color-border-default);
  display: grid;
  grid-template-rows: auto 1fr;
  box-shadow: var(--shadow-lg);
}

.drawer-enter-active,
.drawer-leave-active {
  transition: all 0.2s ease;
}

.drawer-enter-from {
  transform: translateX(100%);
}

.drawer-leave-to {
  transform: translateX(100%);
}

.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--spacing-md);
  padding: var(--spacing-lg);
  border-bottom: 1px solid var(--color-border-default);
  flex-shrink: 0;
}

.drawer-header-content {
  display: grid;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.drawer-player-name {
  margin: 0;
  font-size: var(--font-size-xl);
  font-weight: 700;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drawer-header-badges {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.drawer-close-button {
  background: transparent;
  border: 1px solid var(--color-border-soft);
  color: var(--color-text-muted);
  width: 32px;
  height: 32px;
  border-radius: 6px;
  cursor: pointer;
  flex-shrink: 0;
}

.drawer-close-button:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.drawer-body {
  padding: var(--spacing-lg);
  overflow-y: auto;
  display: grid;
  gap: var(--spacing-lg);
}

.detail-section {
  display: grid;
  gap: var(--spacing-sm);
}

.identity-ip-block {
  display: grid;
  gap: 4px;
}

.identity-ip-hint {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.detail-section-title {
  font-size: var(--font-size-sm);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-muted);
}

.player-summary,
.detail-rows,
.advanced-content {
  display: grid;
  gap: var(--spacing-sm);
}

.summary-row,
.detail-row {
  display: flex;
  justify-content: space-between;
  gap: var(--spacing-md);
}

.summary-label,
.detail-label {
  color: var(--color-text-secondary);
}

.summary-value,
.detail-value {
  color: var(--color-text-primary);
  text-align: right;
}

.team-badge.team1 {
  color: var(--color-team1-primary);
}

.team-badge.team2 {
  color: var(--color-team2-primary);
}

.action-button {
  width: 100%;
}

.advanced-toggle {
  background: transparent;
  border: 0;
  padding: 0;
  text-align: left;
  cursor: pointer;
}

.raw-data {
  margin: 0;
  padding: var(--spacing-md);
  border-radius: var(--radius-md);
  background: var(--color-bg-muted);
  overflow: auto;
}

@media (max-width: 640px) {
  .player-detail-drawer {
    width: 100vw;
  }
}
</style>
