<template>
  <div ref="shellRef" class="tactical-replay-shell">
    <TacticalMapPage
      class="tactical-replay-map"
      :snapshot="mapSnapshot"
      :players="mapPlayers"
      :capture-zones="captureZones"
      :fobs="fobs"
      :main-zones="mainZones"
      :loading="windowLoading"
      :error-text="errorText"
      @select-player="openHistoricalPlayer"
    />

    <PlayerInfoPanel
      v-if="historicalPlayerPanel && historicalPanelPlayer"
      :player="historicalPanelPlayer"
      :x="historicalPlayerPanel.x"
      :y="historicalPlayerPanel.y"
      tone="neutral"
      speed-text="历史帧"
      core-status-text="HISTORICAL"
      :rcon-detail="historicalPanelRconDetail"
      @close="historicalPlayerPanel = null"
    />

    <section class="replay-session-bar glass-panel">
      <div class="replay-title">
        <span class="eyebrow">TACTICAL DATA REPLAY</span>
        <strong>战术数据回放</strong>
        <small>非视频 · 独立进程 · 与实时战术地图共用渲染器</small>
      </div>

      <label class="session-picker">
        <span>对局记录</span>
        <select
          v-model="selectedSessionId"
          :disabled="sessionsLoading"
          @change="selectSession(selectedSessionId)"
        >
          <option value="">请选择一局</option>
          <option v-for="session in sessions" :key="session.id" :value="session.id">
            {{ formatSessionOption(session) }}
          </option>
        </select>
      </label>

      <button type="button" :disabled="sessionsLoading" @click="refreshSessions(true)">
        {{ sessionsLoading ? "刷新中" : "刷新记录" }}
      </button>
      <RouterLink class="replay-link" to="/tactical-map">返回实时地图</RouterLink>
      <span v-if="hiddenLegacySessions > 0" class="legacy-note">
        已隐藏 {{ hiddenLegacySessions }} 个旧版碎片记录
      </span>
    </section>

    <section class="replay-transport glass-panel" :class="{ disabled: !selectedSession }">
      <div class="transport-buttons">
        <button type="button" :disabled="!selectedSession" @click="togglePlayback">
          {{ playing ? "暂停" : "播放" }}
        </button>
        <button type="button" :disabled="!selectedSession" @click="seekBy(-10_000)">-10s</button>
        <button type="button" :disabled="!selectedSession" @click="seekBy(10_000)">+10s</button>
      </div>

      <div class="timeline-block">
        <div class="timeline-meta">
          <strong>{{ formatClock(currentTimeMs) }}</strong>
          <span>{{ formatClock(durationMs) }}</span>
          <small>{{ loadedWindowText }}</small>
        </div>
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
      </div>

      <label class="speed-picker">
        <span>速度</span>
        <select v-model.number="playbackRate" :disabled="!selectedSession">
          <option :value="0.25">0.25×</option>
          <option :value="0.5">0.5×</option>
          <option :value="1">1×</option>
          <option :value="2">2×</option>
          <option :value="4">4×</option>
        </select>
      </label>

      <div class="replay-state" :class="{ error: Boolean(errorText) }">
        <span>{{ errorText || (windowLoading ? "正在读取数据分片" : "数据已就绪") }}</span>
        <small v-if="selectedSession">
          {{ selectedSession.layer || selectedSession.map }} · {{ selectedSession.frameCounts.players }} 玩家帧
        </small>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import TacticalMapPage from "./TacticalMapPage.vue";
import PlayerInfoPanel from "../components/tactical-map/PlayerInfoPanel.vue";
import {
  fetchTacticalReplaySession,
  fetchTacticalReplaySessions,
  fetchTacticalReplayWindow,
  type TacticalReplayAssetsFrame,
  type TacticalReplayFrame,
  type TacticalReplayPlayersFrame,
  type TacticalReplaySession,
} from "../app/tacticalReplayApi";
import { useServerStore } from "../stores/server.store";
import { useTacticalStateStore } from "../stores/tactical-state.store";
import { adaptPlayerDetail } from "../utils/squad-admin-adapter";
import type { TacticalLinkedPlayer } from "../utils/tactical-map-linker";

const WINDOW_DURATION_MS = 6_000;
const WINDOW_STEP_MS = 4_000;
const WINDOW_CONTEXT_MS = 1_000;
const WINDOW_PREFETCH_MS = 1_250;

const shellRef = ref<HTMLElement | null>(null);
const sessions = ref<TacticalReplaySession[]>([]);
const selectedSessionId = ref("");
const selectedSession = ref<TacticalReplaySession | null>(null);
const frames = ref<TacticalReplayFrame[]>([]);
const sessionsLoading = ref(false);
const windowLoading = ref(false);
const errorText = ref("");
const hiddenLegacySessions = ref(0);
const currentTimeMs = ref(0);
const playbackRate = ref(1);
const playing = ref(false);
const loadedFromMs = ref(0);
const loadedToMs = ref(0);
const historicalPlayerPanel = ref<{
  key: string;
  fallback: TacticalLinkedPlayer;
  x: number;
  y: number;
  rconDetail: any;
} | null>(null);

const serverStore = useServerStore();
const tacticalStateStore = useTacticalStateStore();
let originalServerSnapshot: Record<string, any> | null = null;
let liveStreamWasActive = false;
let animationFrame: number | null = null;
let playbackAnchorWallMs = 0;
let playbackAnchorReplayMs = 0;
let requestGeneration = 0;
let activeWindowKey = "";
let timelineLoadTimer: number | null = null;
let sessionsController: AbortController | null = null;
let sessionController: AbortController | null = null;
let windowController: AbortController | null = null;

const orderedFrames = computed(() => [...frames.value].sort(compareFrames));
const playerFrames = computed(() => orderedFrames.value.filter(
  (frame): frame is TacticalReplayPlayersFrame => frame.type === "players",
));
const assetFrames = computed(() => orderedFrames.value.filter(
  (frame): frame is TacticalReplayAssetsFrame => frame.type === "assets",
));
const currentPlayerFrame = computed(() => findFrameAtOrBefore(playerFrames.value, currentTimeMs.value));
const nextPlayerFrame = computed(() => findFrameAfter(playerFrames.value, currentTimeMs.value));
const currentAssetFrame = computed(() => findFrameAtOrBefore(assetFrames.value, currentTimeMs.value));
const durationMs = computed(() => Math.max(
  0,
  Number(selectedSession.value?.durationMs ?? 0),
  Number(orderedFrames.value.at(-1)?.t ?? 0),
));

const canonicalPlayers = computed(() => {
  const current = currentPlayerFrame.value;
  if (!current) return [];
  const next = nextPlayerFrame.value;
  const span = next && next.t > current.t ? next.t - current.t : 0;
  const alpha = span > 0 ? clamp((currentTimeMs.value - current.t) / span, 0, 1) : 0;
  const nextByKey = new Map<string, any>();
  for (const player of next?.players ?? []) nextByKey.set(canonicalPlayerKey(player), player);
  return (current.players ?? []).map((player) => interpolateCanonicalPlayer(
    player,
    nextByKey.get(canonicalPlayerKey(player)),
    alpha,
  ));
});

const mapPlayers = computed<TacticalLinkedPlayer[]>(() => adaptReplayPlayers(canonicalPlayers.value));
const captureZones = computed(() => currentAssetFrame.value?.assets?.captureZones ?? []);
const fobs = computed(() => currentAssetFrame.value?.assets?.fobs ?? []);
const mainZones = computed(() => currentAssetFrame.value?.assets?.mainZones ?? []);
const mapSnapshot = computed<any>(() => {
  const scene = currentPlayerFrame.value?.scene ?? currentAssetFrame.value?.scene ?? {};
  return {
    ...scene,
    players: canonicalPlayers.value,
    assets: {
      captureZones: captureZones.value,
      fobs: fobs.value,
      mainZones: mainZones.value,
    },
  };
});
const historicalPanelPlayer = computed<TacticalLinkedPlayer | null>(() => {
  const panel = historicalPlayerPanel.value;
  if (!panel) return null;
  return mapPlayers.value.find((player) => linkedPlayerKey(player) === panel.key) ?? panel.fallback;
});
const historicalPanelRconDetail = computed(() => (
  (historicalPanelPlayer.value as any)?.rconDetail ?? historicalPlayerPanel.value?.rconDetail ?? null
));

const loadedWindowText = computed(() => {
  if (!selectedSession.value) return "未选择回放";
  return `${formatClock(loadedFromMs.value)} – ${formatClock(loadedToMs.value)} · ${frames.value.length} 帧`;
});

onMounted(() => {
  originalServerSnapshot = clonePlain(serverStore.snapshot ?? {});
  liveStreamWasActive = Boolean(tacticalStateStore.streamActive);
  tacticalStateStore.stopStream();
  void refreshSessions(false);
});

onBeforeUnmount(() => {
  stopPlaybackLoop();
  sessionsController?.abort();
  sessionController?.abort();
  windowController?.abort();
  if (timelineLoadTimer !== null) window.clearTimeout(timelineLoadTimer);
  if (originalServerSnapshot) serverStore.applySnapshot(originalServerSnapshot);
  if (liveStreamWasActive) tacticalStateStore.startStream();
});

watch(playbackRate, () => {
  if (playing.value) resetPlaybackAnchor();
});

async function refreshSessions(preserveSelection: boolean) {
  sessionsController?.abort();
  sessionsController = new AbortController();
  sessionsLoading.value = true;
  errorText.value = "";
  try {
    const response = await fetchTacticalReplaySessions(200, sessionsController.signal);
    sessions.value = Array.isArray(response.sessions) ? response.sessions : [];
    hiddenLegacySessions.value = Number(response.hiddenLegacySessions ?? 0);
    if (preserveSelection && selectedSessionId.value) {
      const stillExists = sessions.value.some((session) => session.id === selectedSessionId.value);
      if (!stillExists) await selectSession("");
    }
  } catch (error: any) {
    if (error?.type !== "abort") errorText.value = error?.message ?? "无法读取回放列表";
  } finally {
    sessionsLoading.value = false;
  }
}

async function selectSession(sessionId: string) {
  stopPlaybackLoop();
  historicalPlayerPanel.value = null;
  sessionController?.abort();
  windowController?.abort();
  sessionController = new AbortController();
  selectedSessionId.value = sessionId;
  selectedSession.value = null;
  frames.value = [];
  currentTimeMs.value = 0;
  loadedFromMs.value = 0;
  loadedToMs.value = 0;
  activeWindowKey = "";
  errorText.value = "";
  if (!sessionId) return;

  try {
    const listed = sessions.value.find((session) => session.id === sessionId) ?? null;
    const response = await fetchTacticalReplaySession(sessionId, sessionController.signal);
    selectedSession.value = response.session ?? listed;
    const mapIdentity = selectedSession.value?.layer || selectedSession.value?.map || "";
    serverStore.applyLiveMapIdentity(mapIdentity);
    await ensureWindowForTime(0, true);
  } catch (error: any) {
    if (error?.type !== "abort") errorText.value = error?.message ?? "无法读取回放记录";
  }
}

async function ensureWindowForTime(timeMs: number, force = false) {
  const sessionId = selectedSession.value?.id;
  if (!sessionId) return;
  const safeTime = clamp(Number(timeMs) || 0, 0, Math.max(durationMs.value, 0));
  const comfortablyLoaded = safeTime >= loadedFromMs.value + 250
    && safeTime <= loadedToMs.value - WINDOW_PREFETCH_MS;
  if (!force && comfortablyLoaded) return;

  const bucketStart = Math.max(0, Math.floor(safeTime / WINDOW_STEP_MS) * WINDOW_STEP_MS - WINDOW_CONTEXT_MS);
  const windowKey = `${sessionId}:${bucketStart}`;
  if (!force && activeWindowKey === windowKey && windowLoading.value) return;
  if (!force && activeWindowKey === windowKey && frames.value.length > 0) return;

  const generation = ++requestGeneration;
  activeWindowKey = windowKey;
  windowController?.abort();
  windowController = new AbortController();
  windowLoading.value = true;
  try {
    const response = await fetchTacticalReplayWindow(sessionId, {
      fromMs: bucketStart,
      durationMs: WINDOW_DURATION_MS,
      contextMs: WINDOW_CONTEXT_MS,
      includeContext: true,
      limit: 3_000,
      signal: windowController.signal,
    });
    if (generation !== requestGeneration || selectedSession.value?.id !== sessionId) return;
    frames.value = Array.isArray(response.frames) ? response.frames : [];
    loadedFromMs.value = Number(response.fromMs ?? bucketStart);
    loadedToMs.value = Number(response.toMs ?? bucketStart + WINDOW_DURATION_MS);
    if (response.session) selectedSession.value = response.session;
    errorText.value = "";
  } catch (error: any) {
    if (error?.type !== "abort") errorText.value = error?.message ?? "回放数据分片读取失败";
  } finally {
    if (generation === requestGeneration) windowLoading.value = false;
  }
}

function openHistoricalPlayer(payload: { detail?: any; event?: MouseEvent }) {
  const player = payload?.detail?.bzssCorePlayerInfo as TacticalLinkedPlayer | undefined;
  const shell = shellRef.value;
  if (!player || !shell) return;
  const rect = shell.getBoundingClientRect();
  const eventX = Number(payload?.event?.clientX ?? rect.left + rect.width / 2);
  const eventY = Number(payload?.event?.clientY ?? rect.top + rect.height / 2);
  historicalPlayerPanel.value = {
    key: linkedPlayerKey(player),
    fallback: player,
    x: clamp(eventX - rect.left, 8, Math.max(8, rect.width - 310)),
    y: clamp(eventY - rect.top, 8, Math.max(8, rect.height - 330)),
    rconDetail: payload?.detail ?? null,
  };
}

function onTimelineInput() {
  if (timelineLoadTimer !== null) window.clearTimeout(timelineLoadTimer);
  timelineLoadTimer = window.setTimeout(() => {
    timelineLoadTimer = null;
    void ensureWindowForTime(currentTimeMs.value, false);
  }, 100);
  if (playing.value) resetPlaybackAnchor();
}

function togglePlayback() {
  if (!selectedSession.value) return;
  if (playing.value) {
    stopPlaybackLoop();
    return;
  }
  if (currentTimeMs.value >= durationMs.value) currentTimeMs.value = 0;
  playing.value = true;
  resetPlaybackAnchor();
  animationFrame = requestAnimationFrame(playbackTick);
}

function playbackTick(now: number) {
  if (!playing.value) return;
  const elapsed = (now - playbackAnchorWallMs) * playbackRate.value;
  currentTimeMs.value = clamp(playbackAnchorReplayMs + elapsed, 0, durationMs.value);
  if (currentTimeMs.value >= loadedToMs.value - WINDOW_PREFETCH_MS) {
    void ensureWindowForTime(currentTimeMs.value, false);
  }
  if (currentTimeMs.value >= durationMs.value) {
    stopPlaybackLoop();
    return;
  }
  animationFrame = requestAnimationFrame(playbackTick);
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
  currentTimeMs.value = clamp(currentTimeMs.value + deltaMs, 0, durationMs.value);
  if (playing.value) resetPlaybackAnchor();
  void ensureWindowForTime(currentTimeMs.value, true);
}

function adaptReplayPlayers(playersList: any[]): TacticalLinkedPlayer[] {
  return (Array.isArray(playersList) ? playersList : []).map((player) => {
    const steamId = player?.identity?.steamID ?? null;
    const eosId = player?.identity?.eosID ?? null;
    const rawRcon = player?.raw?.rcon ?? null;
    const presenceState = String(player?.presence?.state ?? "");
    const presenceHint = String(player?.telemetry?.presenceHint ?? "");
    const isNoPawn = presenceHint === "noPawn" || presenceState === "noPawn";
    const rconDetail = rawRcon
      ? adaptPlayerDetail(rawRcon, player?.profile?.playtimeHours ?? null, {})
      : null;
    const position = player?.telemetry?.position ?? player?.position ?? null;
    const yaw = player?.telemetry?.yaw ?? player?.yaw ?? null;
    const rotation = player?.telemetry?.rotation ?? player?.soldierInfo?.rotation ?? null;

    return {
      key: player?.identity?.key ?? canonicalPlayerKey(player),
      playerId: player?.identity?.playerID ?? null,
      playerIndex: player?.identity?.playerID ?? null,
      playerName: player?.identity?.name ?? rawRcon?.name ?? "Unknown",
      playerGuid: steamId || eosId || "",
      steamId: steamId || null,
      eosId: eosId || null,
      teamId: player?.match?.teamId ?? null,
      squadId: player?.match?.squadId ?? null,
      isLeader: Boolean(player?.match?.isLeader),
      role: player?.match?.role ?? "",
      health: player?.telemetry?.health ?? null,
      ping: player?.network?.gamePing ?? null,
      ftIndex: player?.telemetry?.fireTeamIndex ?? null,
      ftPosition: player?.telemetry?.fireTeamPosition ?? null,
      position,
      yaw,
      presenceHint: isNoPawn ? "noPawn" : presenceHint,
      presence: { ...(player?.presence ?? {}), state: isNoPawn ? "noPawn" : presenceState },
      hasTelemetry: Boolean(player?.telemetry?.hasTelemetry),
      hasPosition: Boolean(player?.telemetry?.hasPosition || position),
      playerBaseInfo: { raw: "", fields: [], values: {} },
      soldierInfo: {
        raw: "",
        fields: [],
        values: {},
        soldierClass: player?.telemetry?.soldierClass ?? "",
        health: player?.telemetry?.health ?? null,
        weaponClass: player?.telemetry?.weaponClass ?? "",
        ammoValues: [],
        position,
        rotation,
      },
      vehicleInfo: {
        raw: player?.vehicle?.raw ?? "",
        vehicleType: player?.vehicle?.vehicleType ?? "",
        healthText: "",
        health: player?.vehicle?.health ?? null,
        maxHealth: player?.vehicle?.maxHealth ?? null,
        position,
        rotation,
      },
      playerScoreboard: {
        raw: "",
        values: [],
        numericValues: [],
        ping: player?.network?.gamePing ?? null,
        stats: {
          dataLives: null,
          numKills: player?.combat?.kills ?? null,
          numDeaths: player?.combat?.deaths ?? null,
          numWoundeds: player?.combat?.woundeds ?? null,
          numWounds: player?.combat?.wounds ?? null,
          numTeamKills: player?.combat?.teamKills ?? null,
          healPoints: player?.combat?.healPoints ?? null,
          revivedPoints: player?.combat?.revives ?? null,
          teamworkScore: player?.combat?.teamworkScore ?? null,
          objectiveScore: player?.combat?.objectiveScore ?? null,
          combatScore: player?.combat?.combatScore ?? null,
        },
      },
      observedAt: player?.freshness?.bzssCoreUpdatedAt ?? player?.freshness?.generatedAt ?? "",
      stale: !player?.freshness?.bzssCoreUpdatedAt,
      rawText: "",
      runtime: rawRcon,
      raw: player?.raw ?? {},
      profile: player?.profile ?? {},
      rconDetail,
      linkConfidence: player?.link?.confidence ?? "none",
      linkReason: player?.link?.method ?? "unlinked",
      bzss: player,
    } as TacticalLinkedPlayer;
  });
}

function interpolateCanonicalPlayer(current: any, next: any, alpha: number) {
  if (!next || alpha <= 0) return current;
  const currentPosition = current?.telemetry?.position ?? current?.position ?? null;
  const nextPosition = next?.telemetry?.position ?? next?.position ?? null;
  if (!currentPosition || !nextPosition) return current;
  const position = {
    x: interpolateNumber(currentPosition.x, nextPosition.x, alpha),
    y: interpolateNumber(currentPosition.y, nextPosition.y, alpha),
    z: interpolateNumber(currentPosition.z, nextPosition.z, alpha),
  };
  const yaw = interpolateAngle(
    numberOrNull(current?.telemetry?.yaw, current?.yaw),
    numberOrNull(next?.telemetry?.yaw, next?.yaw),
    alpha,
  );
  return {
    ...current,
    telemetry: {
      ...(current?.telemetry ?? {}),
      position,
      ...(yaw == null ? {} : { yaw }),
    },
  };
}

function canonicalPlayerKey(player: any) {
  const identity = player?.identity ?? {};
  return String(identity.key ?? identity.steamID ?? identity.eosID ?? identity.controllerID
    ?? identity.playerID ?? identity.playerId ?? identity.name ?? "");
}

function linkedPlayerKey(player: TacticalLinkedPlayer) {
  const index = Number((player as any)?.playerIndex ?? (player as any)?.playerId);
  if (Number.isFinite(index)) return `idx:${index}`;
  const guid = String((player as any)?.playerGuid ?? "").trim();
  if (guid) return `guid:${guid}`;
  return `name:${String((player as any)?.playerName ?? "").trim()}`;
}

function findFrameAtOrBefore<T extends TacticalReplayFrame>(source: T[], timeMs: number): T | null {
  let result: T | null = null;
  for (const frame of source) {
    if (frame.t > timeMs) break;
    result = frame;
  }
  return result;
}

function findFrameAfter<T extends TacticalReplayFrame>(source: T[], timeMs: number): T | null {
  return source.find((frame) => frame.t > timeMs) ?? null;
}

function compareFrames(left: TacticalReplayFrame, right: TacticalReplayFrame) {
  return Number(left.t) - Number(right.t) || Number(left.seq) - Number(right.seq);
}

function interpolateNumber(left: unknown, right: unknown, alpha: number) {
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a)) return Number.isFinite(b) ? b : 0;
  if (!Number.isFinite(b)) return a;
  return a + (b - a) * alpha;
}

function interpolateAngle(left: number | null, right: number | null, alpha: number) {
  if (left == null) return right;
  if (right == null) return left;
  const delta = ((right - left + 540) % 360) - 180;
  return left + delta * alpha;
}

function numberOrNull(...values: unknown[]) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function formatSessionOption(session: TacticalReplaySession) {
  const date = session.startedAt ? new Date(session.startedAt).toLocaleString() : "未知时间";
  const duration = formatClock(session.durationMs ?? 0);
  const state = session.status === "active" ? "录制中" : duration;
  return `${date} · ${session.layer || session.map || "未知地图"} · ${state}`;
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

function clonePlain<T>(value: T): T {
  try { return structuredClone(value); } catch { return JSON.parse(JSON.stringify(value)); }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}
</script>

<style scoped>
.tactical-replay-shell {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 720px;
  overflow: hidden;
  background: #020617;
}

.tactical-replay-map {
  position: absolute;
  inset: 0;
}

.glass-panel {
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(2, 6, 23, 0.86);
  box-shadow: 0 18px 50px rgba(2, 6, 23, 0.38);
  backdrop-filter: blur(14px);
}

.replay-session-bar {
  position: absolute;
  z-index: 70;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  width: min(1120px, calc(100% - 420px));
  min-width: 620px;
  padding: 10px 12px;
  border-radius: 12px;
  color: #e2e8f0;
}

.replay-title {
  display: grid;
  min-width: 220px;
}

.replay-title .eyebrow {
  color: #38bdf8;
  font-size: 10px;
  letter-spacing: 0.18em;
}

.replay-title strong {
  font-size: 15px;
}

.replay-title small,
.legacy-note {
  color: #94a3b8;
  font-size: 11px;
}

.session-picker {
  display: grid;
  flex: 1;
  gap: 4px;
  min-width: 240px;
}

.session-picker span,
.speed-picker span {
  color: #94a3b8;
  font-size: 10px;
  text-transform: uppercase;
}

select,
button,
.replay-link {
  min-height: 34px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.9);
  color: #e2e8f0;
}

select {
  width: 100%;
  padding: 0 10px;
}

button,
.replay-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 12px;
  cursor: pointer;
  text-decoration: none;
  white-space: nowrap;
}

button:hover:not(:disabled),
.replay-link:hover {
  border-color: rgba(56, 189, 248, 0.7);
  background: rgba(14, 116, 144, 0.3);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.replay-transport {
  position: absolute;
  z-index: 70;
  right: 20px;
  bottom: 18px;
  left: 20px;
  display: grid;
  grid-template-columns: auto minmax(280px, 1fr) auto minmax(180px, 260px);
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border-radius: 12px;
  color: #e2e8f0;
}

.transport-buttons {
  display: flex;
  gap: 8px;
}

.timeline-block {
  display: grid;
  gap: 6px;
}

.timeline-meta {
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: 10px;
  align-items: center;
  font-variant-numeric: tabular-nums;
}

.timeline-meta span,
.timeline-meta small {
  color: #94a3b8;
}

.timeline-meta small {
  overflow: hidden;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

input[type="range"] {
  width: 100%;
  accent-color: #38bdf8;
}

.speed-picker {
  display: grid;
  gap: 4px;
  min-width: 84px;
}

.replay-state {
  display: grid;
  gap: 2px;
  min-width: 0;
  text-align: right;
}

.replay-state span {
  color: #67e8f9;
}

.replay-state small {
  overflow: hidden;
  color: #94a3b8;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.replay-state.error span {
  color: #f87171;
}

@media (max-width: 1180px) {
  .replay-session-bar {
    right: 16px;
    left: 16px;
    width: auto;
    min-width: 0;
    transform: none;
  }

  .replay-title small,
  .legacy-note {
    display: none;
  }

  .replay-transport {
    grid-template-columns: auto 1fr auto;
  }

  .replay-state {
    display: none;
  }
}
</style>
