<template>
  <section class="records-panel">
    <header class="records-head">
      <div>
        <p class="kicker">输出记录</p>
        <h2>事件流</h2>
      </div>
      <div class="records-head-actions">
        <span class="head-chip">{{ events.length }} 条</span>
        <span class="head-chip">{{ selectedLabel }}</span>
      </div>
    </header>

    <div class="record-stats">
      <span class="stat-chip primary">总计 {{ stats.total }}</span>
      <span class="stat-chip">伤 {{ stats.damage }}</span>
      <span class="stat-chip">倒 {{ stats.wound }}</span>
      <span class="stat-chip">杀 {{ stats.kill }}</span>
      <span class="stat-chip">复 {{ stats.revive }}</span>
      <span class="stat-chip ok">发 {{ stats.sent }}</span>
      <span class="stat-chip warn">跳 {{ stats.skipped }}</span>
      <span class="stat-chip danger">失 {{ stats.failed }}</span>
    </div>

    <div v-if="events.length" class="record-list">
      <article
        v-for="event in events"
        :key="event.id"
        :class="recordClass(event)"
        @click="emit('select', event)"
      >
        <div class="record-accent" :data-tone="eventTone(event)" />

        <div class="record-body">
          <div class="record-meta">
            <span class="log-time">{{ formatTime(event.time) }}</span>
            <span class="type-pill" :data-tone="eventTone(event)">{{ typeLabel(event.type) }}</span>
            <span class="relation-pill" :data-tone="relationTone(event)">{{ relationLabel(event) }}</span>
            <span v-if="event.samePlayer" class="mini-pill danger">同人</span>
          </div>

          <div class="record-main">
            <div class="record-entity">
              <span class="record-entity__label">攻击者</span>
              <strong class="entity-name">{{ event.attackerName || event.attacker?.name || "-" }}</strong>
            </div>
            <span class="log-arrow">→</span>
            <div class="record-entity">
              <span class="record-entity__label">受害者</span>
              <strong class="entity-name">{{ event.victimName || event.victim?.name || "-" }}</strong>
            </div>
            <span class="log-damage">{{ formatDamage(event.damage) }}</span>
            <span class="log-weapon">{{ weaponLabel(event.weapon) }}</span>
          </div>

          <div class="record-foot">
            <div class="record-tagline">
              <span class="log-label">标签</span>
              <span v-for="tag in compactTags(event)" :key="tag.key" class="tag-chip" :data-tone="tag.tone">{{ tag.label }}</span>
              <span v-if="!compactTags(event).length" class="tag-empty">无标签</span>
            </div>
            <div class="record-warnings">
              <WarningDecisionBadge :decision="event.victimWarning" role-label="受害者" />
              <WarningDecisionBadge :decision="event.attackerWarning" role-label="攻击者" />
            </div>
          </div>
        </div>
      </article>
    </div>

    <div v-else class="empty-list">
      <strong>没有可输出的记录</strong>
      <p>当前筛选条件下没有事件。可以调整类型、关系、武器或搜索词。</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import WarningDecisionBadge from "./WarningDecisionBadge.vue";
import type { InfantryCombatEventRecord } from "../../types/infantry-combat-enhancer";
import { formatCombatTags } from "../../utils/combat-tags";

const props = defineProps<{
  events: InfantryCombatEventRecord[];
  selectedId?: string | null;
}>();

const emit = defineEmits<{
  (event: "select", value: InfantryCombatEventRecord): void;
}>();

const stats = computed(() => buildStats(props.events));
const selectedLabel = computed(() => {
  if (!props.selectedId) return "未选中";
  const selected = props.events.find((event) => event.id === props.selectedId);
  return selected ? `选中 ${typeLabel(selected.type)} · ${formatTime(selected.time)}` : "已选中";
});

function buildStats(events: InfantryCombatEventRecord[]) {
  const state = {
    total: events.length,
    damage: 0,
    wound: 0,
    kill: 0,
    revive: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    samePlayer: 0,
    friendlyFire: 0,
    selfDamage: 0,
  };

  for (const event of events) {
    const type = String(event.type ?? "").trim().toLowerCase();
    if (type === "damage") state.damage += 1;
    if (type === "wound") state.wound += 1;
    if (type === "kill") state.kill += 1;
    if (type === "revive") state.revive += 1;
    if (event.victimWarning?.success) state.sent += 1;
    if (event.attackerWarning?.success) state.sent += 1;
    if (event.victimWarning?.skipped || event.attackerWarning?.skipped) state.skipped += 1;
    if (
      (event.victimWarning && event.victimWarning.success === false && !event.victimWarning.skipped)
      || (event.attackerWarning && event.attackerWarning.success === false && !event.attackerWarning.skipped)
    ) {
      state.failed += 1;
    }
    if (event.samePlayer) state.samePlayer += 1;
    if (isFriendly(event)) state.friendlyFire += 1;
    if (isSelfDamage(event)) state.selfDamage += 1;
  }

  return state;
}

function recordClass(event: InfantryCombatEventRecord) {
  return [
    "record-card",
    `record-card--${String(event.type || "unknown")}`,
    isFriendly(event) ? "record-card--friendly" : "",
    isSelfDamage(event) ? "record-card--self" : "",
    event.samePlayer ? "record-card--same" : "",
    props.selectedId && event.id === props.selectedId ? "record-card--selected" : "",
  ].filter(Boolean);
}

function typeLabel(value: unknown) {
  const type = String(value ?? "").trim().toLowerCase();
  if (type === "revive") return "复苏";
  if (type === "damage") return "伤";
  if (type === "wound") return "倒";
  if (type === "kill") return "杀";
  return type || "未知";
}

function eventTone(event: InfantryCombatEventRecord) {
  const type = String(event.type ?? "").trim().toLowerCase();
  if (type === "revive") return "ok";
  if (type === "kill") return "danger";
  if (type === "wound") return "warn";
  if (type === "damage") return "ok";
  return "neutral";
}

function relationLabel(event: InfantryCombatEventRecord) {
  if (event.samePlayer) return "同人";
  if (isSelfDamage(event)) return "自伤";
  if (isFriendly(event)) return "友伤";
  return "敌对";
}

function relationTone(event: InfantryCombatEventRecord) {
  if (event.samePlayer || isSelfDamage(event)) return "danger";
  if (isFriendly(event)) return "warn";
  return "ok";
}

function weaponLabel(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "未知武器";
  if (text.length <= 18) return text;
  return `${text.slice(0, 16)}…`;
}

function isFriendly(event: InfantryCombatEventRecord) {
  const tags = Array.isArray(event.tags) ? event.tags.map((tag) => String(tag ?? "").trim().toLowerCase()) : [];
  return Boolean(
    event?.relation?.isFriendlyFire
    || tags.includes("combat.team_damage")
    || tags.includes("combat.team_wound")
    || tags.includes("combat.team_kill")
    || tags.includes("friendly_fire")
  );
}

function isSelfDamage(event: InfantryCombatEventRecord) {
  const tags = Array.isArray(event.tags) ? event.tags.map((tag) => String(tag ?? "").trim().toLowerCase()) : [];
  return Boolean(
    event.samePlayer
    || event?.relation?.isSelfDamage
    || tags.includes("combat.self_damage")
    || tags.includes("event:self_damage")
    || tags.includes("self_damage")
  );
}

function compactTags(event: InfantryCombatEventRecord) {
  return formatCombatTags(event).slice(0, 2);
}

function formatTime(value: unknown) {
  const text = String(value ?? "");
  if (!text) return "-";
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString();
}

function formatDamage(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  return String(Math.round(number));
}
</script>

<style scoped>
.records-panel {
  border: 1px solid #29323b;
  border-radius: 14px;
  background:
    radial-gradient(circle at 0% 0%, rgba(96, 165, 250, 0.07), transparent 32%),
    linear-gradient(180deg, #12181f 0%, #10161c 100%);
  min-height: 0;
  height: 100%;
  max-height: none;
  overflow: hidden;
  padding: 8px;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 6px;
}

.records-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.kicker {
  margin: 0 0 1px;
  color: #88b8ff;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.records-head h2 {
  margin: 0;
  color: #edf2f4;
  font-size: 13px;
  line-height: 1;
}

.records-head-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 3px;
}

.head-chip,
.stat-chip {
  display: inline-flex;
  align-items: center;
  min-height: 16px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid #31404d;
  background: #0f151b;
  color: #dbe2e8;
  font-size: 8px;
  line-height: 1;
}

.record-stats {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: max-content;
  gap: 3px;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 1px;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.record-stats::-webkit-scrollbar {
  display: none;
}

.stat-chip.primary {
  border-color: rgba(96, 165, 250, 0.45);
  background: rgba(96, 165, 250, 0.08);
}

.stat-chip.ok {
  border-color: rgba(74, 222, 128, 0.35);
  background: rgba(74, 222, 128, 0.08);
}

.stat-chip.warn {
  border-color: rgba(251, 191, 36, 0.35);
  background: rgba(251, 191, 36, 0.08);
}

.stat-chip.danger {
  border-color: rgba(248, 113, 113, 0.35);
  background: rgba(248, 113, 113, 0.08);
}

.record-list {
  display: grid;
  gap: 5px;
  grid-auto-rows: max-content;
  align-content: start;
  min-height: 0;
  height: 100%;
  overflow: auto;
  padding-right: 2px;
}

.record-card {
  position: relative;
  display: grid;
  grid-template-columns: 2px minmax(0, 1fr);
  gap: 10px;
  padding: 8px 10px 8px 0;
  border-radius: 12px;
  border: 1px solid #2b3540;
  background: rgba(13, 19, 25, 0.94);
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
  min-height: 88px;
  overflow: hidden;
}

.record-card:hover {
  border-color: #405061;
  background: rgba(15, 22, 29, 0.98);
  transform: translateY(-1px);
}

.record-card--selected {
  border-color: rgba(96, 165, 250, 0.65);
  box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.14);
}

.record-card--friendly {
  background: rgba(251, 191, 36, 0.03);
}

.record-card--self {
  background: rgba(244, 114, 182, 0.03);
}

.record-card--same {
  background: rgba(168, 85, 247, 0.03);
}

.record-accent {
  grid-row: 1 / span 1;
  width: 2px;
  border-radius: 999px;
  background: #56708a;
}

.record-accent[data-tone="ok"] {
  background: #4ade80;
}

.record-accent[data-tone="warn"] {
  background: #fbbf24;
}

.record-accent[data-tone="danger"] {
  background: #f87171;
}

.record-body {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.record-meta,
.record-main,
.record-foot {
  min-width: 0;
}

.record-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.log-time {
  color: #edf2f4;
  font-size: 12px;
  font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
  letter-spacing: 0.02em;
}

.type-pill,
.relation-pill,
.mini-pill,
.tag-chip,
.tag-empty {
  display: inline-flex;
  align-items: center;
  min-height: 16px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid #31404d;
  background: #0f151b;
  color: #dbe2e8;
  font-size: 8.5px;
}

.type-pill[data-tone="ok"],
.relation-pill[data-tone="ok"] {
  border-color: rgba(74, 222, 128, 0.35);
  background: rgba(74, 222, 128, 0.08);
}

.type-pill[data-tone="warn"],
.relation-pill[data-tone="warn"] {
  border-color: rgba(251, 191, 36, 0.35);
  background: rgba(251, 191, 36, 0.08);
}

.type-pill[data-tone="danger"],
.relation-pill[data-tone="danger"] {
  border-color: rgba(248, 113, 113, 0.35);
  background: rgba(248, 113, 113, 0.08);
}

.mini-pill.danger {
  border-color: rgba(248, 113, 113, 0.35);
  background: rgba(248, 113, 113, 0.08);
}

.record-main {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.record-entity {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.record-entity__label {
  color: #8fa2b3;
  font-size: 9px;
  line-height: 1.1;
}

.entity-name {
  color: #edf2f4;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.log-arrow {
  color: #88b8ff;
  font-size: 10px;
  flex: 0 0 auto;
}

.log-damage {
  display: inline-flex;
  align-items: center;
  min-height: 16px;
  padding: 0 6px;
  border-radius: 999px;
  border: 1px solid rgba(96, 165, 250, 0.3);
  background: rgba(96, 165, 250, 0.08);
  color: #edf2f4;
  font-size: 9px;
  font-weight: 700;
  flex: 0 0 auto;
}

.log-weapon {
  color: #8fa2b3;
  font-size: 9px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.record-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.record-tagline {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
  flex: 1 1 auto;
}

.record-warnings {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 4px;
  flex: 0 0 auto;
}

.log-label {
  color: #8fa2b3;
  font-size: 9px;
  white-space: nowrap;
}

.tag-chip,
.tag-empty {
  flex: 0 0 auto;
}

.tag-empty {
  color: #7f919f;
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

.empty-list {
  border: 1px dashed #34404c;
  border-radius: 14px;
  padding: 12px;
  color: #9aa7b2;
  display: grid;
  gap: 4px;
  min-height: 0;
  height: 100%;
  place-content: center;
  justify-items: center;
  text-align: center;
}

.empty-list strong {
  color: #edf2f4;
}

@media (max-width: 1200px) {
  .record-main {
    grid-template-columns: minmax(0, 1fr);
    gap: 4px;
  }

  .log-arrow,
  .log-damage,
  .log-weapon {
    justify-self: start;
  }

  .record-foot {
    align-items: flex-start;
  }
}

@media (max-width: 720px) {
  .record-card {
    padding-right: 8px;
  }

  .record-main {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
