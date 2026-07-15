<template>
  <div class="db-list">
    <div v-if="loading" class="list-placeholder">{{ t("database.loadingPlayerList") }}</div>
    <div v-else-if="error" class="list-placeholder error">{{ error }}</div>
    <div v-else-if="!rows.length" class="list-placeholder">{{ t("database.noMatchingPlayers") }}</div>
    <RecycleScroller
      v-else
      class="db-list-scroller"
      :items="rows"
      :item-size="92"
      key-field="id"
      v-slot="{ item: player }"
    >
      <div class="player-item-wrap">
        <div
          class="player-item"
          :class="{ active: selectedId === player.id }"
          @click="$emit('select', player.id)"
        >
          <img
            v-if="player.steam_avatar || player.steamAvatar"
            class="player-avatar"
            :src="player.steam_avatar || player.steamAvatar"
            alt=""
            width="42"
            height="42"
            loading="lazy"
            decoding="async"
            fetchpriority="low"
          >
          <div v-else class="player-avatar player-avatar-fallback">
            {{ String(player.current_name || player.name || "?").slice(0, 1).toUpperCase() }}
          </div>
          <div class="item-main">
            <span class="player-name">{{ player.current_name || player.name || t("common.unknown") }}</span>
            <span class="player-group">{{ player.permission_group || "default" }}</span>
          </div>
          <div v-if="player.qq_number || player.qqNumber" class="item-qq">
            QQ: {{ player.qq_number || player.qqNumber }}
          </div>
          <div class="item-meta">
            <span>{{ formatTime(player.updated_at) }}</span>
            <span v-if="player.current_ip || player.ip" class="player-ip">{{ player.current_ip || player.ip }}</span>
          </div>
        </div>
      </div>
    </RecycleScroller>
  </div>
</template>

<script setup lang="ts">
import { RecycleScroller } from "vue-virtual-scroller";
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
  min-height: 0;
  overflow: hidden;
  padding: 8px;
}

.db-list-scroller {
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}

.player-item-wrap {
  height: 92px;
  padding-bottom: 8px;
}

.list-placeholder {
  padding: 32px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 14px;
}

.player-item {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr);
  column-gap: 10px;
  row-gap: 4px;
  padding: 12px;
  border: 1px solid var(--color-border-default);
  border-radius: 10px;
  background: var(--color-bg-panel);
  cursor: pointer;
  transition: border-color 0.15s ease, background-color 0.15s ease;
  contain: layout paint style;
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
  min-width: 0;
}

.player-avatar {
  grid-row: span 3;
  width: 42px;
  height: 42px;
  border-radius: 10px;
  object-fit: cover;
  background: rgba(255, 255, 255, 0.06);
}

.player-avatar-fallback {
  display: grid;
  place-items: center;
  font-size: 16px;
  font-weight: 700;
  color: var(--color-text-muted);
}

.item-qq {
  font-size: 12px;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

.player-name {
  min-width: 0;
  overflow: hidden;
  font-weight: 700;
  color: var(--color-text-primary);
  font-size: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-group {
  flex: 0 0 auto;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.05);
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--color-text-muted);
}

.item-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  font-size: 11px;
  color: var(--color-text-muted);
}

.player-ip {
  overflow: hidden;
  opacity: 0.8;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .player-item { transition: none; }
}
</style>
