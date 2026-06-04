<template>
  <section class="bz-card ice-toolbar-card">
    <div class="bz-card-body compact">
      <div class="toolbar-grid">
        <label class="field field--type">
          <span>事件类型</span>
          <select :value="filters.type" :disabled="loading" @change="updateType(($event.target as HTMLSelectElement).value)">
            <option value="all">全部</option>
            <option value="damage">伤害</option>
            <option value="wound">击倒</option>
            <option value="kill">击杀</option>
            <option value="revive">复苏</option>
          </select>
        </label>

        <label class="field field--warning">
          <span>提醒结果</span>
          <select :value="filters.warning" :disabled="loading" @change="updateWarning(($event.target as HTMLSelectElement).value)">
            <option value="all">全部</option>
            <option value="victim_sent">受害者已发</option>
            <option value="attacker_sent">攻击者已发</option>
            <option value="skipped">已跳过</option>
            <option value="failed">已失败</option>
          </select>
        </label>

        <label class="field field--relation">
          <span>关系</span>
          <select :value="filters.relation" :disabled="loading" @change="updateRelation(($event.target as HTMLSelectElement).value)">
            <option value="all">全部</option>
            <option value="enemy">敌对</option>
            <option value="friendly">友伤</option>
            <option value="self">自伤</option>
            <option value="same_player">同人</option>
          </select>
        </label>

        <label class="field field--weapon">
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

        <label class="field field--search">
          <span>搜索</span>
          <input
            :value="filters.q"
            :disabled="loading"
            placeholder="攻击者 / 受害者 / 武器 / SteamID / EOSID / 原因"
            @input="update('q', ($event.target as HTMLInputElement).value)"
          >
        </label>

        <label class="field field--limit">
          <span>每页</span>
          <select :value="String(filters.limit)" :disabled="loading" @change="updateLimit(($event.target as HTMLSelectElement).value)">
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="200">200</option>
            <option value="300">300</option>
          </select>
        </label>

        <div class="field field--toggle">
          <span>自动刷新</span>
          <button
            type="button"
            class="toggle-button bz-btn bz-btn-ghost"
            :data-on="filters.autoRefresh"
            :disabled="loading"
            @click="update('autoRefresh', !filters.autoRefresh)"
          >
            {{ filters.autoRefresh ? "开启" : "关闭" }}
          </button>
        </div>
      </div>
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
  if (value === "damage" || value === "wound" || value === "kill" || value === "revive") return value;
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
.toolbar-grid {
  display: grid;
  grid-template-columns: repeat(8, minmax(0, 1fr));
  gap: 6px;
  align-items: end;
}

.field {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.field span {
  color: #8fa2b3;
  font-size: 10px;
  line-height: 1.1;
}

.field--type,
.field--warning,
.field--relation,
.field--weapon {
  grid-column: span 1;
}

.field--search {
  grid-column: span 2;
}

.field--limit,
.field--toggle {
  grid-column: span 1;
}

.field select,
.field input {
  width: 100%;
  min-width: 0;
  border: 1px solid #31404d;
  background: #0f151b;
  color: #edf2f4;
  border-radius: 9px;
  padding: 5px 8px;
  font-size: 11px;
  min-height: 30px;
}

.toggle-button {
  justify-content: flex-start;
  min-height: 30px;
  padding-inline: 10px;
  width: 100%;
}

.toggle-button[data-on="true"] {
  border-color: rgba(74, 222, 128, 0.35);
  background: rgba(74, 222, 128, 0.08);
}

@media (max-width: 1200px) {
  .toolbar-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .field--search {
    grid-column: span 2;
  }
}

@media (max-width: 900px) {
  .toolbar-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .field--search {
    grid-column: span 2;
  }
}

@media (max-width: 720px) {
  .toolbar-grid {
    grid-template-columns: 1fr;
  }

  .field--type,
  .field--warning,
  .field--relation,
  .field--weapon,
  .field--search,
  .field--limit,
  .field--toggle {
    grid-column: auto;
  }
}
</style>
