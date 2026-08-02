<template>
  <teleport to="body">
    <section
      v-if="visible"
      ref="windowEl"
      class="super-weather-window"
      :class="{ minimized: windowState.minimized, maximized }"
      :style="windowStyle"
      role="dialog"
      aria-label="BZSS Super Weather"
    >
      <header class="window-header" @pointerdown="beginDrag">
        <div class="window-title">
          <span class="weather-mark">SW</span>
          <div><strong>BZSS SUPER WEATHER</strong><small>RCON-ANCHORED WEATHER ORCHESTRATOR</small></div>
        </div>
        <div class="window-controls" @pointerdown.stop>
          <button type="button" title="Minimize" @click="toggleMinimized">_</button>
          <button type="button" title="Maximize" @click="toggleMaximized">□</button>
          <button type="button" title="Close" @click="closeWindow">×</button>
        </div>
      </header>

      <div v-if="!windowState.minimized" class="window-body">
        <div class="preset-bar">
          <label>
            <span>Preset</span>
            <select :value="selectedPresetId" :disabled="busy" @change="selectPreset(($event.target as HTMLSelectElement).value)">
              <option v-for="preset in presets" :key="preset.id" :value="preset.id">{{ preset.name }} · v{{ preset.version }}</option>
            </select>
          </label>
          <label v-if="draft" class="preset-name">
            <span>Preset name</span>
            <input v-model.trim="draft.name" type="text" maxlength="80" />
          </label>
          <button type="button" @click="createNewPreset">New</button>
          <button type="button" :disabled="!selectedPresetId" @click="duplicateCurrent">Duplicate</button>
          <button type="button" class="danger" :disabled="!selectedPresetId || state?.activePresetId === selectedPresetId" @click="removeCurrent">Delete</button>
          <span v-if="dirty" class="dirty-badge">UNSAVED CHANGES</span>
          <span class="runtime-badge" :data-state="state?.clockState ?? 'WAITING_RCON'">
            <i></i>{{ state?.clockState ?? "WAITING_RCON" }}
          </span>
        </div>

        <div class="clock-grid">
          <div><span>RCON RECORD</span><strong>{{ formatClock(state?.rawRconSeconds) }}</strong></div>
          <div><span>LOGICAL</span><strong>{{ formatClock(state?.logicalSeconds) }}</strong></div>
          <div><span>DRIFT</span><strong>{{ formatDrift(state?.clockDriftSeconds) }}</strong></div>
          <div><span>ROUND KEY</span><strong class="round-key">{{ state?.roundKey || "WAITING" }}</strong></div>
          <div><span>LAST COMMAND</span><strong class="last-command">{{ state?.lastCommand || "--" }}</strong></div>
        </div>

        <div v-if="error" class="error-banner">{{ error }}</div>
        <div v-if="loading" class="loading-state">Loading Super Weather runtime…</div>
        <template v-else-if="draft">
          <div class="editor-grid">
            <div class="timeline-area">
              <div class="timeline-scroll">
                <WeatherTimeline
                  :timeline="draft.timeline"
                  :selected-id="selectedSegmentId"
                  :current-segment-id="state?.currentSegment?.segmentId"
                  :current-transition-node-id="state?.currentSegment?.transitionRemainingSeconds
                    ? state?.currentSegment?.transitionNodeId
                    : null"
                  :logical-seconds="state?.logicalSeconds"
                  :workspace-seconds="workspaceSeconds"
                  @select="selectedSegmentId = $event"
                  @workspace-change="setWorkspaceSeconds"
                  @update-duration="updateTimelineDuration"
                  @update-boundary="updateTimelineBoundary"
                  @reorder="reorderWeather"
                />
              </div>
              <button type="button" class="add-weather" @click="addWeather">+ Weather</button>
            </div>
            <WeatherInspector
              :weather="selectedWeather"
              :transition="selectedTransition"
              :weather-count="weatherCount"
              @update-weather="updateSelectedWeather"
              @update-transition="updateSelectedTransition"
              @delete="deleteSelectedWeather"
            />
          </div>

          <div class="action-bar">
            <button type="button" class="primary" :disabled="busy || !dirty" @click="saveDraft">Save</button>
            <button type="button" :disabled="busy || dirty" @click="activateCurrent">Activate</button>
            <button type="button" :disabled="busy || dirty || state?.activePresetId !== selectedPresetId" @click="applyToRunning">Apply To Running</button>
            <button type="button" :disabled="busy || !state?.running" @click="stopRunning">Stop</button>
            <button type="button" :disabled="busy || !state?.running" @click="reconcileNow">Reconcile Now</button>
            <button type="button" :disabled="busy || !selectedWeather" @click="testSelectedWeather">Test Selected</button>
            <span class="action-note">Save updates the preset only. Apply explicitly reloads the running timeline.</span>
          </div>

          <details class="diagnostics">
            <summary>Scheduler Diagnostics <span>{{ state?.diagnostics?.length ?? 0 }} / 100</span></summary>
            <div class="debug-grid">
              <span>Current Segment</span><strong>{{ state?.currentSegment?.segmentId || "--" }}</strong>
              <span>Theoretical Weather</span><strong>{{ weatherLabel(state?.currentSegment?.currentWeather) }}</strong>
              <span>Target Weather</span><strong>{{ weatherLabel(state?.currentSegment?.targetWeather) }}</strong>
              <span>Transition Command Remaining</span><strong>{{ state?.currentSegment?.transitionRemainingSeconds ?? 0 }}s</strong>
              <span>Timeline Position</span><strong>{{ formatClock(state?.currentSegment?.timelinePositionSeconds) }}</strong>
              <span>Next Segment</span><strong>{{ state?.nextSegment?.id || "HOLD LAST" }}</strong>
              <span>Next Action Time</span><strong>{{ formatClock(state?.nextActionSeconds) }}</strong>
            </div>
            <div class="diagnostic-log">
              <div v-for="entry in state?.diagnostics ?? []" :key="`${entry.at}-${entry.type}-${entry.message}`">
                <time>{{ formatLogTime(entry.at) }}</time><b>{{ entry.type.replace('SUPER_WEATHER_', '') }}</b><span>{{ entry.message }}</span>
              </div>
              <p v-if="!state?.diagnostics?.length">No scheduler events yet.</p>
            </div>
          </details>
        </template>
      </div>

      <button
        v-if="!windowState.minimized && !maximized"
        type="button"
        class="resize-handle"
        aria-label="Resize Super Weather window"
        title="Resize window"
        @pointerdown.stop.prevent="beginResize"
      ></button>
    </section>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import {
  SUPER_WEATHER_NAMES,
  activatePreset,
  createPreset,
  deletePreset,
  duplicatePreset,
  fetchPresets,
  fetchState,
  reconcile,
  stopSuperWeather,
  testWeather,
  updatePreset,
  type SuperWeatherPreset,
  type SuperWeatherState,
  type SuperWeatherWeatherSegment,
} from "../../app/superWeatherApi";
import { useUiStore } from "../../stores/ui.store";
import WeatherTimeline from "./WeatherTimeline.vue";
import WeatherInspector from "./WeatherInspector.vue";

const STORAGE_KEY = "bzss.super-weather.window";
const WORKSPACE_STORAGE_KEY = "bzss.super-weather.timeline-workspace";
const WINDOW_STATE_VERSION = 2;
const DEFAULT_WORKSPACE_SECONDS = 2 * 60 * 60;
const ALLOWED_WORKSPACE_SECONDS = new Set([2 * 60 * 60, 6 * 60 * 60]);
const MIN_WINDOW_WIDTH = 360;
const MIN_WINDOW_HEIGHT = 300;
const DEFAULT_WINDOW = { version: WINDOW_STATE_VERSION, x: 220, y: 140, width: 1200, height: 680, minimized: false };
const ui = useUiStore();
const visible = ref(false);
const loading = ref(false);
const busy = ref(false);
const error = ref("");
const presets = ref<SuperWeatherPreset[]>([]);
const state = ref<SuperWeatherState | null>(null);
const selectedPresetId = ref("");
const selectedSegmentId = ref("");
const draft = ref<SuperWeatherPreset | null>(null);
const saved = ref<SuperWeatherPreset | null>(null);
const windowEl = ref<HTMLElement | null>(null);
const maximized = ref(false);
const windowState = reactive(loadWindowState());
const workspaceSeconds = ref(loadWorkspaceSeconds());
let pollTimer: number | null = null;
let dragState: { pointerId: number; offsetX: number; offsetY: number } | null = null;
let resizeState: {
  pointerId: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
} | null = null;

const windowStyle = computed(() => maximized.value ? {} : {
  left: `${windowState.x}px`,
  top: `${windowState.y}px`,
  width: `${windowState.width}px`,
  height: windowState.minimized ? "52px" : `${windowState.height}px`,
});
const dirty = computed(() => Boolean(draft.value && saved.value && JSON.stringify(editable(draft.value)) !== JSON.stringify(editable(saved.value))));
const selectedWeather = computed(() => selectedSegmentId.value.startsWith("transition:")
  ? null
  : draft.value?.timeline.find((item) => item.id === selectedSegmentId.value) ?? null);
const weatherCount = computed(() => draft.value?.timeline.length ?? 0);
const selectedTransition = computed(() => {
  if (!selectedSegmentId.value.startsWith("transition:")) return null;
  const timeline = draft.value?.timeline ?? [];
  const sourceId = selectedSegmentId.value.slice("transition:".length);
  const index = timeline.findIndex((item) => item.id === sourceId);
  const source = timeline[index];
  const target = timeline[index + 1];
  if (!source || !target) return null;
  return {
    sourceId: source.id,
    fromWeather: source.weatherType,
    toWeather: target.weatherType,
    seconds: source.transitionToNextSeconds,
  };
});

onMounted(() => {
  window.addEventListener("bzss:super-weather-open", openWindow);
  window.addEventListener("resize", clampWindow);
});

onBeforeUnmount(() => {
  window.removeEventListener("bzss:super-weather-open", openWindow);
  window.removeEventListener("resize", clampWindow);
  stopPolling();
  stopDrag();
  stopResize();
});

async function openWindow() {
  visible.value = true;
  await nextTick();
  clampWindow();
  startPolling();
  await loadAll();
}

function closeWindow() {
  visible.value = false;
  stopPolling();
  persistWindowState();
}

async function loadAll() {
  loading.value = true;
  error.value = "";
  try {
    const [nextPresets, nextState] = await Promise.all([fetchPresets(), fetchState()]);
    presets.value = nextPresets;
    state.value = nextState;
    const nextId = presets.value.some((item) => item.id === selectedPresetId.value)
      ? selectedPresetId.value
      : nextState.activePresetId && presets.value.some((item) => item.id === nextState.activePresetId)
        ? nextState.activePresetId
        : presets.value[0]?.id ?? "";
    selectPreset(nextId);
  } catch (reason: any) {
    error.value = reason?.message || "Unable to load Super Weather.";
  } finally {
    loading.value = false;
  }
}

function startPolling() {
  stopPolling();
  pollTimer = window.setInterval(async () => {
    try { state.value = await fetchState(); } catch {}
  }, 1000);
}
function stopPolling() {
  if (pollTimer != null) window.clearInterval(pollTimer);
  pollTimer = null;
}

function selectPreset(id: string) {
  const preset = presets.value.find((item) => item.id === id) ?? null;
  selectedPresetId.value = preset?.id ?? "";
  saved.value = clone(preset);
  draft.value = clone(preset);
  selectedSegmentId.value = preset?.timeline[0]?.id ?? "";
}

async function saveDraft() {
  if (!draft.value || !dirty.value) return;
  await runAction(async () => {
    const updated = await updatePreset(draft.value!.id, editable(draft.value!));
    replacePreset(updated);
    selectPreset(updated.id);
    toast("Preset saved", `${updated.name} is now version ${updated.version}.`);
  });
}

async function createNewPreset() {
  await runAction(async () => {
    const created = await createPreset({
      name: `Weather Preset ${presets.value.length + 1}`,
      timeline: [{
        id: makeId("weather"),
        type: "weather",
        weatherType: 0,
        durationSeconds: 1800,
        transitionToNextSeconds: 0,
      }],
      endBehavior: "hold_last",
    });
    presets.value.push(created);
    selectPreset(created.id);
    toast("Preset created", created.name);
  });
}

async function duplicateCurrent() {
  if (!selectedPresetId.value) return;
  await runAction(async () => {
    const created = await duplicatePreset(selectedPresetId.value);
    presets.value.push(created);
    selectPreset(created.id);
    toast("Preset duplicated", created.name);
  });
}

async function removeCurrent() {
  const preset = saved.value;
  if (!preset || !window.confirm(`Delete preset “${preset.name}”?`)) return;
  await runAction(async () => {
    await deletePreset(preset.id);
    presets.value = presets.value.filter((item) => item.id !== preset.id);
    selectPreset(presets.value[0]?.id ?? "");
    toast("Preset deleted", preset.name);
  });
}

async function activateCurrent() {
  if (!selectedPresetId.value || dirty.value) return;
  await runAction(async () => {
    state.value = await activatePreset(selectedPresetId.value);
    toast("Super Weather activated", saved.value?.name ?? selectedPresetId.value);
  });
}
async function applyToRunning() { await activateCurrent(); }
async function stopRunning() {
  await runAction(async () => {
    state.value = await stopSuperWeather();
    toast("Scheduler stopped", "The current server weather was not changed.");
  });
}
async function reconcileNow() {
  await runAction(async () => {
    state.value = await reconcile();
    toast("Reconciled", state.value.lastCommand || "Current timeline state verified.");
  });
}
async function testSelectedWeather() {
  if (!selectedWeather.value) return;
  await runAction(async () => {
    await testWeather(selectedWeather.value!.weatherType, 0);
    toast("Test weather sent", weatherLabel(selectedWeather.value?.weatherType));
  });
}

function addWeather() {
  if (!draft.value) return;
  const previous = draft.value.timeline.at(-1);
  if (previous) previous.transitionToNextSeconds = 120;
  draft.value.timeline.push({
    id: makeId("weather"),
    type: "weather",
    weatherType: 0,
    durationSeconds: 900,
    transitionToNextSeconds: 0,
  });
  selectedSegmentId.value = draft.value.timeline.at(-1)?.id ?? "";
}

function updateSelectedWeather(patch: { weatherType?: number; durationSeconds?: number }) {
  if (!draft.value) return;
  const index = draft.value.timeline.findIndex((item) => item.id === selectedSegmentId.value);
  if (index < 0) return;
  draft.value.timeline[index] = { ...draft.value.timeline[index], ...patch } as SuperWeatherWeatherSegment;
}

function updateSelectedTransition(seconds: number) {
  if (!draft.value || !selectedTransition.value) return;
  const source = draft.value.timeline.find((item) => item.id === selectedTransition.value?.sourceId);
  if (source) source.transitionToNextSeconds = Math.max(0, Math.floor(seconds));
}

function updateTimelineDuration(id: string, durationSeconds: number) {
  const segment = draft.value?.timeline.find((item) => item.id === id);
  if (segment) segment.durationSeconds = Math.max(1, Math.floor(durationSeconds));
}

function updateTimelineBoundary(
  currentId: string,
  currentDurationSeconds: number,
  previousId: string,
  previousDurationSeconds: number,
) {
  if (!draft.value) return;
  const current = draft.value.timeline.find((item) => item.id === currentId);
  const previous = draft.value.timeline.find((item) => item.id === previousId);
  if (!current || !previous) return;
  current.durationSeconds = Math.max(10, Math.floor(currentDurationSeconds));
  previous.durationSeconds = Math.max(10, Math.floor(previousDurationSeconds));
}

function setWorkspaceSeconds(value: number) {
  const next = Number(value);
  if (!ALLOWED_WORKSPACE_SECONDS.has(next)) return;
  workspaceSeconds.value = next;
  localStorage.setItem(WORKSPACE_STORAGE_KEY, String(next));
}

function reorderWeather(fromId: string, toId: string) {
  if (!draft.value) return;
  const timeline = draft.value.timeline;
  const fromIndex = timeline.findIndex((item) => item.id === fromId);
  const toIndex = timeline.findIndex((item) => item.id === toId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
  const [moved] = timeline.splice(fromIndex, 1);
  timeline.splice(toIndex, 0, moved);
  timeline.at(-1)!.transitionToNextSeconds = 0;
  selectedSegmentId.value = moved.id;
}

function deleteSelectedWeather() {
  if (!draft.value || !selectedWeather.value || weatherCount.value <= 1) return;
  const index = draft.value.timeline.findIndex((item) => item.id === selectedSegmentId.value);
  if (index < 0) return;
  draft.value.timeline.splice(index, 1);
  draft.value.timeline.at(-1)!.transitionToNextSeconds = 0;
  selectedSegmentId.value = draft.value.timeline[Math.max(0, index - 1)]?.id ?? draft.value.timeline[0]?.id ?? "";
}

async function runAction(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try { await action(); }
  catch (reason: any) {
    error.value = reason?.message || "Super Weather action failed.";
    ui.pushToast({ title: "Super Weather error", message: error.value, tone: "error", durationMs: 7000 });
  } finally { busy.value = false; }
}

function replacePreset(preset: SuperWeatherPreset) {
  const index = presets.value.findIndex((item) => item.id === preset.id);
  if (index >= 0) presets.value[index] = preset;
  else presets.value.push(preset);
}
function toast(title: string, message: string) { ui.pushToast({ title, message, tone: "ok" }); }

function beginDrag(event: PointerEvent) {
  if (maximized.value || windowState.minimized && (event.target as HTMLElement)?.closest("button")) return;
  dragState = { pointerId: event.pointerId, offsetX: event.clientX - windowState.x, offsetY: event.clientY - windowState.y };
  window.addEventListener("pointermove", dragWindow);
  window.addEventListener("pointerup", stopDrag);
  window.addEventListener("pointercancel", stopDrag);
}
function dragWindow(event: PointerEvent) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  windowState.x = Math.max(0, Math.min(window.innerWidth - 180, event.clientX - dragState.offsetX));
  windowState.y = Math.max(0, Math.min(window.innerHeight - 52, event.clientY - dragState.offsetY));
}
function stopDrag() {
  if (dragState) persistWindowState();
  dragState = null;
  window.removeEventListener("pointermove", dragWindow);
  window.removeEventListener("pointerup", stopDrag);
  window.removeEventListener("pointercancel", stopDrag);
}
function toggleMinimized() { windowState.minimized = !windowState.minimized; persistWindowState(); }
function toggleMaximized() { maximized.value = !maximized.value; }

function beginResize(event: PointerEvent) {
  if (maximized.value || windowState.minimized || !windowEl.value) return;
  const rect = windowEl.value.getBoundingClientRect();
  resizeState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startWidth: rect.width,
    startHeight: rect.height,
  };
  window.addEventListener("pointermove", resizeWindow);
  window.addEventListener("pointerup", stopResize);
  window.addEventListener("pointercancel", stopResize);
}
function resizeWindow(event: PointerEvent) {
  if (!resizeState || event.pointerId !== resizeState.pointerId) return;
  const maxWidth = Math.max(MIN_WINDOW_WIDTH, window.innerWidth - windowState.x - 8);
  const maxHeight = Math.max(MIN_WINDOW_HEIGHT, window.innerHeight - windowState.y - 8);
  windowState.width = Math.round(Math.max(MIN_WINDOW_WIDTH, Math.min(maxWidth, resizeState.startWidth + event.clientX - resizeState.startX)));
  windowState.height = Math.round(Math.max(MIN_WINDOW_HEIGHT, Math.min(maxHeight, resizeState.startHeight + event.clientY - resizeState.startY)));
}
function stopResize() {
  if (resizeState) persistWindowState();
  resizeState = null;
  window.removeEventListener("pointermove", resizeWindow);
  window.removeEventListener("pointerup", stopResize);
  window.removeEventListener("pointercancel", stopResize);
}
function clampWindow() {
  windowState.x = Math.max(0, Math.min(windowState.x, window.innerWidth - Math.min(180, windowState.width)));
  windowState.y = Math.max(0, Math.min(windowState.y, window.innerHeight - 52));
}
function loadWindowState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (saved.version !== WINDOW_STATE_VERSION) {
      return {
        ...DEFAULT_WINDOW,
        x: Number.isFinite(saved.x) ? saved.x : DEFAULT_WINDOW.x,
        y: Number.isFinite(saved.y) ? saved.y : DEFAULT_WINDOW.y,
        minimized: Boolean(saved.minimized),
        width: Math.min(DEFAULT_WINDOW.width, Math.max(MIN_WINDOW_WIDTH, window.innerWidth - 16)),
        height: Math.min(DEFAULT_WINDOW.height, Math.max(MIN_WINDOW_HEIGHT, window.innerHeight - 16)),
      };
    }
    return {
      ...DEFAULT_WINDOW,
      ...saved,
      width: Math.max(MIN_WINDOW_WIDTH, Number(saved.width) || DEFAULT_WINDOW.width),
      height: Math.max(MIN_WINDOW_HEIGHT, Number(saved.height) || DEFAULT_WINDOW.height),
    };
  }
  catch { return { ...DEFAULT_WINDOW }; }
}
function persistWindowState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(windowState)); }
function loadWorkspaceSeconds() {
  const value = Number(localStorage.getItem(WORKSPACE_STORAGE_KEY));
  return ALLOWED_WORKSPACE_SECONDS.has(value) ? value : DEFAULT_WORKSPACE_SECONDS;
}

function editable(preset: SuperWeatherPreset) { return { name: preset.name, timeline: preset.timeline, endBehavior: "hold_last" as const }; }
function clone<T>(value: T): T { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function makeId(prefix: string) { return `${prefix}-${typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`; }
function weatherLabel(value: number | null | undefined) { return value == null ? "--" : `${value} · ${SUPER_WEATHER_NAMES[value] ?? "Unknown"}`; }
function formatClock(value: number | null | undefined) {
  if (!Number.isFinite(Number(value))) return "--:--";
  const seconds = Math.max(0, Math.floor(Number(value)));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0 ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
function formatDrift(value: number | null | undefined) { const drift = Number(value) || 0; return `${drift >= 0 ? "+" : ""}${drift.toFixed(1)}s`; }
function formatLogTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "--:--:--" : date.toLocaleTimeString([], { hour12: false }); }
</script>

<style scoped>
.super-weather-window {
  position: fixed;
  z-index: 12000;
  box-sizing: border-box;
  min-width: min(360px, calc(100vw - 8px));
  min-height: 300px;
  max-width: calc(100vw - 8px);
  max-height: 1200px;
  resize: none;
  overflow: hidden;
  border: 1px solid rgba(94, 194, 240, .28);
  border-radius: 15px;
  background: rgba(5, 13, 23, .97);
  color: #e8f5fc;
  box-shadow: 0 26px 90px rgba(0, 0, 0, .62), 0 0 45px rgba(20, 142, 208, .08);
  backdrop-filter: blur(18px);
}
.super-weather-window.minimized { min-height: 52px; resize: none; }
.super-weather-window.maximized { inset: 8px; width: auto; height: auto; max-width: none; max-height: none; resize: none; }
.resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  z-index: 2;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  background: linear-gradient(135deg, transparent 0 48%, rgba(111, 211, 251, .18) 49% 58%, transparent 59% 66%, rgba(111, 211, 251, .55) 67% 74%, transparent 75%);
  cursor: nwse-resize;
  touch-action: none;
}
.resize-handle:hover { background-color: rgba(50, 173, 222, .08); }
.window-header { height: 52px; padding: 0 12px 0 16px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(102, 166, 195, .16); background: linear-gradient(90deg, rgba(17, 58, 81, .92), rgba(7, 18, 30, .96)); cursor: move; user-select: none; touch-action: none; }
.window-title { display: flex; align-items: center; gap: 11px; }
.window-title div { display: grid; gap: 2px; }
.window-title strong { font-size: 12px; letter-spacing: .08em; }
.window-title small { color: rgba(163, 205, 226, .5); font-size: 7px; letter-spacing: .16em; }
.weather-mark { display: grid; place-items: center; width: 29px; height: 29px; border: 1px solid rgba(81, 205, 255, .48); border-radius: 8px; color: #6adaff; background: rgba(29, 160, 215, .12); font-size: 10px; font-weight: 900; box-shadow: 0 0 18px rgba(40, 182, 237, .16); }
.window-controls { display: flex; gap: 4px; }
.window-controls button { width: 29px; height: 29px; border: 0; border-radius: 7px; background: transparent; color: rgba(218, 235, 244, .68); }
.window-controls button:hover { background: rgba(116, 178, 207, .15); color: white; }
.window-body { height: calc(100% - 52px); overflow: auto; padding: 14px; display: grid; align-content: start; gap: 13px; }
.preset-bar { display: flex; align-items: end; flex-wrap: wrap; gap: 8px; }
.preset-bar label { display: grid; gap: 4px; min-width: 230px; }
.preset-bar label span, .clock-grid span { color: rgba(175, 207, 224, .56); font-size: 8px; letter-spacing: .14em; }
.preset-bar select, .preset-bar input, .preset-bar button, .action-bar button, .add-weather { height: 34px; padding: 0 11px; border: 1px solid rgba(106, 161, 187, .22); border-radius: 8px; background: rgba(11, 29, 43, .9); color: #e5f4fb; font-size: 11px; }
.preset-bar select { min-width: 230px; }
.preset-bar .preset-name { min-width: 180px; }
button:hover:not(:disabled) { border-color: rgba(93, 207, 255, .56); background-color: rgba(20, 61, 82, .96); }
button:disabled { opacity: .38; cursor: not-allowed; }
.danger { color: #ff9ca6 !important; }
.dirty-badge { align-self: center; padding: 5px 8px; border: 1px solid rgba(248, 196, 79, .3); border-radius: 999px; color: #ffd66c; background: rgba(248, 196, 79, .08); font-size: 8px; letter-spacing: .12em; }
.runtime-badge { margin-left: auto; align-self: center; display: flex; align-items: center; gap: 7px; padding: 7px 10px; border: 1px solid rgba(72, 210, 146, .25); border-radius: 999px; color: #7ce5b1; font-size: 9px; }
.runtime-badge i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 9px currentColor; }
.runtime-badge[data-state="CLOCK_STALE"], .runtime-badge[data-state="ERROR"] { color: #ff9b72; border-color: rgba(255, 133, 91, .3); }
.clock-grid { display: grid; grid-template-columns: repeat(3, minmax(100px, .7fr)) minmax(180px, 1.3fr) minmax(200px, 1.5fr); gap: 8px; }
.clock-grid > div { min-width: 0; padding: 10px 12px; border: 1px solid rgba(104, 158, 185, .15); border-radius: 10px; background: rgba(10, 25, 38, .66); display: grid; gap: 5px; }
.clock-grid strong { font: 15px ui-monospace, monospace; color: #dff5ff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.clock-grid .round-key, .clock-grid .last-command { font-size: 10px; color: #9ec8dc; }
.editor-grid { min-height: 245px; display: grid; grid-template-columns: minmax(0, 1fr) 238px; gap: 10px; }
.timeline-area { min-width: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 9px; padding: 12px; border: 1px solid rgba(111, 166, 192, .16); border-radius: 12px; background: rgba(4, 12, 21, .56); }
.timeline-scroll { min-width: 0; overflow-x: auto; padding: 4px 1px 10px; }
.add-weather { justify-self: start; color: #76d9ff; }
.action-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
.action-bar .primary { border-color: rgba(70, 198, 255, .48); color: #8ee3ff; background: rgba(20, 116, 158, .22); }
.action-note { margin-left: auto; max-width: 310px; color: rgba(177, 205, 219, .46); font-size: 9px; text-align: right; }
.diagnostics { border: 1px solid rgba(108, 159, 185, .16); border-radius: 10px; background: rgba(5, 15, 25, .68); }
.diagnostics summary { padding: 10px 12px; cursor: pointer; color: #a8cadd; font-size: 10px; letter-spacing: .06em; }
.diagnostics summary span { float: right; color: rgba(166, 200, 217, .42); }
.debug-grid { display: grid; grid-template-columns: repeat(6, auto); gap: 7px 13px; padding: 0 12px 11px; font-size: 9px; }
.debug-grid span { color: rgba(168, 198, 214, .48); }
.debug-grid strong { color: #d8edf7; font-family: ui-monospace, monospace; }
.diagnostic-log { max-height: 160px; overflow: auto; border-top: 1px solid rgba(106, 157, 181, .12); }
.diagnostic-log > div { display: grid; grid-template-columns: 72px 118px 1fr; gap: 8px; padding: 7px 12px; border-bottom: 1px solid rgba(103, 153, 177, .07); font-size: 9px; }
.diagnostic-log time { color: rgba(178, 205, 219, .45); font-family: ui-monospace, monospace; }
.diagnostic-log b { color: #6fd4f9; }
.diagnostic-log span { color: rgba(218, 235, 243, .72); }
.diagnostic-log p, .loading-state { padding: 20px; text-align: center; color: rgba(187, 215, 229, .5); }
.error-banner { padding: 9px 11px; border: 1px solid rgba(255, 99, 112, .28); border-radius: 8px; color: #ffacb3; background: rgba(153, 31, 48, .14); font-size: 11px; }
@media (max-width: 820px) {
  .editor-grid { grid-template-columns: 1fr; }
  .clock-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .debug-grid { grid-template-columns: repeat(2, auto); }
  .action-note { width: 100%; max-width: none; margin-left: 0; text-align: left; }
}
</style>
