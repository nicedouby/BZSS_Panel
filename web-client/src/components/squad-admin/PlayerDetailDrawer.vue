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
                  {{ props.player.isOnline ? "Online" : "Offline" }}
                </StatusBadge>
                <StatusBadge v-if="props.player.isLeader" tone="ok">SL</StatusBadge>
              </div>
            </div>
            <button type="button" class="drawer-close-button" @click="close" title="Close (Esc)">
              x
            </button>
          </header>

          <div class="drawer-body">
            <section class="detail-section">
              <div class="detail-section-title">Player</div>
              <div class="player-summary">
                <div class="summary-row">
                  <span class="summary-label">Role</span>
                  <span class="summary-value">{{ props.player.role }}</span>
                </div>
                <div class="summary-row">
                  <span class="summary-label">Team</span>
                  <span class="summary-value team-badge" :class="teamColorClass">
                    Team {{ props.player.teamId ?? "?" }}
                  </span>
                </div>
                <div class="summary-row">
                  <span class="summary-label">Squad</span>
                  <span class="summary-value">Squad {{ props.player.squadId ?? "Unassigned" }}</span>
                </div>
                <div v-if="props.player.playtimeHours" class="summary-row">
                  <span class="summary-label">Steam Time</span>
                  <span class="summary-value">{{ props.player.playtimeHours }}h</span>
                </div>
              </div>
            </section>

            <section class="detail-section">
              <div class="detail-section-title">Identity</div>
              <CopyableValue label="Steam ID" :value="props.player.steamId" :truncate="32" />
              <CopyableValue label="EOS ID" :value="props.player.eosId" :truncate="32" />
              <CopyableValue label="IP" :value="props.player.ip" />
            </section>

            <section class="detail-section">
              <div class="detail-section-title">Current Match</div>
              <div class="detail-rows">
                <div class="detail-row">
                  <span class="detail-label">Player ID</span>
                  <span class="detail-value">{{ props.player.playerId ?? "-" }}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Team ID</span>
                  <span class="detail-value">{{ props.player.teamId ?? "-" }}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Squad ID</span>
                  <span class="detail-value">{{ props.player.squadId ?? "-" }}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Leader</span>
                  <span class="detail-value">{{ props.player.isLeader ? "Yes" : "No" }}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">Status</span>
                  <span class="detail-value">{{ props.player.isOnline ? "Online" : "Offline" }}</span>
                </div>
              </div>
            </section>

            <section class="detail-section">
              <div class="detail-section-title">Actions</div>
              <button type="button" class="action-button primary" @click="openDatabase">
                Open Database
              </button>
              <button
                type="button"
                class="action-button secondary"
                @click="copyValue(props.player.steamId, 'Steam ID')"
                :disabled="!props.player.steamId"
              >
                Copy Steam ID
              </button>
              <button
                type="button"
                class="action-button secondary"
                @click="copyValue(props.player.eosId, 'EOS ID')"
                :disabled="!props.player.eosId"
              >
                Copy EOS ID
              </button>
              <button
                type="button"
                class="action-button secondary"
                @click="copyValue(props.player.ip, 'IP')"
                :disabled="!props.player.ip"
              >
                Copy IP
              </button>
            </section>

            <section class="detail-section advanced-section">
              <button type="button" class="detail-section-title advanced-toggle" @click="showAdvanced = !showAdvanced">
                {{ showAdvanced ? "▼" : "▶" }} Advanced
              </button>
              <div v-if="showAdvanced" class="advanced-content">
                <div class="detail-rows">
                  <div class="detail-row">
                    <span class="detail-label">Source</span>
                    <span class="detail-value">{{ props.player.source || "unknown" }}</span>
                  </div>
                  <div v-if="props.player.controller" class="detail-row">
                    <span class="detail-label">Controller</span>
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
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useRouter } from "vue-router";
import type { PlayerDetailViewModel } from "../../types/squad-admin.types";
import { useUiStore } from "../../stores/ui.store";
import { copyTextWithToast } from "../../utils/clipboard";
import { goToPlayerDatabaseSearch } from "../../utils/player-database";
import StatusBadge from "../common/StatusBadge.vue";
import CopyableValue from "./CopyableValue.vue";

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
    label: `${label} copied`,
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
