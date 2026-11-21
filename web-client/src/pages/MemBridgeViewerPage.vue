<template>
  <main class="bridge-viewer">
    <header class="bridge-viewer__header">
      <h1>Mem Bridge 3D</h1>
      <span>{{ target === "test" ? "BZSS 测试服" : "BZSS 正式服" }}</span>
      <span class="bridge-viewer__state" :data-state="status" role="status">{{ statusLabel }}</span>
    </header>
    <div ref="viewport" class="bridge-viewer__stage" aria-label="实时 3D 地图"></div>
  </main>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiGet, ApiError } from "../app/apiClient";
import { memBridgePanelTarget, type MemBridgeTarget } from "../app/memBridgeApi";
import { mountTacticalScene3d, type TacticalSceneHandle } from "../app/tacticalScene3d.mjs";
import { bridgePollMs, type BridgeSampling } from "../app/memBridgeCadence";

interface ViewerSnapshot {
  module: "BZSS-MEM-BRIDGE";
  target: MemBridgeTarget;
  observedAt: number;
  epoch: string;
  map: { worldName: string };
  players: unknown[];
  mapPoints: unknown[];
  liveActors?: unknown[];
  projectiles?: unknown[];
  health: { status: string };
  sampling?: BridgeSampling;
}

const viewport = ref<HTMLElement | null>(null);
const router = useRouter();
const route = useRoute();
const target = computed<MemBridgeTarget>(() => {
  const value = route.query.target;
  return value === "test" || value === "formal" ? value : memBridgePanelTarget();
});
const status = ref<"connecting" | "live" | "offline" | "denied">("connecting");
const statusLabel = computed(() => ({
  connecting: "正在连接遥测",
  live: "实时遥测",
  offline: "遥测暂不可用",
  denied: "当前账号无法读取遥测",
})[status.value]);

let snapshot: ViewerSnapshot | null = null;
let lifetime: AbortController | null = null;
let disposeScene: TacticalSceneHandle | null = null;
let refreshTimer: number | undefined;

function activate() {
  if (lifetime || !viewport.value) return;
  const connection = lifetime = new AbortController();
  const selectedTarget = target.value;
  status.value = "connecting";
  disposeScene = mountTacticalScene3d(viewport.value, {
    getFeed: () => snapshot,
    onBack: () => { void router.push({ name: "mem-bridge" }); },
  });

  let failures = 0;
  async function refresh() {
    if (connection.signal.aborted) return;
    const began = performance.now();
    let delay = bridgePollMs(snapshot?.sampling);
    try {
      if (document.hidden) return;
      const next = await apiGet<ViewerSnapshot>(`/api/mem-bridge/snapshot?target=${selectedTarget}`,
        { signal: connection.signal }, { timeoutMs: 1500 });
      if (connection.signal.aborted) return;
      if (next?.module !== "BZSS-MEM-BRIDGE" || next.target !== selectedTarget ||
          next.health?.status !== "ok" || !next.map?.worldName || !Array.isArray(next.players) ||
          !Array.isArray(next.mapPoints) || !Number.isFinite(next.observedAt)) {
        throw new Error("Invalid Mem Bridge snapshot");
      }
      if (next.epoch !== snapshot?.epoch || next.observedAt !== snapshot?.observedAt) {
        snapshot = next;
        disposeScene?.refreshSnapshot();
      }
      delay = bridgePollMs(next.sampling);
      status.value = "live";
      failures = 0;
    } catch (error) {
      if (connection.signal.aborted) return;
      failures++;
      delay = Math.min(2000, failures * 400);
      const denied = error instanceof ApiError && (error.status === 401 || error.status === 403);
      if (denied || failures >= 2 || !snapshot) {
        snapshot = null;
        status.value = denied ? "denied" : "offline";
      }
    } finally {
      const remaining = failures ? delay : Math.max(12, delay - (performance.now() - began));
      if (!connection.signal.aborted) refreshTimer = window.setTimeout(refresh, document.hidden ? 500 : remaining);
    }
  }
  void refresh();
}

function deactivate() {
  if (!lifetime) return;
  lifetime.abort();
  lifetime = null;
  window.clearTimeout(refreshTimer);
  disposeScene?.();
  disposeScene = null;
  snapshot = null;
}

watch(target, () => {
  if (!lifetime) return;
  deactivate();
  activate();
});
onMounted(activate);
onActivated(activate);
onDeactivated(deactivate);
onBeforeUnmount(deactivate);
</script>

<style scoped>
.bridge-viewer { display: grid; grid-template-rows: auto minmax(0, 1fr); height: 100%; min-height: 0; background: #101b24; color: #e9f4fa; }
.bridge-viewer__header { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding: 8px 12px; border-bottom: 1px solid #36525e; }
.bridge-viewer__header h1 { margin: 0; font-size: 15px; font-weight: 700; }
.bridge-viewer__header span { font-size: 12px; color: #aec5ce; }
.bridge-viewer__header .bridge-viewer__state[data-state="live"] { color: #8fe2c2; }
.bridge-viewer__header .bridge-viewer__state[data-state="offline"],
.bridge-viewer__header .bridge-viewer__state[data-state="denied"] { color: #ffcfaa; }
.bridge-viewer__stage { position: relative; min-height: 0; min-width: 0; }
</style>
