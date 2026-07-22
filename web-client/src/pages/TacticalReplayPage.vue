<template>
  <div class="replay-workbench">
    <header class="replay-header">
      <div>
        <p class="eyebrow">TACTICAL ARCHIVE / REPLAY WORKBENCH</p>
        <h1>战术回放工作台</h1>
        <p class="subtitle">从增量录制中还原任意时刻的战场状态，不生成视频，也不把整场回放常驻在浏览器内存。</p>
      </div>
      <div class="header-actions">
        <span class="source-chip" :class="{ live: status && status.enabled }"><i></i>{{ status && status.enabled ? "回放读取器在线" : "读取器未启动" }}</span>
        <button class="ghost-button" type="button" :disabled="loadingSessions" @click="loadSessions">{{ loadingSessions ? "刷新中…" : "刷新档案" }}</button>
      </div>
    </header>

    <div v-if="errorText" class="error-banner">{{ errorText }}</div>
    <div v-if="!sessions.length && !loadingSessions" class="empty-state">
      <div class="empty-icon">◷</div>
      <h2>还没有可播放的战术录制</h2>
      <p>请先在实时战术地图打开录制。录制结束后，档案会出现在这里。</p>
      <button class="primary-button" type="button" @click="loadSessions">重新扫描</button>
    </div>

    <section v-else class="replay-grid">
      <aside class="session-rail panel">
        <div class="panel-heading"><div><span class="panel-kicker">ARCHIVE</span><h2>对局档案</h2></div><span class="count-badge">{{ sessions.length }}</span></div>
        <label class="search-box"><span>⌕</span><input v-model="searchText" type="search" placeholder="搜索地图或图层" /></label>
        <div class="session-list">
          <button v-for="item in filteredSessions" :key="item.id" type="button" class="session-card" :class="{ selected: item.id === (activeSession && activeSession.id) }" @click="selectSession(item)">
            <span class="session-status" :class="item.status"></span>
            <span class="session-body"><strong>{{ item.map || "未知地图" }}</strong><small>{{ item.layer || "未记录图层" }}</small><em><span>{{ formatDate(item.startedAt) }}</span><span>{{ formatDuration(item.durationMs) }}</span></em></span>
            <span class="session-arrow">›</span>
          </button>
          <p v-if="!filteredSessions.length" class="muted-empty">没有匹配的档案</p>
        </div>
      </aside>

      <main class="stage panel">
        <div class="stage-heading">
          <div><span class="panel-kicker">RECONSTRUCTED SCENE</span><h2>{{ activeSession && activeSession.map || "选择一场对局" }}</h2><span class="stage-layer">{{ activeSession && activeSession.layer || "等待选择录制档案" }}</span></div>
          <div class="stage-metrics"><span><b>{{ formatClock(currentMs) }}</b><small>当前时间</small></span><span><b>{{ visiblePlayers.length }}</b><small>场上玩家</small></span><span><b>{{ assetCount }}</b><small>战场设施</small></span></div>
        </div>

        <div
          ref="replayViewportRef"
          class="map-shell"
          :class="{ 'is-dragging': isDragging }"
          @pointerdown="startDrag"
          @pointermove="onPointerMove"
          @pointerup="endDrag"
          @pointercancel="endDrag"
          @pointerleave="endDrag"
          @wheel.prevent="onWheel"
        >
          <div class="map-hud map-hud-top"><b>REPLAY</b><span>{{ activeSession && activeSession.status === "recording" ? "录制中" : "历史档案" }}</span><i>/</i><span>{{ activeMapConfig.name }}</span></div>
          <div class="map-grid"></div>
          <div class="replay-map-transform" :style="camera.getTransform()">
            <div class="map-canvas" :style="{ opacity: hasMapResource ? 1 : 0 }">
              <TiledMapRenderer :tile-base-path="activeMapConfig.tileBasePath" :max-zoom="activeMapConfig.maxZoomLevel" :tiles-enabled="hasMapResource" :interaction-active="isDragging" :viewport-width="viewportWidth" :viewport-height="viewportHeight" :fallback-image="activeMapConfig.image" />
            </div>
            <div v-if="!hasMapResource" class="map-placeholder"><span>MAP DATA UNAVAILABLE</span><small>当前录制没有匹配的地图资源</small></div>
            <div class="asset-layer">
              <span v-for="zone in replayZones" :key="zone.id" class="asset-marker zone-marker" :class="'team-' + (zone.teamId || 0)" :style="markerStyle(zone)" :title="zone.name">{{ zone.name || "ZONE" }}</span>
              <span v-for="fob in replayFobs" :key="fob.id" class="asset-marker fob-marker" :class="'team-' + (fob.teamId || 0)" :style="markerStyle(fob)" :title="fob.name">⌂</span>
            </div>
            <div class="player-layer">
              <button v-for="player in visiblePlayers" :key="player.key" type="button" class="replay-player" :class="{ selected: player.key === (selectedPlayer && selectedPlayer.key) }" :style="markerStyle(player)" @click.stop="selectPlayer(player)">
                <span class="player-pip" :class="'team-' + (player.teamId || 0)" :style="{ transform: 'rotate(' + (player.yaw || 0) + 'deg)' }"></span><span class="player-label">{{ player.name }}</span>
              </button>
            </div>
          </div>
          <div class="map-controls" @pointerdown.stop>
            <button type="button" title="放大" @click="zoomBy(1.25)">＋</button>
            <button type="button" title="缩小" @click="zoomBy(0.8)">−</button>
            <button type="button" title="重置视角" @click="resetCamera">⌂</button>
          </div>
          <div class="map-hud map-hud-bottom"><span>{{ activeSession && activeSession.layer || "NO LAYER" }}</span><i>·</i><span>数据点 {{ state ? formatClock(state.resolvedAtMs) : "--:--" }}</span></div>
          <div v-if="loadingState" class="map-loading">正在重建战场状态…</div>
        </div>

        <div class="timeline">
          <div class="timeline-topline"><span class="timeline-caption">时间轴</span><span>{{ formatClock(currentMs) }} / {{ formatClock(durationMs) }}</span></div>
          <input v-model.number="currentMs" class="timeline-range" type="range" min="0" :max="Math.max(1, durationMs)" step="100" :disabled="!activeSession" />
          <div class="timeline-controls"><button class="play-button" type="button" :disabled="!activeSession" @click="togglePlaying">{{ playing ? "Ⅱ" : "▶" }}</button><button class="control-button" type="button" :disabled="!activeSession" @click="jump(-10)">−10s</button><button class="control-button" type="button" :disabled="!activeSession" @click="jump(10)">+10s</button><div class="speed-group"><button v-for="speed in speeds" :key="speed" class="speed-button" :class="{ active: playbackRate === speed }" type="button" @click="playbackRate = speed">{{ speed }}×</button></div><span class="timeline-hint">{{ playing ? "正在播放" : "已暂停" }}</span></div>
        </div>
      </main>

      <aside class="inspector panel">
        <div class="panel-heading"><div><span class="panel-kicker">AT THIS MOMENT</span><h2>现场摘要</h2></div></div>
        <div class="summary-grid"><div><strong>{{ teamOneCount }}</strong><span>Team 1</span></div><div><strong>{{ teamTwoCount }}</strong><span>Team 2</span></div><div><strong>{{ replayZones.length }}</strong><span>点位</span></div><div><strong>{{ replayFobs.length }}</strong><span>FOB</span></div></div>
        <div class="inspector-divider"></div>
        <div v-if="selectedPlayer" class="selected-player">
          <div class="selected-top"><span class="large-pip" :class="'team-' + (selectedPlayer.teamId || 0)"></span><div><span class="panel-kicker">SELECTED UNIT</span><h3>{{ selectedPlayer.name }}</h3></div></div>
          <dl class="detail-list"><div><dt>阵营</dt><dd>Team {{ selectedPlayer.teamId || "--" }}</dd></div><div><dt>小队</dt><dd>{{ selectedPlayer.squadId || "--" }}</dd></div><div><dt>职业</dt><dd>{{ selectedPlayer.role || "未记录" }}</dd></div><div><dt>生命</dt><dd>{{ selectedPlayer.health == null ? "--" : Math.round(selectedPlayer.health * 100) + "%" }}</dd></div><div><dt>延迟</dt><dd>{{ selectedPlayer.ping == null ? "--" : selectedPlayer.ping + " ms" }}</dd></div><div><dt>坐标</dt><dd>{{ selectedPlayer.positionText }}</dd></div></dl>
        </div>
        <div v-else class="inspector-placeholder"><span>◎</span><p>点击地图上的单位</p><small>查看该时刻的玩家状态</small></div>
        <div class="inspector-footer"><span class="health-dot"></span><span>状态来自 .rps 增量记录</span></div>
      </aside>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { apiGet } from "../app/apiClient";
import TiledMapRenderer from "../components/tactical-map/TiledMapRenderer.vue";
import { provideTacticalMapViewport } from "../composables/tacticalMapViewport";
import { useMapCamera } from "../composables/useMapCamera";
import { EMPTY_TACTICAL_MAP_CONFIG, TACTICAL_MAP_CONFIGS, resolveTacticalMapKey } from "../shared/tactical-map-data";

interface ReplaySession { id: string; map?: string; layer?: string; status?: string; durationMs?: number; startedAt?: string; }
interface ReplayPosition { x: number; y: number; z?: number; }
interface ReplayPlayer { key: string; name: string; teamId: number | null; squadId: number | null; role: string; health: number | null; ping: number | null; yaw: number | null; position: ReplayPosition | null; positionText: string; hasPosition: boolean; }
interface ReplayAsset { id: string; name: string; teamId: number | null; position: ReplayPosition; hasPosition: boolean; [key: string]: unknown; }

const sessions = ref<ReplaySession[]>([]);
const activeSession = ref<ReplaySession | null>(null);
const state = ref<Record<string, any> | null>(null);
const status = ref<Record<string, any> | null>(null);
const selectedPlayer = ref<ReplayPlayer | null>(null);
const searchText = ref("");
const currentMs = ref(0);
const playing = ref(false);
const playbackRate = ref(1);
const loadingSessions = ref(false);
const loadingState = ref(false);
const errorText = ref("");
const speeds = [0.5, 1, 2, 4];
const replayViewportRef = ref<HTMLElement | null>(null);
const viewportWidth = ref(0);
const viewportHeight = ref(0);
const camera = useMapCamera();
const isDragging = camera.isDragging;
const dragMoved = ref(false);
let resizeObserver: ResizeObserver | null = null;
let animationTimer: ReturnType<typeof setInterval> | null = null;
let seekTimer: ReturnType<typeof setTimeout> | null = null;
let latestRequestedMs = -1;

const filteredSessions = computed(() => {
  const query = searchText.value.trim().toLocaleLowerCase();
  return query ? sessions.value.filter((item) => (String(item.map || "") + " " + String(item.layer || "")).toLocaleLowerCase().includes(query)) : sessions.value;
});
const durationMs = computed(() => Math.max(1, Number((activeSession.value && activeSession.value.durationMs) || (state.value && state.value.session && state.value.session.durationMs) || 1)));
const activeMapConfig = computed(() => {
  const source = (activeSession.value && activeSession.value.map) || (state.value && state.value.state && state.value.state.server && state.value.state.server.map) || (activeSession.value && activeSession.value.layer) || "";
  const key = resolveTacticalMapKey(source);
  return (key && TACTICAL_MAP_CONFIGS[key]) || EMPTY_TACTICAL_MAP_CONFIG;
});
const hasMapResource = computed(() => Boolean(activeMapConfig.value.tileBasePath || activeMapConfig.value.image));
const currentSnapshot = computed(() => state.value && state.value.state || null);
const rawPlayers = computed<any[]>(() => Array.isArray(currentSnapshot.value && currentSnapshot.value.players) ? currentSnapshot.value.players : []);
const visiblePlayers = computed<ReplayPlayer[]>(() => rawPlayers.value.map(normalizePlayer).filter((item: ReplayPlayer) => item.hasPosition));
const replayZones = computed(() => normalizeAssets(currentSnapshot.value && currentSnapshot.value.assets && currentSnapshot.value.assets.captureZones));
const replayFobs = computed(() => normalizeAssets(currentSnapshot.value && currentSnapshot.value.assets && currentSnapshot.value.assets.fobs));
const assetCount = computed(() => replayZones.value.length + replayFobs.value.length + normalizeAssets(currentSnapshot.value && currentSnapshot.value.assets && currentSnapshot.value.assets.mainZones).length);
const teamOneCount = computed(() => visiblePlayers.value.filter((item: ReplayPlayer) => item.teamId === 1).length);
const teamTwoCount = computed(() => visiblePlayers.value.filter((item: ReplayPlayer) => item.teamId === 2).length);

provideTacticalMapViewport({ zoom: camera.zoom, panX: camera.x, panY: camera.y });

function normalizePlayer(source: any): ReplayPlayer {
  const position = source && source.telemetry && source.telemetry.position || source && source.position;
  return { key: String(source && source.identity && (source.identity.key || source.identity.name) || Math.random()), name: String(source && source.identity && source.identity.name || "Unknown"), teamId: numberOrNull(source && source.match && source.match.teamId), squadId: numberOrNull(source && source.match && source.match.squadId), role: String(source && source.match && source.match.role || ""), health: numberOrNull(source && source.telemetry && source.telemetry.health), ping: numberOrNull(source && source.network && source.network.gamePing), yaw: numberOrNull(source && source.telemetry && source.telemetry.yaw), position, positionText: position ? round(position.x) + ", " + round(position.y) : "--", hasPosition: Boolean(position && Number.isFinite(Number(position.x)) && Number.isFinite(Number(position.y))) };
}
function normalizeAssets(values: any): ReplayAsset[] {
  return (Array.isArray(values) ? values : []).map((item, index) => {
    const position = item && (item.position || item.location || item.coordinates) || item;
    const x = Number(position && position.x);
    const y = Number(position && position.y);
    return { ...item, id: String(item && (item.id || item.name) || index + "-" + x + "-" + y), name: String(item && item.name || ""), teamId: numberOrNull(item && (item.teamId || item.teamID || item.team)), position: { x, y }, hasPosition: Number.isFinite(x) && Number.isFinite(y) } as ReplayAsset;
  }).filter((item) => item.hasPosition);
}
function markerStyle(item: any) {
  const bounds = activeMapConfig.value.bounds;
  return { left: project(Number(item.position && item.position.x), bounds.minX, bounds.maxX) + "%", top: project(Number(item.position && item.position.y), bounds.minY, bounds.maxY) + "%" };
}
function project(value: number, min: number, max: number) { if (!Number.isFinite(value) || max <= min) return 50; return Math.min(98, Math.max(2, ((value - min) / (max - min)) * 100)); }
function numberOrNull(value: any) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function round(value: any) { const n = Number(value); return Number.isFinite(n) ? Math.round(n) : "--"; }
function formatClock(value: any) { const total = Math.max(0, Math.floor(Number(value || 0) / 1000)); return String(Math.floor(total / 60)).padStart(2, "0") + ":" + String(total % 60).padStart(2, "0"); }
function formatDuration(value: any) { return Number(value) > 0 ? formatClock(value) : "--:--"; }
function formatDate(value: any) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "未知时间" : date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }); }

function updateViewportSize() {
  const element = replayViewportRef.value;
  if (!element) return;
  viewportWidth.value = element.clientWidth;
  viewportHeight.value = element.clientHeight;
  if (!isDragging.value && camera.zoom.value === 1 && camera.x.value === 0 && camera.y.value === 0) resetCamera();
}
function resetCamera() {
  const mapSize = 1000;
  camera.zoom.value = 1;
  camera.x.value = (viewportWidth.value - mapSize) / 2;
  camera.y.value = (viewportHeight.value - mapSize) / 2;
}
function zoomBy(factor: number) {
  const next = Math.min(8, Math.max(0.35, camera.zoom.value * factor));
  camera.setZoom(next, viewportWidth.value / 2, viewportHeight.value / 2);
}
function onWheel(event: WheelEvent) {
  zoomBy(event.deltaY < 0 ? 1.12 : 0.89);
}
function startDrag(event: PointerEvent) {
  if (event.button !== 0) return;
  dragMoved.value = false;
  (event.currentTarget as HTMLElement)?.setPointerCapture?.(event.pointerId);
  camera.startDrag(event.clientX, event.clientY);
}
function onPointerMove(event: PointerEvent) {
  if (!isDragging.value) return;
  if (Math.abs(event.movementX) + Math.abs(event.movementY) > 0) dragMoved.value = true;
  camera.onDrag(event.clientX, event.clientY);
}
function endDrag(event?: PointerEvent) {
  if (event && (event.currentTarget as HTMLElement)?.hasPointerCapture?.(event.pointerId)) {
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  }
  camera.endDrag();
}
function selectPlayer(player: ReplayPlayer) {
  if (dragMoved.value) { dragMoved.value = false; return; }
  selectedPlayer.value = player;
}

function scheduleStateLoad() {
  if (!activeSession.value || (state.value && Math.abs(currentMs.value - latestRequestedMs) < 250)) return;
  if (seekTimer) clearTimeout(seekTimer);
  seekTimer = setTimeout(() => void loadState(currentMs.value), 120);
}
async function loadSessions() {
  loadingSessions.value = true;
  errorText.value = "";
  try {
    const response = await apiGet<any>("/api/tactical-replay/sessions?limit=100");
    sessions.value = Array.isArray(response && response.sessions) ? response.sessions : [];
    const selected = sessions.value.find((item) => item.id === (activeSession.value && activeSession.value.id)) || sessions.value[0] || null;
    if (selected) await selectSession(selected);
  } catch (error: any) { errorText.value = error && error.message || "无法读取回放档案"; }
  finally { loadingSessions.value = false; }
}
async function selectSession(session: any) { playing.value = false; activeSession.value = session; currentMs.value = 0; latestRequestedMs = -1; selectedPlayer.value = null; await loadState(0); }
async function loadState(atMs: number) {
  if (!activeSession.value) return;
  latestRequestedMs = atMs;
  loadingState.value = true;
  try {
    state.value = await apiGet<any>("/api/tactical-replay/sessions/" + encodeURIComponent(activeSession.value.id) + "/state?at=" + Math.max(0, Math.round(atMs)));
  } catch (error: any) { errorText.value = error && error.message || "无法重建回放状态"; }
  finally { loadingState.value = false; }
}
function togglePlaying() {
  if (!activeSession.value) return;
  playing.value = !playing.value;
  if (!playing.value) { if (animationTimer) clearInterval(animationTimer); animationTimer = null; return; }
  if (currentMs.value >= durationMs.value) currentMs.value = 0;
  if (animationTimer) clearInterval(animationTimer);
  animationTimer = setInterval(() => { const next = currentMs.value + 100 * playbackRate.value; if (next >= durationMs.value) { currentMs.value = durationMs.value; playing.value = false; if (animationTimer) clearInterval(animationTimer); animationTimer = null; } else currentMs.value = next; }, 100);
}
function jump(seconds: number) { currentMs.value = Math.min(durationMs.value, Math.max(0, currentMs.value + seconds * 1000)); }
watch(currentMs, scheduleStateLoad);
watch(activeMapConfig, () => { void nextTick(updateViewportSize); });
onMounted(async () => {
  resizeObserver = new ResizeObserver(updateViewportSize);
  if (replayViewportRef.value) resizeObserver.observe(replayViewportRef.value);
  updateViewportSize();
  try { const response = await apiGet<any>("/api/tactical-replay/status"); status.value = response && response.status || null; } catch { status.value = null; }
  await loadSessions();
});
onBeforeUnmount(() => { if (animationTimer) clearInterval(animationTimer); if (seekTimer) clearTimeout(seekTimer); resizeObserver?.disconnect(); resizeObserver = null; });
</script>

<style scoped>
:global(body) { background: #07111f; }
.replay-workbench { min-height: 100%; padding: 26px 30px 34px; color: #e8f0fb; background: radial-gradient(circle at 18% 0%, rgba(22,101,137,.2), transparent 35%), #07111f; }
.replay-header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; margin-bottom: 24px; }
.eyebrow, .panel-kicker { color: #6f9bb5; font-size: 10px; letter-spacing: .18em; font-weight: 700; }
.replay-header h1 { margin: 7px 0 8px; font-size: clamp(24px, 3vw, 38px); letter-spacing: -.04em; }
.subtitle { color: #83a0b7; margin: 0; max-width: 690px; line-height: 1.6; font-size: 13px; }
.header-actions { display: flex; align-items: center; gap: 10px; }
.source-chip, .ghost-button, .primary-button, .control-button, .speed-button, .play-button { border: 1px solid rgba(150,190,211,.2); border-radius: 10px; color: #cfe1ee; background: rgba(13,30,48,.8); }
.source-chip { padding: 9px 12px; font-size: 12px; white-space: nowrap; }
.source-chip.live { color: #8cf0c1; border-color: rgba(73,214,151,.35); }
.source-chip i, .health-dot, .session-status { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #74879c; margin-right: 7px; }
.source-chip.live i { background: #40dfa0; box-shadow: 0 0 12px #40dfa0; }
.ghost-button, .primary-button, .control-button, .speed-button { padding: 9px 12px; cursor: pointer; }
.primary-button { background: #2ec98b; color: #062117; border-color: #2ec98b; font-weight: 700; }
.error-banner { padding: 12px 14px; margin-bottom: 18px; color: #ffc5c5; border: 1px solid rgba(248,113,113,.3); background: rgba(127,29,29,.2); border-radius: 10px; }
.panel { border: 1px solid rgba(141,182,205,.14); background: linear-gradient(145deg, rgba(16,35,54,.96), rgba(8,20,34,.96)); box-shadow: 0 24px 80px rgba(0,0,0,.2); border-radius: 16px; }
.replay-grid { display: grid; grid-template-columns: 235px minmax(0,1fr) 245px; gap: 15px; min-height: calc(100vh - 190px); }
.session-rail, .inspector { padding: 16px; min-height: 640px; }
.panel-heading, .stage-heading, .timeline-topline, .timeline-controls, .selected-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.panel-heading h2, .stage-heading h2 { margin: 5px 0 0; font-size: 17px; }
.count-badge { min-width: 25px; padding: 4px 7px; text-align: center; border-radius: 7px; background: rgba(65,151,191,.18); color: #9bcee2; font-size: 12px; }
.search-box { display: flex; gap: 8px; align-items: center; padding: 9px 10px; margin: 17px 0 12px; border: 1px solid rgba(150,190,211,.14); border-radius: 9px; color: #7a9ab0; background: rgba(5,15,26,.5); }
.search-box input { width: 100%; border: 0; outline: 0; color: #e8f0fb; background: transparent; font-size: 12px; }
.session-list { display: grid; gap: 7px; max-height: calc(100vh - 300px); overflow: auto; }
.session-card { display: grid; grid-template-columns: 8px minmax(0,1fr) auto; gap: 9px; width: 100%; padding: 11px 9px; text-align: left; color: #bad0df; border: 1px solid transparent; border-radius: 10px; background: rgba(4,13,24,.34); cursor: pointer; }
.session-card:hover, .session-card.selected { border-color: rgba(71,211,165,.45); background: rgba(23,81,79,.25); }
.session-status { margin: 4px 0 0; background: #718298; }
.session-status.recording { background: #40dfa0; box-shadow: 0 0 8px #40dfa0; }
.session-body { min-width: 0; display: grid; gap: 4px; }
.session-card strong { overflow: hidden; color: #f2f7fb; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.session-card small { overflow: hidden; color: #7c9aaf; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.session-card em { display: flex; justify-content: space-between; color: #6c879a; font-size: 10px; font-style: normal; }
.session-arrow { color: #5e879d; font-size: 20px; }
.muted-empty, .inspector-placeholder { color: #6f8b9e; font-size: 12px; text-align: center; }
.stage { min-width: 0; padding: 17px; }
.stage-layer { display: inline-block; margin-top: 7px; color: #7697ab; font-size: 11px; }
.stage-metrics { display: flex; gap: 18px; }
.stage-metrics span { display: grid; gap: 3px; text-align: right; }
.stage-metrics b { color: #eaf7f5; font-size: 16px; }
.stage-metrics small { color: #6f8d9e; font-size: 10px; }
.map-shell { position: relative; min-height: 540px; margin-top: 15px; overflow: hidden; border: 1px solid rgba(164,209,224,.18); border-radius: 12px; background: #081827; cursor: grab; touch-action: none; user-select: none; }
.map-shell.is-dragging { cursor: grabbing; }
.replay-map-transform { position: absolute; top: 0; left: 0; width: 1000px; height: 1000px; transform-origin: 0 0; will-change: transform; z-index: 2; background: #020205; }
.map-grid { position: absolute; inset: 0; z-index: 1; pointer-events: none; opacity: .22; background-image: linear-gradient(rgba(120,183,203,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(120,183,203,.12) 1px, transparent 1px); background-size: 64px 64px; }
.map-canvas { position: absolute; inset: 0; z-index: 0; transition: opacity .2s; }
.map-placeholder { position: absolute; inset: 0; z-index: 2; display: grid; place-content: center; gap: 8px; text-align: center; color: #7498ab; letter-spacing: .12em; font-size: 12px; }
.map-placeholder small { letter-spacing: 0; color: #547384; font-size: 11px; }
.map-hud { position: absolute; z-index: 10; display: flex; gap: 8px; align-items: center; padding: 8px 10px; border: 1px solid rgba(159,210,224,.18); background: rgba(4,16,28,.75); color: #aacbd6; font-size: 10px; backdrop-filter: blur(8px); }
.map-hud-top { top: 12px; left: 12px; border-radius: 7px; }
.map-hud-bottom { right: 12px; bottom: 12px; border-radius: 7px; }
.map-hud b, .timeline-caption { color: #55ddb6; letter-spacing: .12em; }
.map-hud i { color: #507080; font-style: normal; }
.asset-layer, .player-layer { position: absolute; inset: 0; z-index: 5; pointer-events: none; }
.replay-player, .asset-marker { position: absolute; transform: translate(-50%,-50%); pointer-events: auto; }
.replay-player { display: flex; align-items: center; gap: 3px; flex-direction: column; border: 0; background: transparent; color: #e9f7ff; cursor: pointer; }
.player-pip { width: 10px; height: 10px; border: 2px solid #eafcff; background: #49c9ff; clip-path: polygon(50% 0,100% 100%,50% 78%,0 100%); }
.player-pip.team-2 { background: #ff6572; }
.replay-player.selected .player-pip { box-shadow: 0 0 0 4px rgba(255,255,255,.4), 0 0 18px currentColor; }
.player-label { max-width: 100px; padding: 2px 4px; overflow: hidden; border-radius: 4px; color: #f1fbff; background: rgba(3,12,21,.7); font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.asset-marker { padding: 3px 5px; border: 1px solid rgba(255,255,255,.55); border-radius: 5px; color: #fff; background: rgba(12,85,95,.75); font-size: 9px; }
.fob-marker { width: 22px; height: 22px; padding: 0; display: grid; place-items: center; border-radius: 50%; color: #8debd1; background: rgba(4,53,54,.86); font-size: 14px; }
.fob-marker.team-2 { color: #ff9ca5; background: rgba(90,30,43,.86); }
.zone-marker.team-1 { border-color: #52d7ff; background: rgba(16,91,118,.75); }
.zone-marker.team-2 { border-color: #ff7882; background: rgba(113,43,57,.75); }
.map-loading { position: absolute; inset: 0; z-index: 20; display: grid; place-items: center; color: #b8d5df; background: rgba(4,15,26,.35); backdrop-filter: blur(2px); font-size: 12px; }
.map-controls { position: absolute; z-index: 12; right: 12px; top: 12px; display: grid; gap: 5px; }
.map-controls button { width: 30px; height: 30px; border: 1px solid rgba(159,210,224,.2); border-radius: 7px; color: #bfeaf0; background: rgba(4,16,28,.78); cursor: pointer; font-size: 16px; }
.map-controls button:hover { color: #fff; border-color: rgba(85,221,182,.7); background: rgba(24,92,83,.75); }
.timeline { margin-top: 15px; padding: 13px 3px 2px; }
.timeline-topline { color: #9ab4c0; font-size: 11px; }
.timeline-range { width: 100%; margin: 13px 0 11px; accent-color: #3ed9a1; cursor: pointer; }
.timeline-controls { justify-content: flex-start; }
.play-button { width: 34px; height: 32px; padding: 0; color: #062117; background: #43dca5; border-color: #43dca5; font-weight: 800; cursor: pointer; }
.control-button, .speed-button { color: #9db9c6; background: rgba(6,19,32,.72); font-size: 11px; }
.speed-group { display: flex; gap: 4px; margin-left: auto; }
.speed-button { padding: 6px 8px; }
.speed-button.active { color: #071b18; border-color: #40dfa0; background: #40dfa0; }
.timeline-hint { color: #668697; font-size: 10px; }
.summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; margin-top: 17px; }
.summary-grid div { display: grid; gap: 4px; padding: 11px 10px; border-radius: 9px; background: rgba(5,17,29,.5); }
.summary-grid strong { color: #ecfafa; font-size: 20px; }
.summary-grid span { color: #7592a3; font-size: 10px; }
.inspector-divider { height: 1px; margin: 18px 0; background: rgba(150,190,211,.12); }
.selected-top { justify-content: flex-start; }
.large-pip { width: 19px; height: 19px; flex: 0 0 auto; border-radius: 50%; background: #49c9ff; box-shadow: 0 0 16px rgba(73,201,255,.45); }
.large-pip.team-2 { background: #ff6572; box-shadow: 0 0 16px rgba(255,101,114,.4); }
.selected-player h3 { margin: 4px 0 0; color: #f1fbff; font-size: 15px; }
.detail-list { display: grid; gap: 8px; margin: 18px 0; }
.detail-list div { display: flex; justify-content: space-between; gap: 8px; color: #7897a7; font-size: 11px; }
.detail-list dd { margin: 0; color: #d0e4ed; text-align: right; }
.inspector-placeholder { display: grid; place-items: center; gap: 7px; min-height: 270px; }
.inspector-placeholder span { color: #4cd8aa; font-size: 30px; }
.inspector-placeholder p { margin: 0; color: #b6ced8; }
.inspector-placeholder small { color: #648293; }
.inspector-footer { display: flex; align-items: center; margin-top: auto; padding-top: 14px; color: #688799; font-size: 10px; }
.health-dot { margin: 0 6px 0 0; background: #43dca5; box-shadow: 0 0 8px #43dca5; }
.empty-state { display: grid; place-items: center; gap: 10px; min-height: 60vh; text-align: center; border: 1px dashed rgba(126,178,198,.25); border-radius: 16px; background: rgba(9,25,41,.65); }
.empty-icon { color: #55ddb6; font-size: 48px; }
.empty-state h2 { margin: 0; font-size: 20px; }
.empty-state p { margin: 0 0 8px; color: #7897a7; font-size: 13px; }
@media (max-width: 1200px) { .replay-grid { grid-template-columns: 210px minmax(0,1fr); } .inspector { grid-column: 1 / -1; min-height: auto; } .inspector-placeholder { min-height: 100px; } }
@media (max-width: 800px) { .replay-workbench { padding: 18px 12px 24px; } .replay-header { display: grid; } .header-actions { justify-content: space-between; } .replay-grid { display: block; } .session-rail, .stage, .inspector { min-height: auto; margin-bottom: 12px; } .session-list { max-height: 260px; } .map-shell { min-height: 420px; } .stage-metrics { gap: 8px; } .stage-metrics span:nth-child(3) { display: none; } }
</style>
