<template>
  <div class="player-combat-timeline-integrated">
    <div v-if="loading && !hasData" class="player-combat-empty">
      正在加载个人战斗记录...
    </div>
    <div v-else-if="error" class="player-combat-empty">
      {{ error }}
    </div>
    <template v-else-if="hasData">
      <div class="player-combat-body">
        <!-- Left Side: Curve Chart -->
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
                  :r="bucket.damage > 0 ? 4 : 2"
                />
                <circle
                  class="player-combat-point wound"
                  :class="{ selected: selectedBucketIndex === index, empty: bucket.wound === 0 }"
                  :cx="bucket.x"
                  :cy="valueToY(bucket.wound)"
                  :r="bucket.wound > 0 ? 4 : 2"
                />
                <circle
                  class="player-combat-point kill"
                  :class="{ selected: selectedBucketIndex === index, empty: bucket.kill === 0 }"
                  :cx="bucket.x"
                  :cy="valueToY(bucket.kill)"
                  :r="bucket.kill > 0 ? 4 : 2"
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
            <span class="legend-item damage">伤害 ({{ totals.damage }})</span>
            <span class="legend-item wound">击倒 ({{ totals.wound }})</span>
            <span class="legend-item kill">击杀 ({{ totals.kill }})</span>
          </div>
        </div>

        <!-- Right Side: Scrollable Event/Kill List -->
        <div class="player-combat-event-list-container">
          <div class="player-combat-list-header">
            <span class="list-header-title">区间记录 ({{ selectedBucketEvents.length }} 条)</span>
            <span class="list-header-range">{{ selectedBucketRangeShort }}</span>
          </div>
          <div v-if="selectedBucketEvents.length === 0" class="player-combat-list-empty">
            当前区间无战斗事件
          </div>
          <div v-else class="player-combat-event-list scrollable">
            <div
              v-for="(event, idx) in selectedBucketEvents"
              :key="event.id || idx"
              class="player-combat-event-row"
              :class="{ friendly: isFriendly(event), selected: selectedEventIndex === idx }"
              @click="selectedEventIndex = idx"
            >
              <div class="event-meta-row">
                <span class="event-time">{{ formatTimeOnly(event.time ?? event.eventTime) }}</span>
                <span class="event-badge" :class="event.type">{{ labelForType(event.type) }}</span>
              </div>
              <div class="event-desc-row">
                <strong class="event-desc">{{ formatEventText(event) }}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
    <div v-else class="player-combat-empty">
      暂无个人战斗记录
    </div>
  </div>
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

const MAX_EVENTS = 200;

const loading = ref(false);
const error = ref("");
const showEventDetails = ref(false);
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

const selectedBucketRangeShort = computed(() => {
  const start = selectedBucket.value.start;
  const end = selectedBucket.value.end;
  if (!start || !end) return "";
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return "";
  const formatTime = (d: Date) => d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${formatTime(startDate)} ~ ${formatTime(endDate)}`;
});

function formatEventText(event: CombatEvent) {
  if (event.type === "kill" || event.type === "wound" || event.type === "tk" || event.type === "teamkill") {
    const attackerName = formatPlayerRef(event.attacker);
    const victimName = formatPlayerRef(event.victim);
    const verb = (event.type === "kill") ? "击杀" : (event.type === "wound" ? "击倒" : "TK");
    const weaponName = formatWeapon(event.weapon);
    return `${attackerName} ${verb} ${victimName} [${weaponName}]`;
  }
  return event.displayText || "";
}

function formatTimeOnly(value: unknown) {
  const date = new Date(value as string | number);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}
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

  const serverId = String(props.serverId ?? "").trim();
  if (!serverId) {
    timeline.value = { buckets: [], rangeStart: 0, rangeEnd: 0, windowMinutes: 60 };
    error.value = "";
    selectedBucketIndex.value = 0;
    selectedEventIndex.value = 0;
    return;
  }

  const searchParams = new URLSearchParams({
    serverId,
    limit: String(MAX_EVENTS),
    offset: "0",
  });

  const player = props.player;
  const searchTerms = [
    player?.steam64,
    player?.steamId,
    player?.eosId,
    player?.name,
    player?.playerId != null ? String(player.playerId) : "",
  ].map((value) => String(value ?? "").trim()).filter(Boolean);
  if (searchTerms.length > 0) {
    searchParams.set("search", searchTerms[0]);
  }
  if (player?.steamId) searchParams.set("steamID", player.steamId);
  if (player?.steam64) searchParams.set("steam64ID", player.steam64);
  if (player?.eosId) searchParams.set("eosID", player.eosId);
  if (player?.name) searchParams.set("name", player.name);
  if (player?.playerId != null) searchParams.set("playerKey", String(player.playerId));

  loading.value = true;
  error.value = "";

  try {
    const data = await apiGet<{ events?: CombatEvent[] }>(`/api/combat-manager/player-events?${searchParams.toString()}`);
    const sourceEvents = Array.isArray(data.events) ? data.events.slice(-MAX_EVENTS) : [];
    timeline.value = buildTimeline(sourceEvents);
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
  showEventDetails.value = false;
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
.player-combat-timeline-integrated {
  display: grid;
  gap: 14px;
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

.player-combat-body {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr);
  gap: 14px;
  height: 200px;
  align-items: stretch;
}

.player-combat-chart-card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  height: 100%;
}

.player-combat-chart-wrap {
  position: relative;
  height: 156px;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(10, 14, 22, 0.55);
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

.player-combat-line.damage { stroke: var(--color-warning, #eab308); }
.player-combat-line.wound { stroke: #60a5fa; }
.player-combat-line.kill { stroke: #fb7185; }

.player-combat-point {
  stroke: #0b1020;
  stroke-width: 2;
}

.player-combat-point.damage { fill: var(--color-warning, #eab308); }
.player-combat-point.wound { fill: #60a5fa; }
.player-combat-point.kill { fill: #fb7185; }

.player-combat-point.empty {
  opacity: 0.2;
}

.player-combat-point.selected {
  filter: drop-shadow(0 0 6px rgba(94, 234, 212, 0.6));
}

.player-combat-hitbox {
  fill: transparent;
  stroke: transparent;
  cursor: pointer;
  pointer-events: all;
}

.player-combat-hitbox.selected {
  fill: rgba(255, 255, 255, 0.03);
  stroke: rgba(255, 255, 255, 0.15);
  stroke-width: 1;
}

.player-combat-legend {
  display: flex;
  justify-content: flex-start;
  gap: 12px;
  margin-top: 4px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 700;
}

.legend-item.damage { color: var(--color-warning, #eab308); }
.legend-item.wound { color: #60a5fa; }
.legend-item.kill { color: #fb7185; }

/* Event / Kill List styles */
.player-combat-event-list-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(10, 14, 22, 0.3);
  overflow: hidden;
}

.player-combat-list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.04);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.list-header-title {
  font-size: 11px;
  font-weight: 800;
  color: #94a3b8;
}

.list-header-range {
  font-size: 9px;
  color: #475569;
}

.player-combat-list-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #475569;
  font-size: 11px;
}

.player-combat-event-list.scrollable {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.player-combat-event-list.scrollable::-webkit-scrollbar {
  width: 4px;
}

.player-combat-event-list.scrollable::-webkit-scrollbar-thumb {
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.08);
}

.player-combat-event-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.04);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: all 0.2s ease;
}

.player-combat-event-row:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
}

.player-combat-event-row.selected {
  border-color: var(--glow-color, rgba(168, 85, 247, 0.5));
  background: var(--glow-color-soft, rgba(168, 85, 247, 0.08));
}

.player-combat-event-row.friendly {
  border-color: rgba(239, 68, 68, 0.2);
  background: rgba(239, 68, 68, 0.04);
}

.event-meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.event-time {
  font-size: 10px;
  color: #64748b;
  font-family: Consolas, Monaco, monospace;
}

.event-badge {
  font-size: 8px;
  font-weight: 800;
  padding: 1px 4px;
  border-radius: 3px;
  text-transform: uppercase;
}

.event-badge.damage {
  background: rgba(234, 179, 8, 0.1);
  color: #eab308;
}

.event-badge.wound {
  background: rgba(96, 165, 250, 0.1);
  color: #60a5fa;
}

.event-badge.kill {
  background: rgba(251, 113, 133, 0.1);
  color: #fb7185;
}

.event-badge.tk, .event-badge.teamkill {
  background: rgba(192, 132, 252, 0.15);
  color: #c084fc;
}

.event-desc-row {
  min-width: 0;
}

.event-desc {
  font-size: 11px;
  color: #cbd5e1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
}

@media (max-width: 768px) {
  .player-combat-body {
    grid-template-columns: 1fr;
    height: auto;
  }
  .player-combat-event-list-container {
    height: 180px;
  }
}
</style>
