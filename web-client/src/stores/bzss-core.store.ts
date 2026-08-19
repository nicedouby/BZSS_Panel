import { defineStore } from "pinia";
import { ref, computed } from "vue";
import {
  fetchBzssCorePlayerInfoList,
  fetchBzssCoreRawData,
  streamBzssCorePlayerInfoList,
  fetchBzssCoreVariables,
  setBzssCoreVariable,
  BZSS_CORE_BOOL_KEYS,
  type BzssCorePlayerInfoResponse,
  type BzssCoreRawDataResponse,
  type BzssCoreBoolKey,
  type BzssCoreVariableSnapshot,
  type BzssCoreVariableState,
} from "../app/bzssCoreApi";

export function buildBzssCorePlayers(data: BzssCorePlayerInfoResponse) {
  if (Array.isArray(data.players)) {
    return data.players;
  }

  const runtimePlayers = data.runtimePlayers ?? [];
  const scoreboardPlayers = data.scoreboardPlayers ?? [];
  const byIndex = new Map<number | string, any>();

  for (const player of scoreboardPlayers) {
    if (player.playerIndex == null && player.playerId == null) continue;
    const key = player.playerIndex ?? player.playerId ?? "";
    byIndex.set(key, {
      ...player,
      position: null,
      yaw: null,
      stale: true,
      presence: {
        state: "scoreboardOnly",
      },
      telemetry: {
        position: null,
        yaw: null,
        combatInfo: "",
      },
    });
  }

  for (const player of runtimePlayers) {
    if (player.playerIndex == null && player.playerId == null) continue;
    const key = player.playerIndex ?? player.playerId ?? "";
    const existing = byIndex.get(key);
    byIndex.set(key, existing ? { ...existing, ...player } : { ...player });
  }

  return [...byIndex.values()];
}

export const useBzssCoreStore = defineStore("bzssCore", () => {
  const snapshot = ref<BzssCorePlayerInfoResponse | null>(null);
  const players = ref<any[]>([]);
  const loading = ref(false);
  const error = ref("");

  const rawData = ref<BzssCoreRawDataResponse | null>(null);
  const rawLoading = ref(false);
  const rawError = ref("");

  const coreVariables = ref<BzssCoreVariableSnapshot | null>(null);
  const variableStates = ref<Record<BzssCoreBoolKey, BzssCoreVariableState>>(
    Object.fromEntries(BZSS_CORE_BOOL_KEYS.map((key) => [key, {
      actual: null,
      desired: null,
      pending: false,
      error: null,
      updatedAt: null,
    }])) as Record<BzssCoreBoolKey, BzssCoreVariableState>,
  );
  const variablesLoading = ref(false);
  const variablesError = ref("");
  let variablesTimer: number | null = null;
  let variablesRefreshInFlight: Promise<void> | null = null;

  let closeStream: (() => void) | null = null;

  function applyVariableSnapshot(data: BzssCoreVariableSnapshot) {
    coreVariables.value = data;
    variablesError.value = data.error ?? "";
    for (const key of BZSS_CORE_BOOL_KEYS) {
      const state = variableStates.value[key];
      const actual = data.online ? data.variables[key] : null;
      const desired = data.desired[key];
      state.actual = actual;
      state.desired = typeof desired === "boolean" ? desired : null;
      state.pending = Boolean(data.online && state.desired !== null && actual !== state.desired);
      state.error = data.status[key] === "error" ? (data.error ?? "BZSS-Core 调和失败") : null;
      state.updatedAt = data.online && actual !== null ? data.updatedAt : state.updatedAt;
    }
  }

  async function refreshVariables() {
    if (variablesRefreshInFlight) return variablesRefreshInFlight;
    variablesLoading.value = true;
    variablesRefreshInFlight = fetchBzssCoreVariables()
      .then(applyVariableSnapshot)
      .catch((err: any) => {
        variablesError.value = err?.message ?? "BZSS-Core 状态读取失败";
        for (const key of BZSS_CORE_BOOL_KEYS) variableStates.value[key].actual = null;
      })
      .finally(() => {
        variablesLoading.value = false;
        variablesRefreshInFlight = null;
      });
    return variablesRefreshInFlight;
  }

  async function setVariable(key: BzssCoreBoolKey, desired: boolean) {
    const state = variableStates.value[key];
    state.desired = desired;
    state.pending = true;
    state.error = null;
    try {
      const result = await setBzssCoreVariable(key, desired);
      applyVariableSnapshot(result);
    } catch (err: any) {
      state.pending = false;
      state.error = err?.message ?? "BZSS-Core 写入失败";
      throw err;
    }
  }

  function startVariablePolling() {
    if (variablesTimer !== null) return;
    void refreshVariables();
    variablesTimer = window.setInterval(() => void refreshVariables(), 3000);
    window.addEventListener("focus", refreshVariables);
  }

  function stopVariablePolling() {
    if (variablesTimer !== null) window.clearInterval(variablesTimer);
    variablesTimer = null;
    window.removeEventListener("focus", refreshVariables);
  }

  function updatePlayers(data: BzssCorePlayerInfoResponse) {
    players.value = buildBzssCorePlayers(data);
  }

  async function fetchSnapshot() {
    loading.value = true;
    error.value = "";
    try {
      const data = await fetchBzssCorePlayerInfoList();
      snapshot.value = data;
      updatePlayers(data);
      error.value = data.ok ? "" : data.status || "BZSS-Core returned an error.";
    } catch (err: any) {
      error.value = err?.message ?? "Failed to fetch BZSS-Core snapshot.";
    } finally {
      loading.value = false;
    }
  }

  async function fetchRaw() {
    rawLoading.value = true;
    rawError.value = "";
    try {
      rawData.value = await fetchBzssCoreRawData();
    } catch (err: any) {
      rawError.value = err?.message ?? "Failed to fetch raw BZSS-Core data.";
    } finally {
      rawLoading.value = false;
    }
  }

  function startStream() {
    if (closeStream) return;

    loading.value = true;
    closeStream = streamBzssCorePlayerInfoList(
      (data) => {
        snapshot.value = data;
        updatePlayers(data);
        error.value = data.ok ? "" : data.status || "BZSS-Core returned an error.";
        loading.value = false;
      },
      (err, source) => {
        loading.value = false;
        if (source.readyState === EventSource.CLOSED) {
          error.value = "SSE Stream connection error.";
          stopStream();
        }
      }
    );
  }

  function stopStream() {
    closeStream?.();
    closeStream = null;
  }

  return {
    snapshot,
    players,
    loading,
    error,
    rawData,
    rawLoading,
    rawError,
    coreVariables,
    variableStates,
    variablesLoading,
    variablesError,
    refreshVariables,
    setVariable,
    startVariablePolling,
    stopVariablePolling,
    streamActive: computed(() => closeStream !== null),
    fetchSnapshot,
    fetchRaw,
    startStream,
    stopStream,
  };
});
