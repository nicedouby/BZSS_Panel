<template>
  <div class="server-info-snapshot-page">
    <div class="snapshot-frame">
      <section class="snapshot-hero">
        <div class="snapshot-hero__copy">
          <div class="eyebrow">BZSS / AstrBot Server Snapshot</div>
          <h1>{{ serverName }}</h1>
          <div class="badges">
            <span class="badge">{{ playerCountText }}</span>
            <span class="badge">{{ queueText }}</span>
            <span class="badge">{{ tpsText }}</span>
            <span class="badge" :data-tone="warmupTone">{{ warmupText }}</span>
            <span class="badge">{{ sourceText }}</span>
          </div>
          <dl class="details">
            <div><dt>Map</dt><dd>{{ mapName }}</dd></div>
            <div><dt>Layer</dt><dd>{{ layerName }}</dd></div>
            <div><dt>Updated</dt><dd>{{ updatedAtText }}</dd></div>
            <div><dt>Status</dt><dd>{{ statusText }}</dd></div>
          </dl>
        </div>
        <div class="loading-screen">
          <img v-if="loadingScreenUrl" :src="loadingScreenUrl" alt="loading screen">
          <div v-else class="loading-screen__fallback">
            <span>{{ mapName }}</span>
          </div>
        </div>
      </section>

      <section class="snapshot-map">
        <div class="snapshot-map__header">
          <div>
            <div class="eyebrow">Tactical View</div>
            <h2>Mini map / tactical map</h2>
          </div>
          <div class="ready-state" :data-tone="isReady ? 'success' : 'warning'">
            {{ isReady ? "snapshot ready" : "loading snapshot" }}
          </div>
        </div>

        <div ref="renderHost" class="snapshot-map__body">
          <TacticalMapPage
            :snapshot="tacticalSnapshot"
            :players="tacticalPlayers"
            :capture-zones="tacticalCaptureZones"
            :fobs="tacticalFobs"
            :loading="loading"
            :error-text="errorText"
            @snapshot-ready="handleSnapshotReady"
          />
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import TacticalMapPage from "./TacticalMapPage.vue";
import { apiGet } from "../app/apiClient";
import { applyMatchSnapshotResponse } from "../app/matchSnapshot";
import { linkTacticalPlayers } from "../utils/tactical-map-linker";

declare global {
  interface Window {
    __BZSS_SNAPSHOT_READY__?: boolean;
  }
}

type SnapshotState = {
  generatedAt: string;
  source: string;
  server: {
    serverId: string;
    serverName: string;
    playerCount: number;
    queueCount: number;
    tps?: number | null;
    isWarmup: boolean;
  };
  match: {
    map: string;
    layer: string;
    mode: string;
    nextLayer: string;
  };
  overview: any;
  runtime: {
    players: any[];
    squads: any[];
  };
  bzssCore: {
    state: any;
    players: any[];
    captureZones: any[];
    fobs: any[];
    explosions: any[];
  };
};

const loading = ref(true);
const errorText = ref("");
const snapshotState = ref<SnapshotState | null>(null);
const isReady = ref(false);
let readyTimer: number | null = null;

const serverName = computed(() => snapshotState.value?.server.serverName || "BZSS Server");
const playerCountText = computed(() => `Players ${snapshotState.value?.server.playerCount ?? 0}`);
const queueText = computed(() => `Queue ${snapshotState.value?.server.queueCount ?? 0}`);
const tpsText = computed(() => `TPS ${formatTps(snapshotState.value?.server.tps)}`);
const warmupText = computed(() => (snapshotState.value?.server.isWarmup ? "Warmup ON" : "Warmup OFF"));
const warmupTone = computed(() => (snapshotState.value?.server.isWarmup ? "warning" : "success"));
const sourceText = computed(() => `Source ${snapshotState.value?.source ?? "unknown"}`);
const mapName = computed(() => snapshotState.value?.match.map || "Unknown Map");
const layerName = computed(() => snapshotState.value?.match.layer || "Unknown Layer");
const updatedAtText = computed(() => formatDate(snapshotState.value?.generatedAt));
const statusText = computed(() => errorText.value ? errorText.value : "ok");
const loadingScreenUrl = computed(() => resolveLoadingScreenUrl(mapName.value, layerName.value));

const tacticalSnapshot = computed(() => {
  const bzssCore = snapshotState.value?.bzssCore ?? null;
  if (!bzssCore?.state) return null;
  const explosions = Array.isArray(bzssCore.explosions) ? bzssCore.explosions : [];
  return {
    ...bzssCore.state,
    explosions,
    assets: {
      ...(bzssCore.state.assets ?? {}),
      captureZones: bzssCore.captureZones ?? [],
      fobs: bzssCore.fobs ?? [],
      explosions,
    },
  };
});
const tacticalPlayers = computed(() => linkTacticalPlayers({
  bzssPlayers: snapshotState.value?.bzssCore.players ?? [],
  runtimePlayers: [],
}));
const tacticalCaptureZones = computed(() => snapshotState.value?.bzssCore.captureZones ?? []);
const tacticalFobs = computed(() => snapshotState.value?.bzssCore.fobs ?? []);

watch(
  () => [loading.value, errorText.value, snapshotState.value, tacticalPlayers.value.length, tacticalCaptureZones.value.length, tacticalFobs.value.length],
  () => {
    scheduleReady();
  },
  { immediate: true, deep: true }
);

onMounted(async () => {
  await loadSnapshot();
  scheduleReady();
});

onBeforeUnmount(() => {
  clearReadyTimer();
  window.__BZSS_SNAPSHOT_READY__ = false;
});

async function loadSnapshot() {
  loading.value = true;
  errorText.value = "";
  try {
    const data = await apiGet<{ ok: boolean; snapshot: SnapshotState }>("/api/server-info/snapshot-state");
    snapshotState.value = data.snapshot;
    if (data.snapshot?.overview?.matchState) {
      applyMatchSnapshotResponse({
        matchState: data.snapshot.overview.matchState,
        overview: data.snapshot.overview,
      });
    }
  } catch (error: any) {
    errorText.value = error?.message ?? "Failed to load snapshot state";
  } finally {
    loading.value = false;
  }
}

function scheduleReady() {
  clearReadyTimer();
  window.__BZSS_SNAPSHOT_READY__ = false;
  isReady.value = false;
  readyTimer = window.setTimeout(() => {
    syncReady(false);
  }, 800);
}

function handleSnapshotReady(payload: { ready: boolean }) {
  syncReady(payload.ready);
}

function syncReady(ready: boolean) {
  const finalReady = Boolean(
    ready &&
    !loading.value &&
    !errorText.value &&
    snapshotState.value &&
    snapshotState.value.bzssCore &&
    Array.isArray(snapshotState.value.bzssCore.players) &&
    Array.isArray(snapshotState.value.bzssCore.captureZones) &&
    Array.isArray(snapshotState.value.bzssCore.fobs),
  );
  isReady.value = finalReady;
  window.__BZSS_SNAPSHOT_READY__ = finalReady;
}

function clearReadyTimer() {
  if (readyTimer != null) {
    window.clearTimeout(readyTimer);
    readyTimer = null;
  }
}

function formatTps(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "n/a";
  return numeric.toFixed(1);
}

function formatDate(value: string | undefined) {
  if (!value) return "n/a";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return value;
  return new Date(time).toLocaleString("zh-CN", { hour12: false });
}

function resolveLoadingScreenUrl(mapNameValue: string, layerNameValue: string) {
  const candidates = [layerNameValue, mapNameValue];
  for (const candidate of candidates) {
    const key = String(candidate ?? "").trim().split(/[_\s-]/)[0];
    if (!key) continue;
    return `/MapScene/LoadingScreen_${key}_DQHD.PNG`;
  }
  return "";
}
</script>

<style scoped>
.server-info-snapshot-page {
  width: 100%;
  min-height: 100%;
  background:
    radial-gradient(circle at top left, rgba(34, 197, 94, 0.18), transparent 22%),
    radial-gradient(circle at top right, rgba(56, 189, 248, 0.18), transparent 24%),
    linear-gradient(180deg, #07101c 0%, #0b1324 52%, #02050c 100%);
  color: #e2e8f0;
  overflow: hidden;
}

.snapshot-frame {
  width: 100%;
  min-height: 100%;
  box-sizing: border-box;
  padding: 18px;
  display: grid;
  grid-template-rows: 214px minmax(0, 1fr);
  gap: 14px;
}

.snapshot-hero,
.snapshot-map {
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(4, 10, 18, 0.72);
  backdrop-filter: blur(14px);
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.4);
}

.snapshot-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(380px, 0.8fr);
  gap: 16px;
  padding: 18px;
}

.eyebrow {
  font-size: 11px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: #67e8f9;
}

.snapshot-hero__copy h1,
.snapshot-map__header h2 {
  margin: 8px 0 0;
  font-size: 28px;
  line-height: 1.1;
}

.badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.badge,
.ready-state {
  display: inline-flex;
  align-items: center;
  padding: 7px 11px;
  border-radius: 999px;
  font-size: 13px;
  background: rgba(15, 23, 42, 0.86);
  border: 1px solid rgba(148, 163, 184, 0.16);
}

.badge[data-tone="warning"],
.ready-state[data-tone="warning"] {
  color: #fde68a;
  border-color: rgba(245, 158, 11, 0.38);
}

.badge[data-tone="success"],
.ready-state[data-tone="success"] {
  color: #bbf7d0;
  border-color: rgba(34, 197, 94, 0.38);
}

.details {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin-top: 14px;
}

.details > div {
  border-radius: 14px;
  padding: 10px 12px;
  background: rgba(15, 23, 42, 0.56);
  border: 1px solid rgba(148, 163, 184, 0.12);
}

.details dt {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: #94a3b8;
  margin-bottom: 4px;
}

.details dd {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
}

.loading-screen {
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid rgba(125, 211, 252, 0.18);
  background: linear-gradient(135deg, rgba(8, 15, 27, 0.8), rgba(15, 23, 42, 0.6));
}

.loading-screen img,
.loading-screen__fallback {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.loading-screen__fallback {
  display: grid;
  place-items: center;
  font-size: 30px;
  font-weight: 800;
  color: rgba(226, 232, 240, 0.75);
}

.snapshot-map {
  min-height: 0;
  padding: 14px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}

.snapshot-map__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.snapshot-map__header h2 {
  font-size: 20px;
}

.snapshot-map__body {
  min-height: 0;
  overflow: hidden;
  border-radius: 16px;
  border: 1px solid rgba(148, 163, 184, 0.12);
}
</style>
