<template>
  <section class="player-combat-timeline">
    <header class="player-combat-timeline-header">
      <div class="player-combat-timeline-heading">
        <div class="player-combat-timeline-eyebrow">COMBAT HISTORY</div>
        <div class="player-combat-timeline-title">个人战斗记录</div>
        <div class="player-combat-timeline-subtitle">
          伤害、击倒、击杀的最近频率曲线。点击时间点后，可以查看该区间内的事件列表和单条原始记录。
        </div>
      </div>
      <div class="player-combat-timeline-range">{{ rangeLabel }}</div>
    </header>

    <div v-if="loading && !hasData" class="player-combat-empty">
      正在加载个人战斗记录...
    </div>
    <div v-else-if="error" class="player-combat-empty">
      {{ error }}
    </div>
    <template v-else-if="hasData">
      <div class="player-combat-summary-rail">
        <div class="player-combat-summary-card">
          <span>区间</span>
          <strong>{{ selectedBucketRange }}</strong>
        </div>
        <div class="player-combat-summary-card">
          <span>伤害</span>
          <strong class="damage">{{ totals.damage }}</strong>
        </div>
        <div class="player-combat-summary-card">
          <span>击倒</span>
          <strong class="wound">{{ totals.wound }}</strong>
        </div>
        <div class="player-combat-summary-card">
          <span>击杀</span>
          <strong class="kill">{{ totals.kill }}</strong>
        </div>
      </div>

      <div class="player-combat-body">
        <div class="player-combat-chart-card">
          <div class="player-combat-chart-wrap">
            <svg
              class="player-combat-chart"
              viewBox="0 0 720 180"
              preserveAspectRatio="none"
              role="img"
              aria-label="个人战斗频率曲线"
            >
              <g class="player-combat-grid">
                <line
                  v-for="line in gridLines"
                  :key="line"
                  x1="28"
                  :y1="line"
                  x2="692"
                  :y2="line"
                />
              </g>

              <path v-if="damagePath" class="player-combat-line damage" :d="damagePath" />
              <path v-if="woundPath" class="player-combat-line wound" :d="woundPath" />
              <path v-if="killPath" class="player-combat-line kill" :d="killPath" />

              <g
                v-for="(bucket, index) in timeline.buckets"
                :key="`${bucket.start}-${index}`"
                class="player-combat-point-group"
              >
                <circle
                  class="player-combat-point damage"
                  :class="{ selected: selectedBucketIndex === index, empty: bucket.damage === 0 }"
                  :cx="bucket.x"
                  :cy="valueToY(bucket.damage)"
                  :r="bucket.damage > 0 ? 4.5 : 3"
                />
                <circle
                  class="player-combat-point wound"
                  :class="{ selected: selectedBucketIndex === index, empty: bucket.wound === 0 }"
                  :cx="bucket.x"
                  :cy="valueToY(bucket.wound)"
                  :r="bucket.wound > 0 ? 4.5 : 3"
                />
                <circle
                  class="player-combat-point kill"
                  :class="{ selected: selectedBucketIndex === index, empty: bucket.kill === 0 }"
                  :cx="bucket.x"
                  :cy="valueToY(bucket.kill)"
                  :r="bucket.kill > 0 ? 4.5 : 3"
                />
                <rect
                  class="player-combat-hitbox"
                  :class="{ selected: selectedBucketIndex === index }"
                  :x="bucketHitboxX(index)"
                  y="18"
                  :width="bucketHitboxWidth(index)"
                  height="132"
                  role="button"
                  tabindex="0"
                  :aria-label="bucketLabel(bucket)"
                  @mouseenter="selectBucket(index)"
                  @focus="selectBucket(index)"
                  @click="selectBucket(index)"
                />
              </g>
            </svg>
          </div>

          <div class="player-combat-legend">
            <span class="damage">伤害 {{ totals.damage }}</span>
            <span class="wound">击倒 {{ totals.wound }}</span>
            <span class="kill">击杀 {{ totals.kill }}</span>
          </div>
        </div>

        <div class="player-combat-detail">
          <div class="player-combat-detail-header">
            <div>
              <div class="player-combat-detail-title">区间 {{ selectedBucketIndex + 1 }} / {{ timeline.buckets.length }}</div>
              <div class="player-combat-detail-range">{{ selectedBucketRange }}</div>
            </div>
            <div class="player-combat-detail-stats">
              <span class="damage">伤害 {{ selectedBucket.damage }}</span>
              <span class="wound">击倒 {{ selectedBucket.wound }}</span>
              <span class="kill">击杀 {{ selectedBucket.kill }}</span>
            </div>
          </div>

          <div class="player-combat-detail-summary">
            该区间包含 {{ selectedBucket.events.length }} 条记录。点击左侧时间点切换区间，下面的事件列表和原始日志会同步更新。
          </div>

          <div class="player-combat-event-list">
            <button
              v-for="(event, index) in selectedBucketEvents"
              :key="`${event.time}-${event.type}-${index}`"
              type="button"
              class="player-combat-event-row"
              :class="{ friendly: isFriendly(event) }"
              @click="selectedEventIndex = index"
            >
              <span>{{ labelForType(event.type) }}</span>
              <strong>{{ event.displayText || "-" }}</strong>
              <em>{{ formatEventTime(event.time) }}</em>
            </button>
          </div>

          <div v-if="selectedEvent" class="player-combat-event-detail">
            <div class="player-combat-event-detail-head">
              <div>
                <div class="player-combat-event-detail-title">单条记录</div>
                <div class="player-combat-event-detail-subtitle">{{ selectedEvent.displayText || selectedEvent.id || "-" }}</div>
              </div>
              <div class="player-combat-event-detail-type">{{ labelForType(selectedEvent.type) }}</div>
            </div>

            <div class="player-combat-event-grid">
              <div>
                <span>时间</span>
                <strong>{{ formatEventTime(selectedEvent.time) }}</strong>
              </div>
              <div>
                <span>伤害</span>
                <strong>{{ formatNumber(selectedEvent.damage) }}</strong>
              </div>
              <div>
                <span>武器</span>
                <strong>{{ formatWeapon(selectedEvent.weapon) }}</strong>
              </div>
              <div>
                <span>关系</span>
                <strong>{{ relationSummary(selectedEvent.relation) }}</strong>
              </div>
              <div>
                <span>攻击者</span>
                <strong>{{ formatPlayerRef(selectedEvent.attacker) }}</strong>
              </div>
              <div>
                <span>受害者</span>
                <strong>{{ formatPlayerRef(selectedEvent.victim) }}</strong>
              </div>
            </div>

            <div class="player-combat-raw-card">
              <div class="player-combat-raw-title">Raw Log</div>
              <pre class="player-combat-raw-text">{{ selectedEvent.raw?.rawLog || selectedEvent.rawLog || "No rawLog" }}</pre>
            </div>
          </div>
        </div>
      </div>
    </template>
    <div v-else class="player-combat-empty">
      暂无个人战斗记录
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { apiGet } from "../../app/apiClient";
import type { PlayerDetailViewModel } from "../../types/squad-admin.types";

interface CombatEvent {
  id?: string;
  type?: string;
  time?: string | number;
  eventTime?: number;
  displayText?: string;
  damage?: number | string | null;
  weapon?: Record<string, unknown> | null;
  attacker?: Record<string, unknown> | null;
  victim?: Record<string, unknown> | null;
  relation?: Record<string, unknown> | null;
  raw?: { rawLog?: string | null } | null;
  rawLog?: string | null;
}

interface CombatEventWithTime extends CombatEvent {
  _timeMs: number;
}

interface CombatBucket {
  start: number;
  end: number;
  x: number;
  damage: number;
  wound: number;
  kill: number;
  events: CombatEvent[];
}

interface TimelineState {
  buckets: CombatBucket[];
  rangeStart: number;
  rangeEnd: number;
  windowMinutes: number;
}

const props = defineProps<{
  player: PlayerDetailViewModel | null;
  serverId?: string | null;
}>();

const loading = ref(false);
const error = ref("");
const timeline = ref<TimelineState>({
  buckets: [],
  rangeStart: 0,
  rangeEnd: 0,
  windowMinutes: 60,
});
const selectedBucketIndex = ref(0);
const selectedEventIndex = ref(0);

const hasData = computed(() => timeline.value.buckets.length > 0);
const selectedBucket = computed(() => timeline.value.buckets[selectedBucketIndex.value] ?? emptyBucket());
const selectedBucketEvents = computed(() => selectedBucket.value.events ?? []);
const selectedEvent = computed(() => selectedBucketEvents.value[selectedEventIndex.value] ?? selectedBucketEvents.value[0] ?? null);
const selectedBucketRange = computed(() => formatRange(selectedBucket.value.start, selectedBucket.value.end));
const rangeLabel = computed(() => {
  if (!timeline.value.buckets.length) return "最近 60 分钟";
  const minutes = timeline.value.windowMinutes;
  const prefix = minutes >= 60 ? `最近 ${minutes / 60} 小时` : `最近 ${minutes} 分钟`;
  return `${prefix} · ${formatRange(timeline.value.rangeStart, timeline.value.rangeEnd)}`;
});
const totals = computed(() => {
  return timeline.value.buckets.reduce(
    (acc, bucket) => {
      acc.damage += bucket.damage;
      acc.wound += bucket.wound;
      acc.kill += bucket.kill;
      return acc;
    },
    { damage: 0, wound: 0, kill: 0 },
  );
});
const gridLines = computed(() => [18, 62, 106, 150]);
const damagePath = computed(() => buildPath("damage"));
const woundPath = computed(() => buildPath("wound"));
const killPath = computed(() => buildPath("kill"));

watch(
  () => [props.player?.steamId, props.player?.eosId, props.player?.name, props.player?.playerId],
  async () => {
    await loadCombatTimeline();
  },
  { immediate: true },
);

async function loadCombatTimeline() {
  if (!props.player) {
    timeline.value = { buckets: [], rangeStart: 0, rangeEnd: 0, windowMinutes: 60 };
    error.value = "";
    selectedBucketIndex.value = 0;
    selectedEventIndex.value = 0;
    return;
  }

  const searchParams = new URLSearchParams({
    serverId: String(props.serverId ?? "").trim(),
  });

  loading.value = true;
  error.value = "";

  try {
    const data = await apiGet<{ snapshot?: { events?: CombatEvent[] } }>(`/api/combat-manager/cache?${searchParams.toString()}`);
    const list = Array.isArray(data.snapshot?.events) ? data.snapshot.events : [];
    timeline.value = buildTimeline(list);
    const firstNonEmpty = timeline.value.buckets.findIndex((bucket) => bucket.events.length > 0);
    selectedBucketIndex.value = firstNonEmpty >= 0 ? firstNonEmpty : Math.max(0, timeline.value.buckets.length - 1);
    selectedEventIndex.value = 0;
  } catch (err) {
    timeline.value = { buckets: [], rangeStart: 0, rangeEnd: 0, windowMinutes: 60 };
    error.value = err instanceof Error ? err.message : "Failed to load combat timeline";
  } finally {
    loading.value = false;
  }
}

function buildTimeline(sourceEvents: CombatEvent[]): TimelineState {
  const normalized = sourceEvents
    .map((event) => ({
      ...event,
      _timeMs: toTimeMs(event.time ?? event.eventTime),
    } as CombatEventWithTime))
    .filter((event): event is CombatEventWithTime => Number.isFinite(event._timeMs) && event._timeMs > 0)
    .sort((a, b) => a._timeMs - b._timeMs);

  const now = Date.now();
  const recentCutoff = now - 60 * 60 * 1000;
  const recent = normalized.filter((event) => event._timeMs >= recentCutoff);
  const source = recent.length ? recent : normalized.slice(-60);
  const rangeEvents = source.length ? source : normalized;
  const rangeStart = rangeEvents.length ? rangeEvents[0]._timeMs : now - 60 * 60 * 1000;
  const rangeEnd = rangeEvents.length ? rangeEvents[rangeEvents.length - 1]._timeMs : now;
  const spanMinutes = Math.max(60, Math.ceil(Math.max(1, rangeEnd - rangeStart) / 60_000));
  const windowMinutes = chooseWindowMinutes(spanMinutes);
  const bucketMinutes = windowMinutes / 12;
  const bucketMs = bucketMinutes * 60_000;
  const chartEnd = Math.ceil(rangeEnd / bucketMs) * bucketMs || now;
  const chartStart = chartEnd - bucketMs * 12;
  const buckets: CombatBucket[] = Array.from({ length: 12 }, (_, index) => ({
    start: chartStart + index * bucketMs,
    end: chartStart + (index + 1) * bucketMs,
    x: 28 + (664 / Math.max(1, 11)) * index,
    damage: 0,
    wound: 0,
    kill: 0,
    events: [],
  }));

  for (const event of source) {
    const timeMs = Number(event._timeMs);
    const bucketIndex = Math.floor((timeMs - chartStart) / bucketMs);
    if (bucketIndex < 0 || bucketIndex >= buckets.length) continue;
    const bucket = buckets[bucketIndex];
    bucket.events.push(event);
    if (event.type === "damage") bucket.damage += 1;
    else if (event.type === "wound") bucket.wound += 1;
    else if (event.type === "kill") bucket.kill += 1;
  }

  return {
    buckets,
    rangeStart,
    rangeEnd: Math.max(rangeEnd, chartEnd),
    windowMinutes,
  };
}

function buildPath(key: "damage" | "wound" | "kill") {
  const buckets = timeline.value.buckets;
  if (!buckets.length) return "";
  const points = buckets.map((bucket, index) => `${index === 0 ? "M" : "L"}${bucket.x.toFixed(2)} ${valueToY(bucket[key]).toFixed(2)}`);
  return points.join(" ");
}

function valueToY(value: number) {
  const maxValue = Math.max(1, ...timeline.value.buckets.flatMap((bucket) => [bucket.damage, bucket.wound, bucket.kill]));
  const ratio = Math.max(0, Number(value) / maxValue);
  return 150 - ratio * 132;
}

function selectBucket(index: number) {
  selectedBucketIndex.value = index;
  selectedEventIndex.value = 0;
}

function bucketHitboxX(index: number) {
  const bucketCount = Math.max(1, timeline.value.buckets.length);
  const bucketWidth = 664 / bucketCount;
  return 28 + index * bucketWidth;
}

function bucketHitboxWidth(_index: number) {
  const bucketCount = Math.max(1, timeline.value.buckets.length);
  return 664 / bucketCount;
}

function bucketLabel(bucket: CombatBucket) {
  return `${formatRange(bucket.start, bucket.end)} · 伤害 ${bucket.damage} / 击倒 ${bucket.wound} / 击杀 ${bucket.kill}`;
}

function labelForType(type?: string) {
  if (type === "damage") return "伤害";
  if (type === "wound") return "击倒";
  if (type === "kill") return "击杀";
  if (type === "revive") return "复活";
  return type || "-";
}

function formatEventTime(value: unknown) {
  const date = new Date(value as string | number);
  if (Number.isNaN(date.getTime())) return String(value ?? "-");
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatRange(start: number, end: number) {
  return `${formatEventTime(start)} ~ ${formatEventTime(end)}`;
}

function chooseWindowMinutes(spanMinutes: number) {
  if (spanMinutes <= 60) return 60;
  if (spanMinutes <= 120) return 120;
  if (spanMinutes <= 180) return 180;
  return 240;
}

function toTimeMs(value: unknown) {
  const date = new Date(value as string | number);
  const time = date.getTime();
  if (Number.isFinite(time)) return time;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : NaN;
}

function isFriendly(event: CombatEvent) {
  return Boolean((event.relation as Record<string, unknown> | null)?.isFriendlyFire);
}

function formatNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "-";
}

function formatWeapon(weapon: CombatEvent["weapon"]) {
  if (!weapon || typeof weapon !== "object") return "Unknown";
  const record = weapon as Record<string, unknown>;
  return String(record.displayName ?? record.cleaned ?? record.raw ?? "Unknown");
}

function relationSummary(relation: CombatEvent["relation"]) {
  if (!relation || typeof relation !== "object") return "-";
  const record = relation as Record<string, unknown>;
  const friendly = record.isFriendlyFire ? "友伤" : "正常";
  const sameTeam = record.sameTeam ? "同队" : "非同队";
  return `${friendly} / ${sameTeam}`;
}

function formatPlayerRef(player: CombatEvent["attacker"] | CombatEvent["victim"]) {
  if (!player || typeof player !== "object") return "Unknown";
  const record = player as Record<string, unknown>;
  return String(record.displayName ?? record.name ?? "Unknown");
}

function emptyBucket(): CombatBucket {
  return {
    start: 0,
    end: 0,
    x: 28,
    damage: 0,
    wound: 0,
    kill: 0,
    events: [],
  };
}
</script>

<style scoped>
.player-combat-timeline {
  display: grid;
  gap: 14px;
  padding: 16px;
  border-radius: 16px;
  border: 1px solid var(--color-border-soft);
  background:
    radial-gradient(circle at top left, rgba(59, 130, 246, 0.14), transparent 34%),
    radial-gradient(circle at top right, rgba(244, 114, 182, 0.08), transparent 28%),
    var(--color-bg-card);
}

.player-combat-timeline-header {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: flex-start;
}

.player-combat-timeline-heading {
  min-width: 0;
}

.player-combat-timeline-eyebrow {
  color: var(--color-text-muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
}

.player-combat-timeline-title {
  margin-top: 4px;
  font-size: 15px;
  font-weight: 800;
  color: var(--color-text-primary);
}

.player-combat-timeline-subtitle {
  margin-top: 4px;
  color: var(--color-text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.player-combat-timeline-range {
  padding: 8px 10px;
  border-radius: 999px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-secondary);
  font-size: 11px;
  white-space: nowrap;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.08);
}

.player-combat-empty {
  padding: 18px;
  border-radius: 14px;
  border: 1px dashed var(--color-border-soft);
  color: var(--color-text-muted);
  font-size: 13px;
  text-align: center;
  background: rgba(255, 255, 255, 0.02);
}

.player-combat-summary-rail {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.player-combat-summary-card {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.04);
}

.player-combat-summary-card span {
  color: var(--color-text-muted);
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.player-combat-summary-card strong {
  font-size: 16px;
  font-weight: 800;
}

.player-combat-body {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
  gap: 14px;
  align-items: start;
}

.player-combat-chart-card {
  display: grid;
  gap: 12px;
}

.player-combat-chart-wrap {
  position: relative;
  height: 200px;
  padding: 10px;
  border-radius: 16px;
  border: 1px solid var(--color-border-soft);
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.82), rgba(2, 6, 23, 0.52)),
    rgba(10, 14, 22, 0.55);
}

.player-combat-chart {
  display: block;
  width: 100%;
  height: 100%;
}

.player-combat-grid line {
  stroke: rgba(148, 163, 184, 0.14);
  stroke-width: 1;
}

.player-combat-line {
  fill: none;
  stroke-width: 2.5;
}

.player-combat-line.damage { stroke: var(--color-warning); }
.player-combat-line.wound { stroke: #60a5fa; }
.player-combat-line.kill { stroke: #fb7185; }

.player-combat-point {
  stroke: #0b1020;
  stroke-width: 2;
}

.player-combat-point.damage { fill: var(--color-warning); }
.player-combat-point.wound { fill: #60a5fa; }
.player-combat-point.kill { fill: #fb7185; }

.player-combat-point.empty {
  opacity: 0.35;
}

.player-combat-point.selected {
  filter: drop-shadow(0 0 8px rgba(94, 234, 212, 0.45));
}

.player-combat-hitbox {
  fill: transparent;
  stroke: transparent;
  cursor: pointer;
  pointer-events: all;
}

.player-combat-hitbox.selected {
  fill: rgba(94, 234, 212, 0.05);
  stroke: rgba(94, 234, 212, 0.22);
  stroke-width: 1;
}

.player-combat-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.player-combat-legend span,
.player-combat-detail-stats span {
  display: inline-flex;
  align-items: center;
  padding: 6px 9px;
  border-radius: 999px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.04);
  font-size: 11px;
}

.player-combat-legend .damage,
.player-combat-detail-stats .damage,
.player-combat-summary-card .damage {
  color: var(--color-warning);
}

.player-combat-legend .wound,
.player-combat-detail-stats .wound,
.player-combat-summary-card .wound {
  color: #60a5fa;
}

.player-combat-legend .kill,
.player-combat-detail-stats .kill,
.player-combat-summary-card .kill {
  color: #fb7185;
}

.player-combat-detail {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid var(--color-border-soft);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.03)),
    rgba(255, 255, 255, 0.03);
  min-width: 0;
}

.player-combat-detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.player-combat-detail-title {
  font-size: 13px;
  font-weight: 800;
  color: var(--color-text-primary);
}

.player-combat-detail-range {
  margin-top: 4px;
  color: var(--color-text-muted);
  font-size: 11px;
}

.player-combat-detail-summary {
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.45;
}

.player-combat-event-list {
  display: grid;
  gap: 8px;
}

.player-combat-event-row {
  width: 100%;
  display: grid;
  grid-template-columns: 54px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 9px 10px;
  border-radius: 12px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.03);
  text-align: left;
  cursor: pointer;
  transition: transform 120ms ease, border-color 120ms ease, background 120ms ease;
}

.player-combat-event-row.friendly {
  border-color: rgba(251, 113, 133, 0.22);
  background: rgba(127, 29, 29, 0.16);
}

.player-combat-event-row:hover,
.player-combat-event-row:focus-visible {
  transform: translateY(-1px);
  border-color: rgba(148, 163, 184, 0.35);
  background: rgba(255, 255, 255, 0.06);
  outline: none;
}

.player-combat-event-row span {
  color: var(--color-text-muted);
  font-size: 12px;
  white-space: nowrap;
}

.player-combat-event-row strong {
  min-width: 0;
  overflow: hidden;
  color: var(--color-text-primary);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-combat-event-row em {
  color: var(--color-text-muted);
  font-size: 11px;
  font-style: normal;
}

.player-combat-event-detail {
  display: grid;
  gap: 10px;
  padding: 12px;
  border-radius: 14px;
  border: 1px solid var(--color-border-soft);
  background: rgba(0, 0, 0, 0.14);
}

.player-combat-event-detail-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
}

.player-combat-event-detail-title {
  font-size: 13px;
  font-weight: 800;
}

.player-combat-event-detail-subtitle {
  margin-top: 4px;
  color: var(--color-text-muted);
  font-size: 11px;
}

.player-combat-event-detail-type {
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--color-border-soft);
  color: var(--color-text-secondary);
  font-size: 11px;
  white-space: nowrap;
}

.player-combat-event-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.player-combat-event-grid > div {
  display: grid;
  gap: 4px;
}

.player-combat-event-grid span {
  color: var(--color-text-muted);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.player-combat-event-grid strong {
  color: var(--color-text-primary);
  font-size: 12px;
  word-break: break-word;
}

.player-combat-raw-card {
  display: grid;
  gap: 6px;
}

.player-combat-raw-title {
  color: var(--color-text-muted);
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.player-combat-raw-text {
  margin: 0;
  padding: 10px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.22);
  border: 1px solid var(--color-border-soft);
  color: var(--color-text-secondary);
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 180px;
  overflow: auto;
}

@media (max-width: 980px) {
  .player-combat-summary-rail,
  .player-combat-body {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .player-combat-timeline-header,
  .player-combat-detail-header {
    flex-direction: column;
  }

  .player-combat-timeline {
    padding: 14px;
  }

  .player-combat-summary-rail {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .player-combat-event-grid {
    grid-template-columns: 1fr;
  }

  .player-combat-event-row {
    grid-template-columns: 42px minmax(0, 1fr) auto;
  }

  .player-combat-chart-wrap {
    height: 180px;
  }
}
</style>
