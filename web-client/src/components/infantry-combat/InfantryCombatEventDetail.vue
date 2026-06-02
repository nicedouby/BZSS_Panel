<template>
  <aside class="detail-card">
    <template v-if="event">
      <header class="detail-head">
        <div class="detail-head__text">
          <p class="kicker">事件详情</p>
          <h2>{{ eventTitle }}</h2>
          <p class="subtitle">{{ formatTime(event.time) }}</p>
        </div>
        <button type="button" class="close-button" @click="emit('close')">关闭</button>
      </header>

      <section class="detail-section detail-section--hero">
        <div class="hero-chips">
          <span class="hero-chip">类型 {{ typeLabel(event.type) }}</span>
          <span class="hero-chip">伤害 {{ formatNumber(event.damage) }}</span>
          <span class="hero-chip">武器 {{ valueOf(event.weapon) }}</span>
        </div>
      </section>

      <section class="detail-section">
        <div class="section-head">
          <h3>基础信息</h3>
          <button type="button" class="ghost-button" @click="copyJson(eventJson, '事件 JSON')">复制 JSON</button>
        </div>
        <div class="kv-grid">
          <div v-for="item in baseInfo" :key="item.key" class="kv-row">
            <span>{{ item.key }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
      </section>

      <section class="detail-section">
        <h3>攻击者</h3>
        <div class="kv-grid">
          <div v-for="item in attackerInfo" :key="item.key" class="kv-row">
            <span>{{ item.key }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
      </section>

      <section class="detail-section">
        <h3>受害者</h3>
        <div class="kv-grid">
          <div v-for="item in victimInfo" :key="item.key" class="kv-row">
            <span>{{ item.key }}</span>
            <strong>{{ item.value }}</strong>
          </div>
        </div>
      </section>

      <section class="detail-section">
        <h3>标签</h3>
        <div class="tag-grid">
          <span v-for="tag in formattedTags" :key="tag.key" class="tag-chip" :data-tone="tag.tone">{{ tag.label }}</span>
          <span v-if="!formattedTags.length" class="tag-empty">-</span>
        </div>
      </section>

      <section class="detail-section">
        <div class="section-head">
          <h3>受害者提醒</h3>
          <button type="button" class="ghost-button" @click="copyJson(victimWarningJson, '受害者提醒 JSON')">复制</button>
        </div>
        <WarningDecisionBadge :decision="event.victimWarning" role-label="受害者" />
      </section>

      <section class="detail-section">
        <div class="section-head">
          <h3>攻击者提醒</h3>
          <button type="button" class="ghost-button" @click="copyJson(attackerWarningJson, '攻击者提醒 JSON')">复制</button>
        </div>
        <WarningDecisionBadge :decision="event.attackerWarning" role-label="攻击者" />
      </section>

      <details class="debug-block">
        <summary>调试 JSON</summary>
        <pre>{{ eventJson }}</pre>
      </details>
    </template>

    <template v-else>
      <div class="empty-state">
        <strong>请选择一条事件查看详情</strong>
        <p>左侧点击任意一行后，这里会显示完整记录、提醒决策和原始 JSON。</p>
      </div>
    </template>
  </aside>
</template>

<script setup lang="ts">
import { computed } from "vue";
import WarningDecisionBadge from "./WarningDecisionBadge.vue";
import type { InfantryCombatEventRecord } from "../../types/infantry-combat-enhancer";
import { copyTextWithToast } from "../../utils/clipboard";
import { formatCombatTags } from "../../utils/combat-tags";
import { useUiStore } from "../../stores/ui.store";

const props = defineProps<{
  event: InfantryCombatEventRecord | null;
}>();

const emit = defineEmits<{
  (event: "close"): void;
}>();

const ui = useUiStore();

const eventJson = computed(() => prettyJson(props.event));
const victimWarningJson = computed(() => prettyJson(props.event?.victimWarning ?? null));
const attackerWarningJson = computed(() => prettyJson(props.event?.attackerWarning ?? null));
const formattedTags = computed(() => formatCombatTags(props.event));
const eventTitle = computed(() => `${typeLabel(props.event?.type)} · ${props.event?.weapon || "未知武器"}`);

const baseInfo = computed(() => [
  { key: "ID", value: valueOf(props.event?.id) },
  { key: "类型", value: typeLabel(props.event?.type) },
  { key: "时间", value: formatTime(props.event?.time) },
  { key: "伤害", value: formatNumber(props.event?.damage) },
  { key: "武器", value: valueOf(props.event?.weapon) },
  { key: "serverId", value: valueOf(props.event?.serverId) },
  { key: "sourceEventId", value: valueOf(props.event?.sourceEventId) },
  { key: "combatEventId", value: valueOf(props.event?.combatEventId) },
]);

const attackerInfo = computed(() => [
  { key: "名称", value: valueOf(props.event?.attackerName ?? props.event?.attacker?.name) },
  { key: "Steam64ID", value: valueOf(props.event?.attackerSteam64ID ?? props.event?.attacker?.steam64ID) },
  { key: "EOSID", value: valueOf(props.event?.attackerEOSID ?? props.event?.attacker?.eosID) },
  { key: "ControllerID", value: valueOf(props.event?.attackerControllerID ?? props.event?.attacker?.controllerID) },
  { key: "TeamID", value: valueOf(props.event?.attackerTeamID ?? props.event?.attacker?.teamID) },
]);

const victimInfo = computed(() => [
  { key: "名称", value: valueOf(props.event?.victimName ?? props.event?.victim?.name) },
  { key: "Steam64ID", value: valueOf(props.event?.victimSteam64ID ?? props.event?.victim?.steam64ID) },
  { key: "EOSID", value: valueOf(props.event?.victimEOSID ?? props.event?.victim?.eosID) },
  { key: "ControllerID", value: valueOf(props.event?.victimControllerID ?? props.event?.victim?.controllerID) },
  { key: "TeamID", value: valueOf(props.event?.victimTeamID ?? props.event?.victim?.teamID) },
]);

async function copyJson(value: string, label: string) {
  await copyTextWithToast(value, ui, {
    label,
    successMessage: "已复制到剪贴板。",
    errorMessage: "无法复制到剪贴板。",
  });
}

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return "{}";
  }
}

function typeLabel(value: unknown) {
  const type = String(value ?? "").trim().toLowerCase();
  if (type === "damage") return "伤害";
  if (type === "wound") return "击倒";
  if (type === "kill") return "击杀";
  return type || "未知";
}

function formatTime(value: unknown) {
  const text = String(value ?? "");
  if (!text) return "-";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString();
}

function formatNumber(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return String(Math.round(number));
}

function valueOf(value: unknown) {
  const text = String(value ?? "").trim();
  return text || "-";
}
</script>

<style scoped>
.detail-card {
  border: 1px solid #29323b;
  border-radius: 16px;
  background:
    radial-gradient(circle at 100% 0%, rgba(96, 165, 250, 0.08), transparent 28%),
    #12181f;
  height: 100%;
  min-height: 0;
  padding: 12px;
  display: grid;
  gap: 10px;
  overflow: auto;
}

.detail-head,
.section-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.detail-head__text {
  min-width: 0;
}

.kicker {
  margin: 0 0 4px;
  color: #8fa2b3;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.detail-head h2,
.detail-section h3 {
  margin: 0;
  color: #edf2f4;
}

.subtitle {
  margin: 4px 0 0;
  color: #8fa2b3;
  font-size: 12px;
}

.detail-section {
  display: grid;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid rgba(41, 50, 59, 0.8);
}

.detail-section--hero {
  padding-top: 0;
  border-top: 0;
}

.hero-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.hero-chip {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid #31404d;
  background: #0f151b;
  color: #dbe2e8;
  font-size: 11px;
}

.kv-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.kv-row {
  display: grid;
  gap: 3px;
  padding: 8px 10px;
  border-radius: 12px;
  background: #0f151b;
  border: 1px solid #29323b;
}

.kv-row span {
  color: #8fa2b3;
  font-size: 11px;
}

.kv-row strong {
  color: #edf2f4;
  font-size: 13px;
  word-break: break-word;
}

.tag-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-chip,
.tag-empty {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid #31404d;
  background: #0f151b;
  color: #dbe2e8;
  font-size: 11px;
}

.tag-chip[data-tone="ok"] {
  border-color: rgba(74, 222, 128, 0.35);
  background: rgba(74, 222, 128, 0.08);
}

.tag-chip[data-tone="warn"] {
  border-color: rgba(251, 191, 36, 0.35);
  background: rgba(251, 191, 36, 0.08);
}

.tag-chip[data-tone="danger"] {
  border-color: rgba(248, 113, 113, 0.35);
  background: rgba(248, 113, 113, 0.08);
}

.tag-empty {
  color: #7f919f;
}

.ghost-button,
.close-button {
  border: 1px solid #31404d;
  background: #0f151b;
  color: #edf2f4;
  border-radius: 10px;
  padding: 7px 10px;
  font-size: 12px;
}

.debug-block {
  border-top: 1px solid rgba(41, 50, 59, 0.8);
  padding-top: 12px;
}

.debug-block summary {
  cursor: pointer;
  color: #8fa2b3;
  font-size: 12px;
  margin-bottom: 10px;
}

.debug-block pre {
  margin: 0;
  padding: 10px;
  background: #0b1116;
  border: 1px solid #29323b;
  border-radius: 12px;
  color: #dbe2e8;
  font-size: 11px;
  line-height: 1.45;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.empty-state {
  display: grid;
  gap: 6px;
  padding: 14px;
  border: 1px dashed #34404c;
  border-radius: 14px;
  color: #9aa7b2;
  min-height: 100%;
  align-content: center;
  justify-items: start;
}

.empty-state strong {
  color: #edf2f4;
}

@media (max-width: 720px) {
  .kv-grid {
    grid-template-columns: 1fr;
  }
}
</style>
