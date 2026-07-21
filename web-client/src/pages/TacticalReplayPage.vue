<template>
  <div class="tactical-replay-page">
    <header class="replay-header">
      <div class="replay-title-block">
        <span class="replay-kicker">TACTICAL REPLAY</span>
        <h1>战术地图回放</h1>
        <p>玩家真值帧 0.33 秒 · FOB / Capture Zone / 主基地关键帧 5 秒</p>
      </div>

      <div class="replay-session-controls">
        <label>
          <span>对局记录</span>
          <select v-model="selectedSessionId" :disabled="sessionsLoading" @change="void selectSession(selectedSessionId)">
            <option value="">请选择一局</option>
            <option v-for="session in sessions" :key="session.id" :value="session.id">
              {{ formatSessionOption(session) }}
            </option>
          </select>
        </label>
        <button type="button" :disabled="sessionsLoading" @click="void refreshSessions(true)">
          {{ sessionsLoading ? "刷新中" : "刷新记录" }}
        </button>
        <RouterLink class="live-map-link" to="/tactical-map">返回实时地图</RouterLink>
      </div>
    </header>

    <main class="replay-workspace">
      <section class="map-stage">
        <div v-if="!selectedSession" class="empty-state">
          <strong>选择一局对局记录</strong>
          <span>回放会合并当前玩家帧与该时间点之前最近的资产关键帧。</span>
        </div>

        <div v-else class="map-canvas" :class="{ 'has-resource': Boolean(activeMapConfig.image) }">
          <img
            v-if="activeMapConfig.image"
            class="map-background"
            :src="activeMapConfig.image"
            :alt="selectedSession.layer || selectedSession.map || 'Tactical map'"
            draggable="false"
          />
          <div v-else class="map-background-placeholder">
            <strong>{{ selectedSession.layer || selectedSession.map || "未知地图" }}</strong>
            <span>当前图层尚未配置地图图片</span>
          </div>

          <div class="map-grid" aria-hidden="true"></div>

          <svg class="player-trail-layer" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
            <polyline
              v-for="trail in trailPaths"
              :key="trail.key"
              :points="trail.points"
              class="player-trail"
              :class="teamClass(trail.teamId)"
              vector-effect="non-scaling-stroke"
            />
          </svg>

          <div class="asset-layer main-zone-layer">
            <div
              v-for="zone in mainZoneMarkers"
              :key="zone.id"
              class="asset-marker main-zone-marker"
              :class="teamClass(zone.teamId)"
              :style="markerStyle(zone.mapX, zone.mapY)"
              :title="zone.name"
            >
              <span class="main-zone-icon">◆</span>
              <strong>{{ zone.name }}</strong>
            </div>
          </div>

          <div class="asset-layer capture-zone-layer">
            <div
              v-for="zone in captureZoneMarkers"
              :key="zone.id"
              class="asset-marker capture-zone-marker"
              :class="[teamClass(zone.teamId), { 'is-capturing': zone.isCapturing, 'is-locked': zone.isLocked }]"
              :style="markerStyle(zone.mapX, zone.mapY)"
              :title="zone.tooltip"
            >
              <span class="capture-zone-ring" :style="{ '--capture-progress': `${zone.progress}%` }"></span>
              <strong>{{ zone.name }}</strong>
            </div>
          </div>

          <div class="asset-layer fob-layer">
            <div
              v-for="fob in fobMarkers"
              :key="fob.id"
              class="asset-marker fob-marker"
              :class="[teamClass(fob.teamId), { 'is-bleeding': fob.isBleeding }]"
              :style="markerStyle(fob.mapX, fob.mapY)"
              :title="fob.tooltip"
            >
              <span class="fob-icon">▰</span>
              <strong>{{ fob.name }}</strong>
              <small>弹 {{ formatResource(fob.ammo) }} · 建 {{ formatResource(fob.construction) }}</small>
            </div>
          </div>

          <div class="player-layer">
            <div
              v-for="player in displayedPlayers"
              :key="player.key"
              class="player-marker"
              :class="[teamClass(player.teamId), { 'is-dead': player.health != null && player.health <= 0 }]"
              :style="markerStyle(player.mapX, player.mapY)"
              :title="player.tooltip"
            >
              <span class="player-direction" :style="{ transform: `rotate(${player.yaw ?? 0}deg)` }"></span>
              <span class="player-dot"></span>
              <span class="player-label">
                <strong>{{ player.name }}</strong>
                <small v-if="player.squadId">S{{ player.squadId }} · {{ formatHealth(player.health) }}</small>
              </span>
            </div>
          </div>

          <div class="map-timecode">
            <span>{{ formatClock(currentTimeMs) }}</span>
            <small>{{ currentPlayerFrame?.at ? formatTimestamp(currentPlayerFrame.at) : "--" }}</small>
          </div>

          <div v-if="framesLoading" class="map-loading-mask">读取回放帧…</div>
        </div>
      </section>

      <aside class="replay-inspector">
        <section class="inspector-card">
          <span class="card-label">SESSION</span>
          <h2>{{ selectedSession?.layer || selectedSession?.map || "未选择" }}</h2>
          <dl>
            <div><dt>地图</dt><dd>{{ selectedSession?.map || "--" }}</dd></div>
            <div><dt>模式</dt><dd>{{ selectedSession?.mode || "--" }}</dd></div>
            <div><dt>状态</dt><dd>{{ selectedSession?.status === "active" ? "录制中" : "已结束" }}</dd></div>
            <div><dt>玩家帧</dt><dd>{{ selectedSession?.frameCounts?.players ?? 0 }}</dd></div>
            <div><dt>资产帧</dt><dd>{{ selectedSession?.frameCounts?.assets ?? 0 }}</dd></div>
            <div><dt>文件大小</dt><dd>{{ formatBytes(selectedSession?.fileBytes ?? 0) }}</dd></div>
          </dl>
        </section>

        <section class="inspector-card">
          <span class="card-label">CURRENT SCENE</span>
          <dl>
            <div><dt>玩家</dt><dd>{{ displayedPlayers.length }}</dd></div>
            <div><dt>Capture Zone</dt><dd>{{ captureZoneMarkers.length }}</dd></div>
            <div><dt>FOB</dt><dd>{{ fobMarkers.length }}</dd></div>
            <div><dt>主基地</dt><dd>{{ mainZoneMarkers.length }}</dd></div>
            <div><dt>轨迹窗口</dt><dd>{{ Math.round(trailWindowMs / 1000) }} 秒</dd></div>
          </dl>
        </section>

        <section class="inspector-card legend-card">
          <span class="card-label">LEGEND</span>
          <div><i class="legend-dot team-1"></i>Team 1</div>
          <div><i class="legend-dot team-2"></i>Team 2</div>
          <div><i class="legend-dot team-0"></i>未知阵营</div>
        </section>
      </aside>
    </main>

    <footer class="replay-timeline">
      <div class="transport-controls">
        <button type="button" :disabled="!selectedSession" @click="togglePlayback">
          {{ playing ? "暂停" : "播放" }}
        </button>
        <button type="button" :disabled="!selectedSession" @click="seekBy(-10_000)">-10s</button>
        <button type="button" :disabled="!selectedSession" @click="seekBy(10_000)">+10s</button>
        <label>
          <span>速度</span>
          <select v-model.number="playbackRate">
            <option :value="0.25">0.25×</option>
            <option :value="0.5">0.5×</option>
            <option :value="1">1×</option>
            <option :value="2">2×</option>
            <option :value="4">4×</option>
          </select>
        </label>
      </div>

      <div class="timeline-track">
        <span>{{ formatClock(currentTimeMs) }}</span>
        <input
          v-model.number="currentTimeMs"
          type="range"
          min="0"
          :max="Math.max(1, durationMs)"
          step="50"
          :disabled="!selectedSession"
          @input="onTimelineInput"
          @change="void ensureWindowForTime(currentTimeMs, true)"
        />
        <span>{{ formatClock(durationMs) }}</span>
      </div>

      <div class="timeline-status" :class="{ error: Boolean(errorText) }">
        {{ errorText || loadedWindowText }}
      </div>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import {
  fetchTacticalReplayFrames,
  fetchTacticalReplaySession,
  fetchTacticalReplaySessions,
  type TacticalReplayAssetsFrame,
  type TacticalReplayFrame,
  type TacticalReplayPlayersFrame,
  type TacticalReplaySession,
} from "../app/tacticalReplayApi";
import {
  EMPTY_TACTICAL_MAP_CONFIG,
  TACTICAL_MAP_CONFIGS,
  resolveTacticalMapKey,
} from "../shared/tactical-map-data";

const REPLAY_WINDOW_BEFORE_MS = 5_000;
const REPLAY_WINDOW_AFTER_MS = 60_000;
const WINDOW_EDGE_PREFETCH_MS = 8_000;

const sessions = ref<TacticalReplaySession[]>([]);
const selectedSessionId = ref("");
const selectedSession = ref<TacticalReplaySession | null>(null);
const frames = ref<TacticalReplayFrame[]>([]);
const sessionsLoading = ref(false);
const framesLoading = ref(false);
const errorText = ref("");
const currentTimeMs = ref(0);
const playbackRate = ref(1);
const playing = ref(false);
const loadedFromMs = ref(0);
const loadedToMs = ref(0);
const trailWindowMs = ref(30_000);

let animationFrame: number | null = null;
let playbackAnchorWallMs = 0;
let playbackAnchorReplayMs = 0;
let loadGeneration = 0;
let loadTimer: number | null = null;

const durationMs = computed(() => Math.max(0, Number(selectedSession.value?.durationMs ?? 0)));
const activeMapConfig = computed(() => {
  const identity = selectedSession.value?.layer || selectedSession.value?.map || "";
  const key = resolveTacticalMapKey(identity);
  return key ? (TACTICAL_MAP_CONFIGS[key] ?? EMPTY_TACTICAL_MAP_CONFIG) : EMPTY_TACTICAL_MAP_CONFIG;
});

const playerFrames = computed(() => frames.value
  .filter((frame): frame is TacticalReplayPlayersFrame => frame.type === "players")
  .sort(compareFrames));
const assetFrames = computed(() => frames.value
  .filter((frame): frame is TacticalReplayAssetsFrame => frame.type === "assets")
  .sort(compareFrames));

const currentPlayerFrame = computed(() => findFrameAtOrBefore(playerFrames.value, currentTimeMs.value));
const nextPlayerFrame = computed(() => findFrameAfter(playerFrames.value, currentTimeMs.value));
const currentAssetFrame = computed(() => findFrameAtOrBefore(assetFrames.value, currentTimeMs.value));

const displayedPlayers = computed(() => {
  const current = currentPlayerFrame.value;
  if (!current) return [];
  const next = nextPlayerFrame.value;
  const denominator = next && next.t > current.t ? next.t - current.t : 0;
  const alpha = denominator > 0 ? clamp((currentTimeMs.value - current.t) / denominator, 0, 1) : 0;
  const nextByKey = new Map((next?.players ?? []).map((player) => [playerKey(player), player]));

  return (current.players ?? []).map((player) => {
    const key = playerKey(player);
    const nextPlayer = nextByKey.get(key);
    const currentPosition = resolvePosition(player);
    const nextPosition = resolvePosition(nextPlayer);
    const x = interpolateNumber(currentPosition?.x, nextPosition?.x, alpha);
    const y = interpolateNumber(currentPosition?.y, nextPosition?.y, alpha);
    if (x == null || y == null) return null;
    const mapPosition = projectPosition(x, y);
    if (!mapPosition) return null;

    const health = numberOrNull(player?.health, player?.soldierInfo?.health);
    const yaw = interpolateAngle(numberOrNull(player?.yaw), numberOrNull(nextPlayer?.yaw), alpha);
    const name = String(player?.playerName ?? player?.name ?? player?.identity?.name ?? "Unknown").trim() || "Unknown";
    const teamId = numberOrNull(player?.teamId, player?.match?.teamId);
    const squadId = numberOrNull(player?.squadId, player?.match?.squadId);
    const role = String(player?.role ?? player?.match?.role ?? "").trim();

    return {
      key,
      name,
      teamId,
      squadId,
      role,
      health,
      yaw,
      mapX: mapPosition.mapX,
      mapY: mapPosition.mapY,
      tooltip: [
        name,
        teamId == null ? "" : `Team ${teamId}`,
        squadId == null ? "" : `Squad ${squadId}`,
        role,
        health == null ? "" : `HP ${Math.round(health)}`,
      ].filter(Boolean).join(" · "),
    };
  }).filter(Boolean) as Array<{
    key: string;
    name: string;
    teamId: number | null;
    squadId: number | null;
    role: string;
    health: number | null;
    yaw: number | null;
    mapX: number;
    mapY: number;
    tooltip: string;
  }>;
});

const trailPaths = computed(() => {
  const startTime = Math.max(0, currentTimeMs.value - trailWindowMs.value);
  const buckets = new Map<string, { key: string; teamId: number | null; points: string[] }>();

  for (const frame of playerFrames.value) {
    if (frame.t < startTime || frame.t > currentTimeMs.value) continue;
    for (const player of frame.players ?? []) {
      const position = resolvePosition(player);
      if (!position) continue;
      const projected = projectPosition(position.x, position.y);
      if (!projected) continue;
      const key = playerKey(player);
      if (!key) continue;
      const bucket = buckets.get(key) ?? {
        key,
        teamId: numberOrNull(player?.teamId, player?.match?.teamId),
        points: [],
      };
      bucket.points.push(`${(projected.mapX * 10).toFixed(2)},${(projected.mapY * 10).toFixed(2)}`);
      buckets.set(key, bucket);
    }
  }

  return [...buckets.values()]
    .filter((bucket) => bucket.points.length >= 2)
    .map((bucket) => ({ ...bucket, points: bucket.points.join(" ") }));
});

const captureZoneMarkers = computed(() => {
  const zones = currentAssetFrame.value?.assets?.captureZones ?? [];
  return zones.map((zone, index) => {
    const position = resolvePosition(zone);
    const projected = position ? projectPosition(position.x, position.y) : null;
    if (!projected) return null;
    const teamId = numberOrNull(zone?.captureTeamId, zone?.capturingTeamId, zone?.teamId);
    const progress = clamp(numberOrNull(zone?.capturePercent, zone?.captureProgress, zone?.progress) ?? 0, 0, 100);
    const name = String(zone?.name ?? zone?.displayName ?? `Zone ${index + 1}`).trim();
    return {
      id: String(zone?.id ?? zone?.zoneId ?? `${name}:${index}`),
      name,
      teamId,
      progress,
      isCapturing: Boolean(zone?.isCapturing || Math.abs(numberOrNull(zone?.captureDirection) ?? 0) > 0),
      isLocked: Boolean(zone?.isLocked ?? zone?.locked),
      mapX: projected.mapX,
      mapY: projected.mapY,
      tooltip: `${name} · ${teamId ? `Team ${teamId}` : "Neutral"} · ${Math.round(progress)}%`,
    };
  }).filter(Boolean) as Array<any>;
});

const mainZoneMarkers = computed(() => {
  const zones = currentAssetFrame.value?.assets?.mainZones ?? [];
  return zones.map((zone, index) => {
    const position = resolvePosition(zone);
    const projected = position ? projectPosition(position.x, position.y) : null;
    if (!projected) return null;
    const teamId = numberOrNull(zone?.teamId, zone?.teamID);
    return {
      id: String(zone?.id ?? `main:${teamId ?? index}`),
      name: String(zone?.name ?? (teamId ? `MAIN T${teamId}` : `MAIN ${index + 1}`)),
      teamId,
      mapX: projected.mapX,
      mapY: projected.mapY,
    };
  }).filter(Boolean) as Array<any>;
});

const fobMarkers = computed(() => {
  const fobs = currentAssetFrame.value?.assets?.fobs ?? [];
  return fobs.map((fob, index) => {
    const position = resolvePosition(fob);
    const projected = position ? projectPosition(position.x, position.y) : null;
    if (!projected) return null;
    const teamId = numberOrNull(fob?.teamId, fob?.teamID);
    const name = String(fob?.name ?? "FOB Radio").trim() || "FOB Radio";
    const ammo = numberOrNull(fob?.ammo, fob?.ammunition);
    const construction = numberOrNull(fob?.construction, fob?.build);
    const isBleeding = Boolean(fob?.isBleeding);
    return {
      id: String(fob?.fobId ?? fob?.id ?? `${teamId ?? 0}:${index}`),
      name,
      teamId,
      ammo,
      construction,
      isBleeding,
      mapX: projected.mapX,
      mapY: projected.mapY,
      tooltip: `${name} · Team ${teamId ?? "--"} · 弹药 ${formatResource(ammo)} · 建材 ${formatResource(construction)}${isBleeding ? " · 正在流血" : ""}`,
    };
  }).filter(Boolean) as Array<any>;
});

const loadedWindowText = computed(() => {
  if (!selectedSession.value) return "未选择回放";
  return `已载入 ${formatClock(loadedFromMs.value)} – ${formatClock(loadedToMs.value)} · ${frames.value.length} 帧`;
});

onMounted(() => {
  void refreshSessions(false);
});

onBeforeUnmount(() => {
  stopPlaybackLoop();
  if (loadTimer !== null) window.clearTimeout(loadTimer);
});

watch(playbackRate, () => {
  if (!playing.value) return;
  playbackAnchorWallMs = performance.now();
  playbackAnchorReplayMs = currentTimeMs.value;
});

watch(currentTimeMs, (value) => {
  if (!playing.value) return;
  if (value >= loadedToMs.value - WINDOW_EDGE_PREFETCH_MS) {
    void ensureWindowForTime(value, false);
  }
});

async function refreshSessions(preserveSelection: boolean) {
  sessionsLoading.value = true;
  errorText.value = "";
  const previousSelection = preserveSelection ? selectedSessionId.value : "";
  try {
    const response = await fetchTacticalReplaySessions(200);
    sessions.value = Array.isArray(response?.sessions) ? response.sessions : [];
    if (previousSelection && sessions.value.some((session) => session.id === previousSelection)) {
      selectedSessionId.value = previousSelection;
      await selectSession(previousSelection);
    } else if (!selectedSessionId.value && sessions.value.length > 0) {
      selectedSessionId.value = sessions.value[0].id;
      await selectSession(selectedSessionId.value);
    }
  } catch (error: any) {
    errorText.value = error?.message ?? "无法读取战术回放记录。";
  } finally {
    sessionsLoading.value = false;
  }
}

async function selectSession(sessionId: string) {
  stopPlaybackLoop();
  selectedSession.value = null;
  frames.value = [];
  currentTimeMs.value = 0;
  loadedFromMs.value = 0;
  loadedToMs.value = 0;
  errorText.value = "";
  if (!sessionId) return;

  framesLoading.value = true;
  const generation = ++loadGeneration;
  try {
    const response = await fetchTacticalReplaySession(sessionId);
    if (generation !== loadGeneration) return;
    selectedSession.value = response.session;
    const listItem = sessions.value.find((session) => session.id === response.session.id);
    if (listItem) Object.assign(listItem, response.session);
    await ensureWindowForTime(0, true);
  } catch (error: any) {
    if (generation === loadGeneration) errorText.value = error?.message ?? "无法读取回放元数据。";
  } finally {
    if (generation === loadGeneration) framesLoading.value = false;
  }
}

async function ensureWindowForTime(targetMs: number, force: boolean) {
  const session = selectedSession.value;
  if (!session) return;
  const target = clamp(targetMs, 0, Math.max(durationMs.value, targetMs));
  if (!force && frames.value.length > 0 && target >= loadedFromMs.value + 1_000 && target <= loadedToMs.value - WINDOW_EDGE_PREFETCH_MS) {
    return;
  }

  const fromMs = Math.max(0, target - REPLAY_WINDOW_BEFORE_MS);
  const toMs = Math.max(fromMs, Math.min(Math.max(durationMs.value, target + REPLAY_WINDOW_AFTER_MS), target + REPLAY_WINDOW_AFTER_MS));
  const generation = ++loadGeneration;
  framesLoading.value = true;
  errorText.value = "";

  try {
    const response = await fetchTacticalReplayFrames(session.id, {
      fromMs,
      toMs,
      limit: 25_000,
      includeContext: true,
    });
    if (generation !== loadGeneration) return;
    frames.value = dedupeFrames(response.frames ?? []);
    loadedFromMs.value = fromMs;
    loadedToMs.value = response.toMs ?? toMs;
    if (response.session) {
      selectedSession.value = response.session;
      const listItem = sessions.value.find((item) => item.id === response.session.id);
      if (listItem) Object.assign(listItem, response.session);
    }
  } catch (error: any) {
    if (generation === loadGeneration) errorText.value = error?.message ?? "无法读取回放帧。";
  } finally {
    if (generation === loadGeneration) framesLoading.value = false;
  }
}

function togglePlayback() {
  if (!selectedSession.value) return;
  if (playing.value) {
    stopPlaybackLoop();
    return;
  }
  if (currentTimeMs.value >= durationMs.value && durationMs.value > 0) currentTimeMs.value = 0;
  playing.value = true;
  playbackAnchorWallMs = performance.now();
  playbackAnchorReplayMs = currentTimeMs.value;
  runPlaybackFrame();
}

function runPlaybackFrame() {
  if (!playing.value) return;
  const elapsed = (performance.now() - playbackAnchorWallMs) * playbackRate.value;
  const nextTime = playbackAnchorReplayMs + elapsed;
  const end = durationMs.value;
  currentTimeMs.value = end > 0 ? Math.min(end, nextTime) : nextTime;

  if (end > 0 && currentTimeMs.value >= end) {
    stopPlaybackLoop();
    return;
  }
  animationFrame = requestAnimationFrame(runPlaybackFrame);
}

function stopPlaybackLoop() {
  playing.value = false;
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
}

function seekBy(deltaMs: number) {
  if (!selectedSession.value) return;
  currentTimeMs.value = clamp(currentTimeMs.value + deltaMs, 0, durationMs.value);
  playbackAnchorWallMs = performance.now();
  playbackAnchorReplayMs = currentTimeMs.value;
  void ensureWindowForTime(currentTimeMs.value, false);
}

function onTimelineInput() {
  playbackAnchorWallMs = performance.now();
  playbackAnchorReplayMs = currentTimeMs.value;
  if (loadTimer !== null) window.clearTimeout(loadTimer);
  loadTimer = window.setTimeout(() => {
    loadTimer = null;
    void ensureWindowForTime(currentTimeMs.value, false);
  }, 120);
}

function projectPosition(x: number, y: number) {
  const bounds = activeMapConfig.value.bounds;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    mapX: project(x, bounds.minX, bounds.maxX),
    mapY: project(y, bounds.minY, bounds.maxY),
  };
}

function resolvePosition(source: any): { x: number; y: number } | null {
  if (!source) return null;
  const position = source?.position
    ?? source?.telemetry?.position
    ?? source?.soldierInfo?.position
    ?? source?.vehicleInfo?.position;
  const x = Number(position?.x ?? source?.x);
  const y = Number(position?.y ?? source?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function playerKey(player: any) {
  return String(
    player?.key
    ?? player?.identity?.key
    ?? player?.playerId
    ?? player?.playerIndex
    ?? player?.playerGuid
    ?? player?.playerName
    ?? player?.name
    ?? "",
  );
}

function findFrameAtOrBefore<T extends TacticalReplayFrame>(source: T[], timeMs: number): T | null {
  let low = 0;
  let high = source.length - 1;
  let result: T | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const frame = source[middle];
    if (frame.t <= timeMs) {
      result = frame;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}

function findFrameAfter<T extends TacticalReplayFrame>(source: T[], timeMs: number): T | null {
  let low = 0;
  let high = source.length - 1;
  let result: T | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const frame = source[middle];
    if (frame.t > timeMs) {
      result = frame;
      high = middle - 1;
    } else {
      low = middle + 1;
    }
  }
  return result;
}

function dedupeFrames(source: TacticalReplayFrame[]) {
  const map = new Map<string, TacticalReplayFrame>();
  for (const frame of source) map.set(`${frame.type}:${frame.seq}`, frame);
  return [...map.values()].sort(compareFrames);
}

function compareFrames(left: TacticalReplayFrame, right: TacticalReplayFrame) {
  return left.t - right.t || left.seq - right.seq;
}

function markerStyle(mapX: number, mapY: number) {
  return { left: `${mapX}%`, top: `${mapY}%` };
}

function teamClass(teamId: number | null | undefined) {
  const normalized = Number(teamId);
  return normalized === 1 ? "team-1" : normalized === 2 ? "team-2" : "team-0";
}

function interpolateNumber(current: unknown, next: unknown, alpha: number): number | null {
  const from = Number(current);
  const to = Number(next);
  if (!Number.isFinite(from)) return Number.isFinite(to) ? to : null;
  if (!Number.isFinite(to)) return from;
  return from + (to - from) * alpha;
}

function interpolateAngle(current: number | null, next: number | null, alpha: number) {
  if (current == null) return next;
  if (next == null) return current;
  let delta = ((next - current + 540) % 360) - 180;
  if (!Number.isFinite(delta)) delta = 0;
  return current + delta * alpha;
}

function project(value: number, minimum: number, maximum: number) {
  const span = maximum - minimum;
  if (!Number.isFinite(span) || span === 0) return 50;
  return clamp(((value - minimum) / span) * 100, 0, 100);
}

function numberOrNull(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function formatSessionOption(session: TacticalReplaySession) {
  const date = formatTimestamp(session.startedAt);
  const map = session.layer || session.map || "Unknown";
  const status = session.status === "active" ? "录制中" : formatClock(session.durationMs);
  return `${date} · ${map} · ${status}`;
}

function formatClock(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "--";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatBytes(value: number) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatResource(value: number | null | undefined) {
  return value == null ? "--" : Math.max(0, Math.round(value)).toLocaleString();
}

function formatHealth(value: number | null | undefined) {
  return value == null ? "HP --" : `HP ${Math.max(0, Math.round(value))}`;
}
</script>

<style scoped>
.tactical-replay-page {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  color: #e8f1f8;
  background:
    radial-gradient(circle at 12% 8%, rgba(29, 142, 184, 0.14), transparent 34%),
    radial-gradient(circle at 88% 92%, rgba(181, 55, 76, 0.12), transparent 36%),
    #050a10;
  overflow: hidden;
}

.replay-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(148, 184, 207, 0.18);
  background: rgba(5, 12, 20, 0.92);
}

.replay-title-block h1 {
  margin: 2px 0 0;
  font-size: 22px;
  letter-spacing: 0.04em;
}

.replay-title-block p {
  margin: 3px 0 0;
  color: #8297a7;
  font-size: 12px;
}

.replay-kicker,
.card-label {
  color: #51d7ff;
  font-family: "Cascadia Mono", Consolas, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.18em;
}

.replay-session-controls {
  display: flex;
  align-items: end;
  justify-content: flex-end;
  gap: 10px;
  min-width: 0;
}

.replay-session-controls label,
.transport-controls label {
  display: grid;
  gap: 4px;
  color: #8da1b1;
  font-size: 11px;
}

select,
button,
.live-map-link {
  min-height: 34px;
  border: 1px solid rgba(112, 153, 180, 0.28);
  border-radius: 4px;
  color: #dbe9f2;
  background: rgba(14, 27, 39, 0.92);
  font: inherit;
}

select {
  min-width: 280px;
  padding: 0 10px;
}

button,
.live-map-link {
  padding: 0 12px;
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

button:hover:not(:disabled),
.live-map-link:hover {
  border-color: rgba(81, 215, 255, 0.65);
  background: rgba(25, 50, 68, 0.95);
}

button:disabled,
select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.replay-workspace {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
}

.map-stage {
  min-width: 0;
  min-height: 0;
  display: grid;
  place-items: center;
  padding: 10px;
  overflow: hidden;
}

.map-canvas {
  position: relative;
  width: min(100%, calc(100vh - 220px));
  max-height: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  border: 1px solid rgba(138, 178, 204, 0.2);
  background: #08111a;
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.42);
}

.map-background,
.map-background-placeholder,
.map-grid,
.player-trail-layer,
.asset-layer,
.player-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.map-background {
  object-fit: fill;
  user-select: none;
  filter: saturate(0.88) brightness(0.72) contrast(1.08);
}

.map-background-placeholder {
  display: grid;
  place-content: center;
  gap: 8px;
  text-align: center;
  color: #6f8392;
  background: linear-gradient(135deg, #09131d, #050a10);
}

.map-grid {
  pointer-events: none;
  opacity: 0.25;
  background-image:
    linear-gradient(rgba(118, 169, 199, 0.14) 1px, transparent 1px),
    linear-gradient(90deg, rgba(118, 169, 199, 0.14) 1px, transparent 1px);
  background-size: 10% 10%;
}

.player-trail-layer,
.asset-layer,
.player-layer {
  pointer-events: none;
}

.player-trail {
  fill: none;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.32;
}

.player-trail.team-1 { stroke: #4bc5ff; }
.player-trail.team-2 { stroke: #ff6177; }
.player-trail.team-0 { stroke: #a1afba; }

.asset-marker,
.player-marker {
  position: absolute;
  transform: translate(-50%, -50%);
}

.main-zone-marker,
.capture-zone-marker,
.fob-marker {
  display: grid;
  justify-items: center;
  gap: 2px;
  white-space: nowrap;
  text-shadow: 0 1px 4px #000, 0 0 8px #000;
}

.asset-marker strong {
  padding: 1px 4px;
  border-radius: 2px;
  color: #f2f7fa;
  background: rgba(3, 8, 13, 0.72);
  font-size: 9px;
}

.main-zone-icon {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: 2px solid currentColor;
  background: rgba(3, 8, 13, 0.8);
  transform: rotate(45deg);
}

.main-zone-icon::first-letter { transform: rotate(-45deg); }

.capture-zone-ring {
  width: 24px;
  height: 24px;
  border: 3px solid currentColor;
  border-radius: 50%;
  background: rgba(3, 8, 13, 0.48);
  box-shadow: 0 0 0 2px rgba(3, 8, 13, 0.75), 0 0 12px currentColor;
}

.capture-zone-marker.is-capturing .capture-zone-ring {
  animation: capturePulse 1.1s ease-in-out infinite;
}

.capture-zone-marker.is-locked .capture-zone-ring {
  border-style: double;
  filter: grayscale(0.55);
}

.fob-icon {
  position: relative;
  display: grid;
  place-items: center;
  width: 24px;
  height: 19px;
  border: 2px solid currentColor;
  border-top-width: 6px;
  background: rgba(3, 8, 13, 0.78);
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.7);
}

.fob-marker small {
  padding: 1px 4px;
  color: #c8d5de;
  background: rgba(3, 8, 13, 0.72);
  font-size: 8px;
}

.fob-marker.is-bleeding .fob-icon {
  color: #ff334f;
  animation: capturePulse 0.75s ease-in-out infinite;
}

.player-marker {
  z-index: 20;
  width: 16px;
  height: 16px;
  color: #aab8c2;
}

.player-dot {
  position: absolute;
  inset: 4px;
  border: 1px solid rgba(255, 255, 255, 0.9);
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 8px currentColor, 0 1px 3px #000;
}

.player-direction {
  position: absolute;
  left: 5px;
  top: -5px;
  width: 0;
  height: 0;
  border-left: 3px solid transparent;
  border-right: 3px solid transparent;
  border-bottom: 8px solid currentColor;
  transform-origin: 3px 13px;
}

.player-label {
  position: absolute;
  left: 13px;
  top: 4px;
  display: grid;
  min-width: max-content;
  padding: 2px 4px;
  border-left: 2px solid currentColor;
  color: #f0f6fa;
  background: rgba(3, 8, 13, 0.72);
  text-shadow: 0 1px 3px #000;
}

.player-label strong { font-size: 8px; line-height: 1.1; }
.player-label small { color: #aebdc8; font-size: 7px; }
.player-marker.is-dead { opacity: 0.38; filter: grayscale(1); }

.team-1 { color: #43c6ff; }
.team-2 { color: #ff5a72; }
.team-0 { color: #a8b5bf; }

.map-timecode {
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 50;
  display: grid;
  gap: 1px;
  padding: 7px 9px;
  border-left: 3px solid #51d7ff;
  background: rgba(3, 8, 13, 0.84);
  font-family: "Cascadia Mono", Consolas, monospace;
}

.map-timecode span { font-size: 17px; font-weight: 800; }
.map-timecode small { color: #8ea2b0; font-size: 9px; }

.map-loading-mask {
  position: absolute;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  color: #ccefff;
  background: rgba(2, 7, 12, 0.42);
  backdrop-filter: blur(2px);
}

.empty-state {
  display: grid;
  justify-items: center;
  gap: 8px;
  color: #728593;
  text-align: center;
}

.empty-state strong { color: #d4e2eb; font-size: 20px; }

.replay-inspector {
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  border-left: 1px solid rgba(148, 184, 207, 0.15);
  background: rgba(5, 12, 20, 0.72);
}

.inspector-card {
  margin-bottom: 10px;
  padding: 12px;
  border: 1px solid rgba(119, 157, 181, 0.18);
  background: rgba(12, 23, 33, 0.76);
}

.inspector-card h2 {
  margin: 6px 0 12px;
  color: #edf6fb;
  font-size: 16px;
  overflow-wrap: anywhere;
}

.inspector-card dl {
  display: grid;
  gap: 6px;
  margin: 0;
}

.inspector-card dl > div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 5px;
  border-bottom: 1px solid rgba(126, 159, 180, 0.09);
  font-size: 11px;
}

.inspector-card dt { color: #8498a7; }
.inspector-card dd { margin: 0; color: #d4e2ea; text-align: right; }

.legend-card {
  display: grid;
  gap: 8px;
  font-size: 11px;
}

.legend-card > div {
  display: flex;
  align-items: center;
  gap: 8px;
}

.legend-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 7px currentColor;
}

.replay-timeline {
  display: grid;
  grid-template-columns: auto minmax(260px, 1fr) minmax(180px, auto);
  align-items: center;
  gap: 16px;
  padding: 10px 14px;
  border-top: 1px solid rgba(148, 184, 207, 0.18);
  background: rgba(5, 12, 20, 0.96);
}

.transport-controls,
.timeline-track {
  display: flex;
  align-items: center;
  gap: 8px;
}

.transport-controls select { min-width: 78px; }
.timeline-track span {
  min-width: 46px;
  color: #a9bac5;
  font-family: "Cascadia Mono", Consolas, monospace;
  font-size: 11px;
}
.timeline-track span:last-child { text-align: right; }
.timeline-track input { width: 100%; accent-color: #51d7ff; }

.timeline-status {
  color: #7f94a3;
  font-size: 10px;
  text-align: right;
}
.timeline-status.error { color: #ff788b; }

@keyframes capturePulse {
  0%, 100% { transform: scale(1); opacity: 0.85; }
  50% { transform: scale(1.13); opacity: 1; }
}

@media (max-width: 1080px) {
  .replay-header { align-items: flex-start; flex-direction: column; }
  .replay-session-controls { width: 100%; justify-content: flex-start; flex-wrap: wrap; }
  .replay-session-controls label { flex: 1; }
  .replay-session-controls select { width: 100%; min-width: 220px; }
  .replay-workspace { grid-template-columns: minmax(0, 1fr); }
  .replay-inspector { display: none; }
  .map-canvas { width: min(100%, calc(100vh - 280px)); }
  .replay-timeline { grid-template-columns: 1fr; gap: 8px; }
  .timeline-status { text-align: left; }
}
</style>
