<template>
  <section class="toolbar-card">
    <div class="toolbar-grid">
      <label class="field">
        <span>事件类型</span>
        <select :value="filters.type" :disabled="loading" @change="updateType(($event.target as HTMLSelectElement).value)">
          <option value="all">全部</option>
          <option value="damage">伤害</option>
          <option value="wound">击倒</option>
          <option value="kill">击杀</option>
        </select>
      </label>

      <label class="field">
        <span>提醒结果</span>
        <select :value="filters.warning" :disabled="loading" @change="updateWarning(($event.target as HTMLSelectElement).value)">
          <option value="all">全部</option>
          <option value="victim_sent">受害者已发送</option>
          <option value="attacker_sent">攻击者已发送</option>
          <option value="skipped">任意跳过</option>
          <option value="failed">任意失败</option>
        </select>
      </label>

      <label class="field">
        <span>关系</span>
        <select :value="filters.relation" :disabled="loading" @change="updateRelation(($event.target as HTMLSelectElement).value)">
          <option value="all">全部</option>
          <option value="enemy">敌对</option>
          <option value="friendly">友伤</option>
          <option value="self">自伤</option>
          <option value="same_player">同人</option>
        </select>
      </label>

      <label class="field">
        <span>武器</span>
        <select :value="filters.weapon" :disabled="loading" @change="updateWeapon(($event.target as HTMLSelectElement).value)">
          <option value="all">全部</option>
          <option value="light">轻武器</option>
          <option value="non_light">非轻武器</option>
          <option value="explosive">爆炸物</option>
          <option value="vehicle">载具</option>
          <option value="emplacement">固定武器</option>
          <option value="unknown">未知</option>
        </select>
      </label>

      <label class="field search">
        <span>搜索</span>
        <input
          :value="filters.q"
          :disabled="loading"
          placeholder="攻击者 / 受害者 / 武器 / SteamID / EOSID / 原因"
          @input="update('q', ($event.target as HTMLInputElement).value)"
        >
      </label>

      <label class="field">
        <span>每页</span>
        <select :value="String(filters.limit)" :disabled="loading" @change="updateLimit(($event.target as HTMLSelectElement).value)">
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="200">200</option>
          <option value="300">300</option>
        </select>
      </label>

      <div class="field toggle">
        <span>自动刷新</span>
        <button type="button" class="toggle-button" :data-on="filters.autoRefresh" :disabled="loading" @click="update('autoRefresh', !filters.autoRefresh)">
          {{ filters.autoRefresh ? "开启" : "关闭" }}
        </button>
      </div>
    </div>

    <div class="toolbar-meta">
      <span class="meta-chip">第 {{ Math.floor(filters.offset / Math.max(filters.limit, 1)) + 1 }} 页</span>
      <span class="meta-chip">偏移 {{ filters.offset }}</span>
      <span class="meta-chip" :data-tone="loading ? 'warn' : 'ok'">{{ loading ? "刷新中" : "实时刷新" }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { InfantryCombatFilters } from "../../types/infantry-combat-enhancer";

const props = defineProps<{
  filters: InfantryCombatFilters;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (event: "update:filters", value: InfantryCombatFilters): void;
}>();

function update<K extends keyof InfantryCombatFilters>(key: K, value: InfantryCombatFilters[K]) {
  emit("update:filters", {
    ...props.filters,
    [key]: value,
  });
}

function updateType(value: string) {
  update("type", normalizeType(value));
}

function updateWarning(value: string) {
  update("warning", normalizeWarning(value));
}

function updateRelation(value: string) {
  update("relation", normalizeRelation(value));
}

function updateWeapon(value: string) {
  update("weapon", normalizeWeapon(value));
}

function updateLimit(value: string) {
  const parsed = Number(value);
  update("limit", Number.isFinite(parsed) ? parsed : props.filters.limit);
}

function normalizeType(value: string): InfantryCombatFilters["type"] {
  if (value === "damage" || value === "wound" || value === "kill") return value;
  return "all";
}

function normalizeWarning(value: string): InfantryCombatFilters["warning"] {
  if (value === "victim_sent" || value === "attacker_sent" || value === "skipped" || value === "failed") return value;
  return "all";
}

function normalizeRelation(value: string): InfantryCombatFilters["relation"] {
  if (value === "enemy" || value === "friendly" || value === "self" || value === "same_player") return value;
  return "all";
}

function normalizeWeapon(value: string): InfantryCombatFilters["weapon"] {
  if (value === "light" || value === "non_light" || value === "explosive" || value === "vehicle" || value === "emplacement" || value === "unknown") return value;
  return "all";
}
</script>

<style scoped>
.toolbar-card {
  border: 1px solid #29323b;
  border-radius: 16px;
  background: #12181f;
  padding: 14px;
  display: grid;
  gap: 12px;
}

.toolbar-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}

.field {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.field span {
  color: #8fa2b3;
  font-size: 12px;
}

.field select,
.field input {
  width: 100%;
  border: 1px solid #31404d;
  background: #0f151b;
  color: #edf2f4;
  border-radius: 10px;
  padding: 10px 12px;
}

.field.search {
  grid-column: span 2;
}

.field.toggle {
  align-content: end;
}

.toggle-button {
  border: 1px solid #31404d;
  background: #0f151b;
  color: #edf2f4;
  border-radius: 10px;
  min-height: 42px;
  padding: 0 12px;
  text-align: left;
}

.toggle-button[data-on="true"] {
  border-color: rgba(74, 222, 128, 0.35);
  background: rgba(74, 222, 128, 0.08);
}

.toolbar-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.meta-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid #31404d;
  background: #0f151b;
  color: #9aa7b2;
  font-size: 11px;
}

.meta-chip[data-tone="ok"] {
  border-color: rgba(74, 222, 128, 0.35);
  color: #caedd4;
}

.meta-chip[data-tone="warn"] {
  border-color: rgba(251, 191, 36, 0.35);
  color: #f5db97;
}

@media (max-width: 1200px) {
  .toolbar-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .field.search {
    grid-column: span 2;
  }
}

@media (max-width: 720px) {
  .toolbar-grid {
    grid-template-columns: 1fr;
  }

  .field.search {
    grid-column: auto;
  }
}
</style>
