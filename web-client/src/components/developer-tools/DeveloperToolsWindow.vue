<template>
  <teleport to="body">
    <section
      v-if="visible"
      ref="windowEl"
      class="developer-tools-window"
      :class="{ minimized: windowState.minimized, maximized }"
      :style="windowStyle"
      role="dialog"
      aria-label="Developer tools"
    >
      <header class="window-header" @pointerdown="beginDrag">
        <div class="window-title">
          <span class="developer-mark">DEV</span>
          <div><strong>DEVELOPER CONSOLE</strong><small>REPOSITORY · BUILD · PROCESS CONTROL</small></div>
        </div>
        <div class="window-controls" @pointerdown.stop>
          <button type="button" title="Minimize" @click="toggleMinimized">_</button>
          <button type="button" title="Maximize" @click="toggleMaximized">□</button>
          <button type="button" title="Close" @click="closeWindow">×</button>
        </div>
      </header>

      <div v-if="!windowState.minimized" class="window-body">
        <div v-if="error" class="error-banner">{{ error }}</div>
        <section class="repository-card">
          <div><span>REMOTE</span><strong>{{ status?.remote || "Loading…" }}</strong></div>
          <div><span>BRANCH</span><strong>{{ status?.branch || "--" }}</strong></div>
          <div><span>REVISION</span><strong>{{ status?.revision || "--" }}</strong></div>
          <div><span>WORKTREE</span><strong :class="status?.dirty ? 'warning' : 'ready'">{{ status?.dirty ? "LOCAL CHANGES" : "CLEAN" }}</strong></div>
          <div class="repository-path"><span>RUNNING DIRECTORY</span><strong :title="status?.workingDirectory || status?.projectRoot">{{ status?.workingDirectory || status?.projectRoot || "--" }}</strong></div>
        </section>

        <p class="safety-note">只执行固定的 <code>git fetch</code>、<code>git pull --ff-only</code> 与 <code>npm run client:build</code>；不会接收任意终端命令。</p>

        <div class="actions-grid">
          <button type="button" :disabled="busy" @click="runOperation('fetch')"><b>Fetch remote</b><small>获取远程提交，不改动工作区</small></button>
          <button type="button" :disabled="busy || status?.dirty" @click="runOperation('pull')"><b>Pull update</b><small>只允许 fast-forward 合并</small></button>
          <button type="button" class="build-action" :disabled="busy" @click="runOperation('build')"><b>Build client</b><small>运行 npm run client:build</small></button>
          <button type="button" class="restart-action" :disabled="busy" @click="restartPanel"><b>Restart panel</b><small>停止当前 Panel 进程并启动新进程</small></button>
        </div>

        <section class="output-card">
          <div class="output-head"><strong>{{ busy ? `RUNNING: ${activeOperation}` : "COMMAND OUTPUT" }}</strong><button type="button" :disabled="!output" @click="output = ''">Clear</button></div>
          <pre>{{ output || "Ready. Select an operation above." }}</pre>
        </section>
      </div>

      <button v-if="!windowState.minimized && !maximized" type="button" class="resize-handle" aria-label="Resize developer tools window" @pointerdown.stop.prevent="beginResize"></button>
    </section>
  </teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { apiGet, apiPost } from "../../app/apiClient";
import { useUiStore } from "../../stores/ui.store";

type DeveloperStatus = { remote?: string; branch?: string; revision?: string; dirty?: boolean; busy?: boolean; activeOperation?: string | null; projectRoot?: string; workingDirectory?: string; nodePath?: string; entrypoint?: string | null };
type OperationResult = { ok: boolean; operation?: string; output?: string; message?: string };

const STORAGE_KEY = "bzss.developer-tools.window";
const MIN_WIDTH = 420;
const MIN_HEIGHT = 330;
const DEFAULT_WINDOW = { x: 260, y: 100, width: 720, height: 560, minimized: false };
const ui = useUiStore();
const visible = ref(false);
const busy = ref(false);
const activeOperation = ref("");
const error = ref("");
const output = ref("");
const status = ref<DeveloperStatus | null>(null);
const windowEl = ref<HTMLElement | null>(null);
const maximized = ref(false);
const windowState = reactive(loadWindowState());
let dragState: { offsetX: number; offsetY: number } | null = null;
let resizeState: { startX: number; startY: number; width: number; height: number } | null = null;

const windowStyle = computed(() => maximized.value ? {} : {
  left: `${windowState.x}px`, top: `${windowState.y}px`, width: `${windowState.width}px`, height: windowState.minimized ? "52px" : `${windowState.height}px`,
});

onMounted(() => {
  window.addEventListener("bzss:developer-tools-open", openWindow);
  window.addEventListener("resize", clampWindow);
});
onBeforeUnmount(() => {
  window.removeEventListener("bzss:developer-tools-open", openWindow);
  window.removeEventListener("resize", clampWindow);
  stopDrag(); stopResize();
});

async function openWindow() {
  visible.value = true;
  await nextTick();
  clampWindow();
  await refreshStatus();
}
function closeWindow() { visible.value = false; persist(); }
async function refreshStatus() {
  error.value = "";
  try { status.value = await apiGet<DeveloperStatus>("/api/developer-tools/status", {}, { timeoutMs: 20_000 }); }
  catch (cause: any) { error.value = cause?.message || "无法读取开发者工具状态。"; }
}
async function runOperation(operation: "fetch" | "pull" | "build") {
  busy.value = true; activeOperation.value = operation; error.value = ""; output.value = "";
  try {
    const result = await apiPost<OperationResult>("/api/developer-tools/run", { operation }, {}, { timeoutMs: operation === "build" ? 11 * 60_000 : 3 * 60_000 });
    output.value = result.output || `${operation} completed.`;
    ui.pushToast({ title: "开发者工具", message: `${operation} 已完成。`, tone: "ok" });
    await refreshStatus();
  } catch (cause: any) { error.value = cause?.message || `${operation} 失败。`; output.value = cause?.detail?.message || output.value; }
  finally { busy.value = false; activeOperation.value = ""; }
}
async function restartPanel() {
  if (!window.confirm("将停止当前 BZSS Panel 进程，然后自动启动新进程。确认重启吗？")) return;
  busy.value = true; activeOperation.value = "restart"; error.value = "";
  try {
    const result = await apiPost<OperationResult>("/api/developer-tools/restart", {}, {}, { timeoutMs: 10_000 });
    output.value = result.message || "Restart scheduled.";
    ui.pushToast({ title: "开发者工具", message: "Panel 正在重启，页面会短暂断开。", tone: "ok" });
  } catch (cause: any) { error.value = cause?.message || "重启计划失败。"; busy.value = false; activeOperation.value = ""; }
}
function beginDrag(event: PointerEvent) {
  if (maximized.value || (event.target as HTMLElement)?.closest("button")) return;
  dragState = { offsetX: event.clientX - windowState.x, offsetY: event.clientY - windowState.y };
  window.addEventListener("pointermove", drag); window.addEventListener("pointerup", stopDrag); window.addEventListener("pointercancel", stopDrag);
}
function drag(event: PointerEvent) { if (!dragState) return; windowState.x = Math.max(0, Math.min(window.innerWidth - 180, event.clientX - dragState.offsetX)); windowState.y = Math.max(0, Math.min(window.innerHeight - 52, event.clientY - dragState.offsetY)); }
function stopDrag() { if (dragState) persist(); dragState = null; window.removeEventListener("pointermove", drag); window.removeEventListener("pointerup", stopDrag); window.removeEventListener("pointercancel", stopDrag); }
function beginResize(event: PointerEvent) { if (!windowEl.value) return; const rect = windowEl.value.getBoundingClientRect(); resizeState = { startX: event.clientX, startY: event.clientY, width: rect.width, height: rect.height }; window.addEventListener("pointermove", resize); window.addEventListener("pointerup", stopResize); window.addEventListener("pointercancel", stopResize); }
function resize(event: PointerEvent) { if (!resizeState) return; windowState.width = Math.round(Math.max(MIN_WIDTH, Math.min(window.innerWidth - windowState.x - 8, resizeState.width + event.clientX - resizeState.startX))); windowState.height = Math.round(Math.max(MIN_HEIGHT, Math.min(window.innerHeight - windowState.y - 8, resizeState.height + event.clientY - resizeState.startY))); }
function stopResize() { if (resizeState) persist(); resizeState = null; window.removeEventListener("pointermove", resize); window.removeEventListener("pointerup", stopResize); window.removeEventListener("pointercancel", stopResize); }
function toggleMinimized() { windowState.minimized = !windowState.minimized; persist(); }
function toggleMaximized() { maximized.value = !maximized.value; }
function clampWindow() { windowState.x = Math.max(0, Math.min(windowState.x, window.innerWidth - Math.min(180, windowState.width))); windowState.y = Math.max(0, Math.min(windowState.y, window.innerHeight - 52)); }
function loadWindowState() { try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); return { ...DEFAULT_WINDOW, ...saved, width: Math.max(MIN_WIDTH, Number(saved.width || DEFAULT_WINDOW.width)), height: Math.max(MIN_HEIGHT, Number(saved.height || DEFAULT_WINDOW.height)) }; } catch { return { ...DEFAULT_WINDOW }; } }
function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(windowState)); }
</script>

<style scoped>
.developer-tools-window { position: fixed; z-index: 10020; display: flex; flex-direction: column; min-width: 420px; min-height: 52px; overflow: hidden; border: 1px solid rgba(113, 202, 238, .34); border-radius: 12px; background: rgba(6, 17, 28, .98); color: #dceefa; box-shadow: 0 22px 60px rgba(0, 0, 0, .55); }
.developer-tools-window.maximized { inset: 8px; width: auto; height: auto; max-width: none; max-height: none; }.window-header { height: 52px; flex: 0 0 52px; padding: 0 12px 0 16px; display: flex; align-items: center; justify-content: space-between; background: linear-gradient(90deg, #143d51, #07121d); border-bottom: 1px solid rgba(113, 202, 238, .2); cursor: move; user-select: none; }.window-title { display: flex; align-items: center; gap: 10px; }.window-title div { display: grid; gap: 2px; }.window-title strong { font-size: 12px; letter-spacing: .1em; }.window-title small { color: rgba(190, 224, 239, .52); font-size: 8px; letter-spacing: .14em; }.developer-mark { display: grid; place-items: center; width: 29px; height: 29px; border-radius: 7px; background: #1b9ec4; color: #021017; font-size: 9px; font-weight: 900; }.window-controls { display: flex; gap: 4px; }.window-controls button, .output-head button { border: 0; border-radius: 6px; background: transparent; color: rgba(218,235,244,.7); }.window-controls button { width: 29px; height: 29px; }.window-controls button:hover, .output-head button:hover { background: rgba(116,178,207,.16); color: white; }.window-body { min-height: 0; flex: 1; overflow: auto; padding: 16px; display: grid; align-content: start; gap: 14px; }.repository-card { display: grid; grid-template-columns: 1.8fr 1fr 1fr 1fr; gap: 1px; border: 1px solid rgba(119, 184, 213, .18); border-radius: 9px; overflow: hidden; background: rgba(117,180,208,.1); }.repository-card div { min-width: 0; padding: 10px; display: grid; gap: 4px; background: rgba(8, 25, 38, .88); }.repository-card span { font-size: 8px; letter-spacing: .12em; color: rgba(183,219,235,.55); }.repository-path { grid-column: 1 / -1; border-top: 1px solid rgba(119, 184, 213, .12); }
.repository-path strong { color: #8edbf3; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; }
.repository-card strong { overflow: hidden; color: #d5edfa; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }.ready { color: #62d99a !important; }.warning { color: #f6c35d !important; }.safety-note { margin: 0; color: rgba(198,224,236,.65); font-size: 12px; line-height: 1.55; }.safety-note code { color: #8edbf3; }.actions-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }.actions-grid button { min-height: 66px; padding: 11px; display: grid; gap: 5px; text-align: left; border: 1px solid rgba(104,183,214,.27); border-radius: 9px; background: rgba(22,64,83,.5); color: #e7f7ff; }.actions-grid button:hover:not(:disabled) { background: rgba(28,93,120,.72); border-color: rgba(119,215,252,.64); }.actions-grid button:disabled { opacity: .45; cursor: not-allowed; }.actions-grid b { font-size: 13px; }.actions-grid small { color: rgba(196,226,239,.58); }.build-action { border-color: rgba(91,179,238,.45) !important; }.restart-action { border-color: rgba(244,163,81,.46) !important; }.output-card { min-height: 170px; border: 1px solid rgba(109,177,204,.18); border-radius: 9px; overflow: hidden; background: #030b11; }.output-head { padding: 8px 10px; display: flex; justify-content: space-between; border-bottom: 1px solid rgba(109,177,204,.14); color: rgba(190,226,241,.7); font-size: 9px; letter-spacing: .12em; }.output-head button { padding: 2px 6px; }.output-card pre { min-height: 130px; max-height: 250px; margin: 0; padding: 11px; overflow: auto; color: #a8d4e7; font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; }.error-banner { padding: 10px; border: 1px solid rgba(244,112,112,.42); border-radius: 8px; background: rgba(119, 25, 25, .25); color: #ffb4b4; font-size: 12px; }.resize-handle { position: absolute; right: 2px; bottom: 2px; width: 18px; height: 18px; border: 0; cursor: nwse-resize; background: linear-gradient(135deg, transparent 45%, rgba(139,204,229,.65) 46%, rgba(139,204,229,.65) 54%, transparent 55%); }
@media (max-width: 700px) { .developer-tools-window { min-width: min(420px, calc(100vw - 16px)); }.repository-card { grid-template-columns: 1fr 1fr; }.actions-grid { grid-template-columns: 1fr; } }
</style>
