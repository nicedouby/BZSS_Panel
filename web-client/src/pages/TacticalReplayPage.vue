<template>
  <div class="tactical-replay-page">
    <header class="replay-header">
      <div>
        <span class="eyebrow">TACTICAL REPLAY</span>
        <h1>战术地图回放</h1>
        <p>玩家真值帧 0.33 秒 · Capture Zone / FOB / 主基地关键帧 5 秒</p>
      </div>

      <div class="session-controls">
        <label>
          <span>对局记录</span>
          <select v-model="selectedSessionId" :disabled="sessionsLoading" @change="selectSession(selectedSessionId)">
            <option value="">请选择一局</option>
            <option v-for="session in sessions" :key="session.id" :value="session.id">
              {{ formatSessionOption(session) }}
            </option>
          </select>
        </label>
        <button type="button" :disabled="sessionsLoading" @click="refreshSessions(true)">
          {{ sessionsLoading ? "刷新中" : "刷新记录" }}
        </button>
        <RouterLink class="button-link" to="/tactical-map">返回实时地图</RouterLink>
      </div>
    </header>

    <main class="workspace">
      <section class="map-stage">
        <div v-if="!selectedSession" class="empty-state">
          <strong>选择一局对局记录</strong>
          <span>播放器会合并当前玩家帧与该时间点之前最近的资产关键帧。</span>
        </div>

        <div v-else class="map-canvas">
          <img
            v-if="activeMapConfig.image"
            class="map-background"
            :src="activeMapConfig.image"
            :alt="selectedSession.layer || selectedSession.map || 'Tactical map'"
            draggable="false"
          />
          <div v-else class="map-placeholder">
            <strong>{{ selectedSession.layer || selectedSession.map || "未知地图" }}</strong>
            <span>当前图层尚未配置地图图片</span>
          </div>
          <div class="map-grid" aria-hidden="true"></div>

          <svg class="trail-layer" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
            <polyline
              v-for="trail in trailPaths"
              :key="trail.key"
              :points="trail.points"
              class="player-trail"
              :class="teamClass(trail.teamId)"
              vector-effect="non-scaling-stroke"
            />
          </svg>

          <div class="marker-layer">
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

            <div
              v-for="zone in captureZoneMarkers"
              :key="zone.id"
              class="asset-marker capture-zone-marker"
              :class="[
                teamClass(zone.teamId),
                { 'is-capturing': zone.isCapturing, 'is-locked': zone.isLocked },
              ]"
              :style="markerStyle(zone.mapX, zone.mapY)"
              :title="zone.tooltip"
            >
              <span class="capture-ring">
                <i :style="{ height: `${zone.captureProgress}%` }"></i>
              </span>
              <strong>{{ zone.name }}</strong>
            </div>

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

          <div class="marker-layer player-layer">
            <div
              v-for="player in displayedPlayers"
              :key="player.key"
              class="player-marker"
              :class="[
                teamClass(player.teamId),
                { 'is-dead': player.health != null && player.health <= 0 },
              ]"
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

          <div class="timecode">
            <strong>{{ formatClock(currentTimeMs) }}</strong>
            <small>{{ currentPlayerFrame?.at ? formatTimestamp(currentPlayerFrame.at) : "--" }}</small>
          </div>
          <div v-if="framesLoading" class="loading-mask">读取回放帧…</div>
        </div>
      </section>

      <aside class="inspector">
        <section class="inspector-card">
          <span class="eyebrow">SESSION</span>
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
          <span class="eyebrow">CURRENT SCENE</span>
          <dl>
            <div><dt>玩家</dt><dd>{{ displayedPlayers.length }}</dd></div>
            <div><dt>Capture Zone</dt><dd>{{ captureZoneMarkers.length }}</dd></div>
            <div><dt>FOB</dt><dd>{{ fobMarkers.length }}</dd></div>
            <div><dt>主基地</dt><dd>{{ mainZoneMarkers.length }}</dd></div>
            <div><dt>轨迹窗口</dt><dd>{{ Math.round(trailWindowMs / 1000) }} 秒</dd></div>
          </dl>
        </section>

        <section class="inspector-card legend">
          <span class="eyebrow">LEGEND</span>
          <div><i class="team-1"></i>Team 1</div>
          <div><i class="team-2"></i>Team 2</div>
          <div><i class="team-0"></i>未知阵营</div>
        </section>
      </aside>
    </main>

    <footer class="timeline">
      <div class="transport">
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
          @change="ensureWindowForTime(currentTimeMs, true)"
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
  getStaticTacticalAssets,
  resolveTacticalMapKey,
} from "../shared/tactical-map-data";

const REPLAY_WINDOW_BEFORE_MS = 5_000;
const REPLAY_WINDOW_AFTER_MS = 60_000;
const WINDOW_EDGE_PREFETCH_MS = 8_000;

interface ProjectedMarker {
  mapX: number;
  mapY: number;
}

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

const activeMapKey = computed(() => resolveTacticalMapKey(
  selectedSession.value?.layer || selectedSession.value?.map || "",
));
const activeMapConfig = computed(() => (
  activeMapKey.value
    ? (TACTICAL_MAP_CONFIGS[activeMapKey.value] ?? EMPTY_TACTICAL_MAP_CONFIG)
    : EMPTY_TACTICAL_MAP_CONFIG
));
const staticAssets = computed(() => getStaticTacticalAssets(activeMapKey.value));

const orderedFrames = computed(() => [...frames.value].sort(compareFrames));
const playerFrames = computed(() => orderedFrames.value.filter(
  (frame): frame is TacticalReplayPlayersFrame => frame.type === "players",
));
const assetFrames = computed(() => orderedFrames.value.filter(
  (frame): frame is TacticalReplayAssetsFrame => frame.type === "assets",
));
const latestLoadedTimeMs = computed(() => orderedFrames.value.at(-1)?.t ?? 0);
const durationMs = computed(() => Math.max(
  0,
  Number(selectedSession.value?.durationMs ?? 0),
  latestLoadedTimeMs.value,
));

const currentPlayerFrame = computed(() => findFrameAtOrBefore(playerFrames.value, currentTimeMs.value));
const nextPlayerFrame = computed(() => findFrameAfter(playerFrames.value, currentTimeMs.value));
const currentAssetFrame = computed(() => findFrameAtOrBefore(assetFrames.value, currentTimeMs.value));

const displayedPlayers = computed(() => {
  const current = currentPlayerFrame.value;
  if (!current) return [];
  const next = nextPlayerFrame.value;
  const denominator = next && next.t > current.t ? next.t - current.t : 0;
  const alpha = denominator > 0
    ? clamp((currentTimeMs.value - current.t) / denominator, 0, 1)
    : 0;
  const nextByKey = new Map<string, any>();
  for (const player of next?.players ?? []) nextByKey.set(playerKey(player), player);

  return (current.players ?? []).map((player) => {
    const key = playerKey(player);
    const nextPlayer = nextByKey.get(key);
    const currentPosition = resolvePosition(player);
    const nextPosition = resolvePosition(nextPlayer);
    const x = interpolateNumber(currentPosition?.x, nextPosition?.x, alpha);
    const y = interpolateNumber(currentPosition?.y, nextPosition?.y, alpha);
    if (x == null || y == null) return null;
    const projected = projectPosition(x, y);
    if (!projected) return null;

    const health = numberOrNull(
      player?.health,
      player?.telemetry?.health,
      player?.soldierInfo?.health,
    );
    const yaw = interpolateAngle(
      numberOrNull(player?.yaw, player?.telemetry?.yaw),
      numberOrNull(nextPlayer?.yaw, nextPlayer?.telemetry?.yaw),
      alpha,
    );
    const name = String(
      player?.playerName
      ?? player?.name
      ?? player?.identity?.name
      ?? "Unknown",
    ).trim() || "Unknown";
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
      ...projected,
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
  const runtimeZones = currentAssetFrame.value?.assets?.captureZones ?? [];
  const staticZones = Array.isArray(staticAssets.value?.captureZones)
    ? staticAssets.value.captureZones
    : [];
  const merged = new Map<string, any>();

  for (const [index, zone] of staticZones.entries()) {
    const name = String(zone?.name ?? `Zone ${index + 1}`).trim();
    merged.set(name, {
      ...zone,
      name,
      position: resolvePosition(zone) ?? positionFromXY(zone),
    });
  }
  for (const [index, zone] of runtimeZones.entries()) {
    const name = String(zone?.name ?? zone?.displayName ?? `Zone ${index + 1}`).trim();
    const fallback = merged.get(name) ?? {};
    merged.set(name, {
      ...fallback,
      ...zone,
      name,
      position: resolvePosition(zone) ?? resolvePosition(fallback) ?? positionFromXY(fallback),
    });
  }

  return [...merged.values()].map((zone, index) => {
    const position = resolvePosition(zone);
    if (!position) return null;
    const projected = projectPosition(position.x, position.y);
    if (!projected) return null;

    const ownerTeamId = normalizeTeamId(
      zone?.teamId
      ?? zone?.ownerTeamId
      ?? zone?.owner
      ?? zone?.captureDirection,
    );
    const rawProgress = numberOrNull(
      zone?.capturePercent,
      zone?.captureProgress,
      zone?.progress,
    );
    const captureProgress = rawProgress == null
      ? 100
      : clamp(rawProgress >= 0 && rawProgress <= 1 ? rawProgress * 100 : rawProgress, 0, 100);
    const captureTeamId = normalizeTeamId(
      zone?.captureTeamId
      ?? zone?.capturingTeamId
      ?? zone?.captureTeam
      ?? zone?.captureDirection,
    );
    const isCapturing = Boolean(
      captureTeamId
      && captureProgress > 0
      && captureProgress < 100
      && (zone?.isCapturing ?? zone?.capturing ?? true),
    );
    const name = String(zone?.name ?? `Zone ${index + 1}`).trim();

    return {
      id: String(zone?.id ?? zone?.zoneId ?? `capture:${name}`),
      name,
      teamId: ownerTeamId,
      captureTeamId,
      captureProgress,
      isCapturing,
      isLocked: Boolean(zone?.isLocked ?? zone?.locked),
      ...projected,
      tooltip: [
        name,
        ownerTeamId ? `归属 Team ${ownerTeamId}` : "中立",
        isCapturing ? `Team ${captureTeamId} 占领中` : "",
        `${Math.round(captureProgress)}%`,
      ].filter(Boolean).join(" · "),
    };
  }).filter(Boolean) as Array<any>;
});

const mainZoneMarkers = computed(() => {
  const runtimeZones = currentAssetFrame.value?.assets?.mainZones ?? [];
  const source = runtimeZones.length > 0
    ? runtimeZones
    : (Array.isArray(staticAssets.value?.mainZones) ? staticAssets.value.mainZones : []);

  return source.map((zone, index) => {
    const position = resolvePosition(zone) ?? positionFromXY(zone);
    if (!position) return null;
    const projected = projectPosition(position.x, position.y);
    if (!projected) return null;
    const teamId = normalizeTeamId(zone?.teamId ?? zone?.teamID ?? zone?.team);
    return {
      id: String(zone?.id ?? `main:${teamId ?? index}`),
      name: String(zone?.name ?? (teamId ? `MAIN T${teamId}` : `MAIN ${index + 1}`)),
      teamId,
      ...projected,
    };
  }).filter(Boolean) as Array<any>;
});

const fobMarkers = computed(() => {
  const fobs = currentAssetFrame.value?.assets?.fobs ?? [];
  return fobs.map((fob, index) => {
    const position = resolvePosition(fob) ?? positionFromXY(fob);
    if (!position) return null;
    const projected = projectPosition(position.x, position.y);
    if (!projected) return null;
    const teamId = normalizeTeamId(fob?.teamId ?? fob?.teamID);
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
      ...projected,
      tooltip: [
        name,
        `Team ${teamId ?? "--"}`,
        `弹药 ${formatResource(ammo)}`,
        `建材 ${formatResource(construction)}`,
        isBleeding ? "正在流血" : "",
      ].filter(Boolean).join(" · "),
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
  resetPlaybackAnchor();
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
    updateSessionListItem(response.session);
    await ensureWindowForTime(0, true);
  } catch (error: any) {
    if (generation === loadGeneration) {
      errorText.value = error?.message ?? "无法读取回放元数据。";
    }
  } finally {
    if (generation === loadGeneration) framesLoading.value = false;
  }
}

async function ensureWindowForTime(targetMs: number, force: boolean) {
  const session = selectedSession.value;
  if (!session) return;
  const target = clamp(targetMs, 0, Math.max(durationMs.value, targetMs));
  const insideLoadedWindow = frames.value.length > 0
    && target >= loadedFromMs.value + 1_000
    && target <= loadedToMs.value - WINDOW_EDGE_PREFETCH_MS;
  if (!force && insideLoadedWindow) return;

  const fromMs = Math.max(0, target - REPLAY_WINDOW_BEFORE_MS);
  const desiredToMs = target + REPLAY_WINDOW_AFTER_MS;
  const toMs = session.status === "active"
    ? desiredToMs
    : Math.max(fromMs, Math.min(durationMs.value, desiredToMs));
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
      updateSessionListItem(response.session);
    }
  } catch (error: any) {
    if (generation === loadGeneration) {
      errorText.value = error?.message ?? "无法读取回放帧。";
    }
  } finally {
    if (generation === loadGeneration) framesLoading.value = false;
  }
}

function updateSessionListItem(session: TacticalReplaySession) {
  const existing = sessions.value.find((item) => item.id === session.id);
  if (existing) Object.assign(existing, session);
}

function togglePlayback() {
  if (!selectedSession.value) return;
  if (playing.value) {
    stopPlaybackLoop();
    return;
  }
  if (durationMs.value > 0 && currentTimeMs.value >= durationMs.value) {
    currentTimeMs.value = 0;
  }
  playing.value = true;
  resetPlaybackAnchor();
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

function resetPlaybackAnchor() {
  playbackAnchorWallMs = performance.now();
  playbackAnchorReplayMs = currentTimeMs.value;
}

function seekBy(deltaMs: number) {
  if (!selectedSession.value) return;
  currentTimeMs.value = clamp(currentTimeMs.value + deltaMs, 0, durationMs.value);
  resetPlaybackAnchor();
  void ensureWindowForTime(currentTimeMs.value, false);
}

function onTimelineInput() {
  resetPlaybackAnchor();
  if (loadTimer !== null) window.clearTimeout(loadTimer);
  loadTimer = window.setTimeout(() => {
    loadTimer = null;
    void ensureWindowForTime(currentTimeMs.value, false);
  }, 120);
}

function projectPosition(x: number, y: number): ProjectedMarker | null {
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
  const x = Number(position?.x);
  const y = Number(position?.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function positionFromXY(source: any): { x: number; y: number } | null {
  const x = Number(source?.x ?? source?.gameX);
  const y = Number(source?.y ?? source?.gameY);
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
  const unique = new Map<string, TacticalReplayFrame>();
  for (const frame of source) unique.set(`${frame.type}:${frame.seq}`, frame);
  return [...unique.values()].sort(compareFrames);
}

function compareFrames(left: TacticalReplayFrame, right: TacticalReplayFrame) {
  return left.t - right.t || left.seq - right.seq;
}

function normalizeTeamId(value: unknown): number | null {
  const numeric = Number(value);
  return numeric === 1 || numeric === 2 ? numeric : null;
}

function markerStyle(mapX: number, mapY: number) {
  return { left: `${mapX}%`, top: `${mapY}%` };
}

function teamClass(teamId: number | null | undefined) {
  return teamId === 1 ? "team-1" : teamId === 2 ? "team-2" : "team-0";
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
  overflow: hidden;
  color: #e7f0f6;
  background:
    radial-gradient(circle at 12% 8%, rgba(42, 178, 221, 0.12), transparent 34%),
    radial-gradient(circle at 88% 92%, rgba(204, 57, 82, 0.1), transparent 36%),
    #050a10;
}

.replay-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 22px;
  padding: 13px 17px;
  border-bottom: 1px solid rgba(143, 180, 204, 0.17);
  background: rgba(5, 12, 20, 0.94);
}

.replay-header h1 {
  margin: 2px 0 0;
  font-size: 22px;
  letter-spacing: 0.04em;
}

.replay-header p {
  margin: 3px 0 0;
  color: #8195a4;
  font-size: 12px;
}

.eyebrow {
  color: #51d7ff;
  font-family: "Cascadia Mono", Consolas, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.17em;
}

.session-controls,
.transport,
.timeline-track {
  display: flex;
  align-items: center;
  gap: 8px;
}

.session-controls { align-items: end; }
.session-controls label,
.transport label {
  display: grid;
  gap: 4px;
  color: #8da1b0;
  font-size: 11px;
}

select,
button,
.button-link {
  min-height: 34px;
  border: 1px solid rgba(112, 153, 180, 0.28);
  border-radius: 4px;
  color: #dbe9f2;
  background: rgba(14, 27, 39, 0.94);
  font: inherit;
}

select { min-width: 280px; padding: 0 10px; }
button,
.button-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  cursor: pointer;
  text-decoration: none;
}
button:hover:not(:disabled),
.button-link:hover {
  border-color: rgba(81, 215, 255, 0.65);
  background: rgba(25, 50, 68, 0.96);
}
button:disabled,
select:disabled { opacity: 0.5; cursor: not-allowed; }

.workspace {
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
  width: min(100%, calc(100vh - 218px));
  max-height: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  border: 1px solid rgba(138, 178, 204, 0.2);
  background: #08111a;
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.42);
}

.map-background,
.map-placeholder,
.map-grid,
.trail-layer,
.marker-layer {
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

.map-placeholder {
  display: grid;
  place-content: center;
  gap: 8px;
  text-align: center;
  color: #708492;
  background: linear-gradient(135deg, #09131d, #050a10);
}

.map-grid {
  pointer-events: none;
  opacity: 0.24;
  background-image:
    linear-gradient(rgba(118, 169, 199, 0.14) 1px, transparent 1px),
    linear-gradient(90deg, rgba(118, 169, 199, 0.14) 1px, transparent 1px);
  background-size: 10% 10%;
}

.trail-layer,
.marker-layer { pointer-events: none; }
.player-trail {
  fill: none;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0.34;
}
.player-trail.team-1 { stroke: #43c6ff; }
.player-trail.team-2 { stroke: #ff5a72; }
.player-trail.team-0 { stroke: #a8b5bf; }

.asset-marker,
.player-marker {
  position: absolute;
  transform: translate(-50%, -50%);
}

.asset-marker {
  display: grid;
  justify-items: center;
  gap: 2px;
  white-space: nowrap;
  text-shadow: 0 1px 4px #000, 0 0 8px #000;
}
.asset-marker strong,
.fob-marker small {
  padding: 1px 4px;
  border-radius: 2px;
  background: rgba(3, 8, 13, 0.74);
}
.asset-marker strong { color: #f2f7fa; font-size: 9px; }
.fob-marker small { color: #c8d5de; font-size: 8px; }

.main-zone-icon {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: 2px solid currentColor;
  background: rgba(3, 8, 13, 0.82);
  transform: rotate(45deg);
}

.capture-ring {
  position: relative;
  width: 24px;
  height: 24px;
  overflow: hidden;
  border: 3px solid currentColor;
  border-radius: 50%;
  background: rgba(3, 8, 13, 0.56);
  box-shadow: 0 0 0 2px rgba(3, 8, 13, 0.75), 0 0 12px currentColor;
}
.capture-ring i {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: currentColor;
  opacity: 0.45;
}
.capture-zone-marker.is-capturing .capture-ring { animation: pulse 1.1s ease-in-out infinite; }
.capture-zone-marker.is-locked .capture-ring { border-style: double; filter: grayscale(0.55); }

.fob-icon {
  display: grid;
  place-items: center;
  width: 24px;
  height: 19px;
  border: 2px solid currentColor;
  border-top-width: 6px;
  background: rgba(3, 8, 13, 0.8);
  box-shadow: 0 0 12px rgba(0, 0, 0, 0.7);
}
.fob-marker.is-bleeding .fob-icon { color: #ff334f; animation: pulse 0.75s ease-in-out infinite; }

.player-layer { z-index: 20; }
.player-marker {
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
  background: rgba(3, 8, 13, 0.74);
  text-shadow: 0 1px 3px #000;
}
.player-label strong { font-size: 8px; line-height: 1.1; }
.player-label small { color: #aebdc8; font-size: 7px; }
.player-marker.is-dead { opacity: 0.38; filter: grayscale(1); }

.team-1 { color: #43c6ff; }
.team-2 { color: #ff5a72; }
.team-0 { color: #a8b5bf; }

.timecode {
  position: absolute;
  left: 10px;
  bottom: 10px;
  z-index: 50;
  display: grid;
  gap: 1px;
  padding: 7px 9px;
  border-left: 3px solid #51d7ff;
  background: rgba(3, 8, 13, 0.86);
  font-family: "Cascadia Mono", Consolas, monospace;
}
.timecode strong { font-size: 17px; }
.timecode small { color: #8ea2b0; font-size: 9px; }
.loading-mask {
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

.inspector {
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
.inspector-card dl { display: grid; gap: 6px; margin: 0; }
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
.legend { display: grid; gap: 8px; font-size: 11px; }
.legend > div { display: flex; align-items: center; gap: 8px; }
.legend i {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 7px currentColor;
}

.timeline {
  display: grid;
  grid-template-columns: auto minmax(260px, 1fr) minmax(180px, auto);
  align-items: center;
  gap: 16px;
  padding: 10px 14px;
  border-top: 1px solid rgba(148, 184, 207, 0.18);
  background: rgba(5, 12, 20, 0.96);
}
.transport select { min-width: 78px; }
.timeline-track span {
  min-width: 46px;
  color: #a9bac5;
  font-family: "Cascadia Mono", Consolas, monospace;
  font-size: 11px;
}
.timeline-track span:last-child { text-align: right; }
.timeline-track input { width: 100%; accent-color: #51d7ff; }
.timeline-status { color: #7f94a3; font-size: 10px; text-align: right; }
.timeline-status.error { color: #ff788b; }

@keyframes pulse {
  0%, 100% { transform: scale(1); opacity: 0.85; }
  50% { transform: scale(1.13); opacity: 1; }
}

@media (max-width: 1080px) {
  .replay-header { align-items: flex-start; flex-direction: column; }
  .session-controls { width: 100%; justify-content: flex-start; flex-wrap: wrap; }
  .session-controls label { flex: 1; }
  .session-controls select { width: 100%; min-width: 220px; }
  .workspace { grid-template-columns: minmax(0, 1fr); }
  .inspector { display: none; }
  .map-canvas { width: min(100%, calc(100vh - 278px)); }
  .timeline { grid-template-columns: 1fr; gap: 8px; }
  .timeline-status { text-align: left; }
}
</style>
