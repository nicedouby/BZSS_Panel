<template>
  <div class="db-list">
    <div v-if="loading" class="list-placeholder">{{ t("database.loadingPlayerList") }}</div>
    <div v-else-if="error" class="list-placeholder error">{{ error }}</div>
    <div v-else-if="!rows.length" class="list-placeholder">{{ t("database.noMatchingPlayers") }}</div>
    <template v-else>
      <div
        v-for="player in rows"
        :key="player.id"
        class="player-item"
        :class="{ active: selectedId === player.id }"
        @click="$emit('select', player.id)"
      >
        <div class="item-main">
          <span class="player-name">{{ player.current_name || player.name || t("common.unknown") }}</span>
          <span class="player-group">{{ player.permission_group || "default" }}</span>
        </div>
        <div class="item-meta">
          <span>{{ formatTime(player.updated_at) }}</span>
          <span v-if="player.current_ip || player.ip" class="player-ip">{{ player.current_ip || player.ip }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { currentLocale, t } from "../../i18n";

defineProps<{
  rows: any[];
  selectedId: number | null;
  loading: boolean;
  error: string;
}>();

defineEmits<{
  (event: "select", id: number): void;
}>();

function formatTime(value: unknown) {
  const time = Number(value ?? 0);
  if (!time) return "--";
  return new Date(time).toLocaleString(currentLocale.value, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
</script>

<style scoped>
.db-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding: 8px;
}

.list-placeholder {
  padding: 32px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 14px;
}

.player-item {
  padding: 12px;
  background: var(--color-bg-panel);
  border: 1px solid var(--color-border-default);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: grid;
  gap: 4px;
}

.player-item:hover {
  border-color: var(--color-border-soft);
  background: var(--color-bg-hover);
}

.player-item.active {
  border-color: var(--color-status-online);
  background: rgba(34, 197, 94, 0.08);
}

.item-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.player-name {
  font-weight: 700;
  color: var(--color-text-primary);
  font-size: 14px;
}

.player-group {
  font-size: 11px;
  background: rgba(255, 255, 255, 0.05);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--color-text-muted);
}

.item-meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--color-text-muted);
}

.player-ip {
  opacity: 0.8;
}
</style>
