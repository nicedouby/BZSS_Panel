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
      <header class="window-header" @pointerdown="beginDrag" @dblclick="toggleMaximized">
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
                  :logical-seconds="state?.logicalSeconds"
                  @select="selectedSegmentId = $event"
                />
              </div>
              <button type="button" class="add-weather" @click="addWeather">+ Weather</button>
            </div>
            <WeatherInspector
              :segment="selectedSegment"
              :from-weather="selectedNeighbors.from"
              :to-weather="selectedNeighbors.to"
              :weather-count="weatherCount"
              @update="updateSelectedSegment"
              @delete="deleteSelectedWeather"
            />
          </div>

          <div class="action-bar">
            <button type="button" class="primary" :disabled="busy || !dirty" @click="saveDraft">Save</button>
            <button type="button" :disabled="busy || dirty" @click="activateCurrent">Activate</button>
            <button type="button" :disabled="busy || dirty || state?.activePresetId !== selectedPresetId" @click="applyToRunning">Apply To Running</button>
            <button type="button" :disabled="busy || !state?.running" @click="stopRunning">Stop</button>
            <button type="button" :disabled="busy || !state?.running" @click="reconcileNow">Reconcile Now</button>
            <button type="button" :disabled="busy || selectedSegment?.type !== 'weather'" @click="testSelectedWeather">Test Selected</button>
            <span class="action-note">Save updates the preset only. Apply explicitly reloads the running timeline.</span>
          </div>

          <details class="diagnostics">
            <summary>Scheduler Diagnostics <span>{{ state?.diagnostics?.length ?? 0 }} / 100</span></summary>
            <div class="debug-grid">
              <span>Current Segment</span><strong>{{ state?.currentSegment?.segmentId || "--" }}</strong>
              <span>Theoretical Weather</span><strong>{{ weatherLabel(state?.currentSegment?.currentWeather) }}</strong>
              <span>Target Weather</span><strong>{{ weatherLabel(state?.currentSegment?.targetWeather) }}</strong>
              <span>Transition Remaining</span><strong>{{ state?.currentSegment?.transitionRemainingSeconds ?? 0 }}s</strong>
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
        class="window-resize-handle"
        aria-label="Resize Super Weather window"
        title="Resize window"
        @pointerdown.stop.prevent="beginResize"
      />
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
  type SuperWeatherSegment,
  type SuperWeatherState,
} from "../../app/superWeatherApi";
import { useUiStore } from "../../stores/ui.store";
import WeatherTimeline from "./WeatherTimeline.vue";
import WeatherInspector from "./WeatherInspector.vue";

const STORAGE_KEY = "bzss.super-weather.window";
const DEFAULT_WINDOW = { x: 220, y: 140, width: 1200, height: 680, minimized: false };
const MIN_WINDOW_WIDTH = 560;
const MIN_WINDOW_HEIGHT = 360;
const VIEWPORT_GAP = 8;
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
const selectedSegment = computed(() => draft.value?.timeline.find((item) => item.id === selectedSegmentId.value) ?? null);
const weatherCount = computed(() => draft.value?.timeline.filter((item) => item.type === "weather").length ?? 0);
const selectedNeighbors = computed(() => {
  const timeline = draft.value?.timeline ?? [];
  const index = timeline.findIndex((item) => item.id === selectedSegmentId.value);
  const previous = timeline[index - 1];
  const next = timeline[index + 1];
  return {
    from: previous?.type === "weather" ? previous.weatherType : null,
    to: next?.type === "weather" ? next.weatherType : null,
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
  const wasVisible = visible.value;
  visible.value = true;
  // An explicit menu action should reveal the full window. Keeping a persisted
  // minimized state here made the window look as though it collapsed by itself.
  windowState.minimized = false;
  await nextTick();
  clampWindow();
  startPolling();
  persistWindowState();
  if (!wasVisible || !state.value) await loadAll();
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
      timeline: [{ id: makeId("weather"), type: "weather", weatherType: 0, durationSeconds: 900 }],
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
  if (selectedSegment.value?.type !== "weather") return;
  await runAction(async () => {
    await testWeather(selectedSegment.value!.type === "weather" ? selectedSegment.value!.weatherType : 0, 0);
    toast("Test weather sent", weatherLabel(selectedSegment.value?.type === "weather" ? selectedSegment.value.weatherType : null));
  });
}

function addWeather() {
  if (!draft.value) return;
  draft.value.timeline.push(
    { id: makeId("transition"), type: "transition", durationSeconds: 120 },
    { id: makeId("weather"), type: "weather", weatherType: 0, durationSeconds: 900 },
  );
  selectedSegmentId.value = draft.value.timeline.at(-1)?.id ?? "";
}

function updateSelectedSegment(patch: Record<string, number>) {
  if (!draft.value) return;
  const index = draft.value.timeline.findIndex((item) => item.id === selectedSegmentId.value);
  if (index < 0) return;
  draft.value.timeline[index] = { ...draft.value.timeline[index], ...patch } as SuperWeatherSegment;
}

function deleteSelectedWeather() {
  if (!draft.value || selectedSegment.value?.type !== "weather" || weatherCount.value <= 1) return;
  const index = draft.value.timeline.findIndex((item) => item.id === selectedSegmentId.value);
  if (index < 0) return;
  if (index === 0) draft.value.timeline.splice(0, 2);
  else draft.value.timeline.splice(index - 1, 2);
  selectedSegmentId.value = draft.value.timeline[Math.max(0, index - 2)]?.id ?? draft.value.timeline[0]?.id ?? "";
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
  if (event.button !== 0 || maximized.value || (event.target as HTMLElement)?.closest("button")) return;
  event.preventDefault();
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

function beginResize(event: PointerEvent) {
  if (event.button !== 0 || maximized.value || windowState.minimized) return;
  clampWindow();
  resizeState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startWidth: windowEl.value?.getBoundingClientRect().width ?? windowState.width,
    startHeight: windowEl.value?.getBoundingClientRect().height ?? windowState.height,
  };
  document.body.classList.add("super-weather-resizing");
  window.addEventListener("pointermove", resizeWindow);
  window.addEventListener("pointerup", stopResize);
  window.addEventListener("pointercancel", stopResize);
}
function resizeWindow(event: PointerEvent) {
  if (!resizeState || event.pointerId !== resizeState.pointerId) return;
  const minWidth = Math.min(MIN_WINDOW_WIDTH, Math.max(320, window.innerWidth - VIEWPORT_GAP * 2));
  const minHeight = Math.min(MIN_WINDOW_HEIGHT, Math.max(240, window.innerHeight - VIEWPORT_GAP * 2));
  const maxWidth = Math.max(minWidth, window.innerWidth - windowState.x - VIEWPORT_GAP);
  const maxHeight = Math.max(minHeight, window.innerHeight - windowState.y - VIEWPORT_GAP);
  windowState.width = Math.round(Math.max(minWidth, Math.min(maxWidth, resizeState.startWidth + event.clientX - resizeState.startX)));
  windowState.height = Math.round(Math.max(minHeight, Math.min(maxHeight, resizeState.startHeight + event.clientY - resizeState.startY)));
}
function stopResize() {
  if (resizeState) persistWindowState();
  resizeState = null;
  document.body.classList.remove("super-weather-resizing");
  window.removeEventListener("pointermove", resizeWindow);
  window.removeEventListener("pointerup", stopResize);
  window.removeEventListener("pointercancel", stopResize);
}
function toggleMinimized() {
  windowState.minimized = !windowState.minimized;
  if (!windowState.minimized) nextTick(clampWindow);
  persistWindowState();
}
function toggleMaximized() {
  if (!maximized.value) windowState.minimized = false;
  maximized.value = !maximized.value;
  if (!maximized.value) nextTick(clampWindow);
}
function clampWindow() {
  const visibleWidth = Math.min(windowState.width, Math.max(320, window.innerWidth - VIEWPORT_GAP * 2));
  windowState.x = Math.max(0, Math.min(windowState.x, window.innerWidth - Math.min(180, visibleWidth)));
  windowState.y = Math.max(0, Math.min(windowState.y, window.innerHeight - 52));
}
function loadWindowState() {
  try {
    const stored = { ...DEFAULT_WINDOW, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
    return {
      x: Number.isFinite(Number(stored.x)) ? Math.max(0, Number(stored.x)) : DEFAULT_WINDOW.x,
      y: Number.isFinite(Number(stored.y)) ? Math.max(0, Number(stored.y)) : DEFAULT_WINDOW.y,
      width: Number.isFinite(Number(stored.width)) ? Math.max(MIN_WINDOW_WIDTH, Number(stored.width)) : DEFAULT_WINDOW.width,
      height: Number.isFinite(Number(stored.height)) ? Math.max(MIN_WINDOW_HEIGHT, Number(stored.height)) : DEFAULT_WINDOW.height,
      minimized: Boolean(stored.minimized),
    };
  }
  catch { return { ...DEFAULT_WINDOW }; }
}
function persistWindowState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(windowState)); }

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
  box-sizing: border-box;
  position: fixed;
  z-index: 12000;
  min-width: min(560px, calc(100vw - 16px));
  min-height: min(360px, calc(100vh - 16px));
  max-width: calc(100vw - 8px);
  max-height: calc(100vh - 8px);
  overflow: hidden;
  border: 1px solid rgba(94, 194, 240, .28);
  border-radius: 15px;
  background: rgba(5, 13, 23, .97);
  color: #e8f5fc;
  box-shadow: 0 26px 90px rgba(0, 0, 0, .62), 0 0 45px rgba(20, 142, 208, .08);
  backdrop-filter: blur(18px);
}
.super-weather-window.minimized { min-height: 52px; }
.super-weather-window.maximized { inset: 8px; width: auto; height: auto; max-width: none; max-height: none; }
.window-header { height: 52px; padding: 0 12px 0 16px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid rgba(102, 166, 195, .16); background: linear-gradient(90deg, rgba(17, 58, 81, .92), rgba(7, 18, 30, .96)); cursor: move; user-select: none; touch-action: none; }
.window-title { display: flex; align-items: center; gap: 11px; }
.window-title div { display: grid; gap: 2px; }
.window-title strong { font-size: 12px; letter-spacing: .08em; }
.window-title small { color: rgba(163, 205, 226, .5); font-size: 7px; letter-spacing: .16em; }
.weather-mark { display: grid; place-items: center; width: 29px; height: 29px; border: 1px solid rgba(81, 205, 255, .48); border-radius: 8px; color: #6adaff; background: rgba(29, 160, 215, .12); font-size: 10px; font-weight: 900; box-shadow: 0 0 18px rgba(40, 182, 237, .16); }
.window-controls { display: flex; gap: 4px; }
.window-controls button { width: 29px; height: 29px; border: 0; border-radius: 7px; background: transparent; color: rgba(218, 235, 244, .68); }
.window-controls button:hover { background: rgba(116, 178, 207, .15); color: white; }
.window-body { box-sizing: border-box; height: calc(100% - 52px); overflow: auto; padding: 14px; display: grid; align-content: start; gap: 13px; }
.window-resize-handle { position: absolute; right: 1px; bottom: 1px; z-index: 3; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 0 0 13px 0; background: linear-gradient(135deg, transparent 0 46%, rgba(102, 201, 239, .22) 47% 55%, transparent 56% 65%, rgba(102, 201, 239, .48) 66% 74%, transparent 75%); cursor: nwse-resize; touch-action: none; }
.window-resize-handle:hover { background: linear-gradient(135deg, transparent 0 42%, rgba(112, 218, 255, .35) 43% 53%, transparent 54% 62%, rgba(112, 218, 255, .78) 63% 75%, transparent 76%); }
:global(body.super-weather-resizing) { cursor: nwse-resize !important; user-select: none !important; }
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
