<template>
  <div class="timeline-shell">
    <div class="timeline-summary">
      <div class="timeline-summary-copy">
        <span>{{ formatWorkspace(workspaceSeconds) }} EDIT RANGE</span>
        <strong>Weather total {{ formatDuration(totalSeconds) }}</strong>
        <small>Drag blocks to reorder · drag either boundary to change intervals · click arrows to edit Transition</small>
      </div>
      <label class="workspace-picker">
        <span>VISIBLE RANGE</span>
        <select :value="workspaceSeconds" @change="$emit('workspace-change', Number(($event.target as HTMLSelectElement).value))">
          <option :value="2 * 60 * 60">02:00:00 · Typical match</option>
          <option :value="6 * 60 * 60">06:00:00 · Extended workspace</option>
        </select>
      </label>
    </div>
    <div
      ref="track"
      class="timeline-track"
      :style="{ width: `${canvasWidth}px` }"
      @dragover.prevent
    >
      <div class="timeline-ruler">
        <span
          v-for="tick in rulerTicks"
          :key="tick.seconds"
          class="ruler-tick"
          :class="{ major: tick.seconds % 1800 === 0 }"
          :style="{ left: `${tick.percent}%` }"
        >{{ formatTick(tick.seconds) }}</span>
      </div>

      <div
        v-if="logicalSeconds != null && displaySeconds > 0"
        class="playhead"
        :style="{ left: `${playheadPercent}%` }"
      >
        <span>{{ formatDuration(logicalSeconds) }}</span>
      </div>

      <template v-for="item in layout" :key="item.segment.id">
        <WeatherBlock
          :segment="item.segment"
          :start-seconds="item.startSeconds"
          :end-seconds="item.endSeconds"
          :left-percent="item.leftPercent"
          :width-percent="item.widthPercent"
          :can-resize-left="item.index > 0"
          :selected="item.segment.id === selectedId"
          :current="item.segment.id === currentSegmentId"
          :dragging="item.segment.id === draggingId"
          @select="$emit('select', item.segment.id)"
          @resize-start="beginDurationResize($event.event, item.segment, $event.side)"
          @drag-start="beginReorder($event, item.segment.id)"
          @drag-end="draggingId = ''"
          @drop="dropOn(item.segment.id)"
        />
        <TransitionNode
          v-if="item.next"
          :source="item.segment"
          :target="item.next"
          :left-percent="item.endPercent"
          :selected="selectedId === transitionId(item.segment.id)"
          :current="currentTransitionNodeId === transitionId(item.segment.id)"
          @select="$emit('select', transitionId(item.segment.id))"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type { SuperWeatherSegment, SuperWeatherWeatherSegment } from "../../app/superWeatherApi";
import TransitionNode from "./TransitionNode.vue";
import WeatherBlock from "./WeatherBlock.vue";

const DEFAULT_WORKSPACE_SECONDS = 2 * 60 * 60;
const MIN_CANVAS_WIDTH = 1440;
const MIN_SEGMENT_SECONDS = 10;
const props = defineProps<{
  timeline: SuperWeatherSegment[];
  selectedId?: string;
  currentSegmentId?: string;
  currentTransitionNodeId?: string | null;
  logicalSeconds?: number | null;
  workspaceSeconds?: number;
}>();
const emit = defineEmits<{
  select: [id: string];
  "workspace-change": [seconds: number];
  updateDuration: [id: string, durationSeconds: number];
  updateBoundary: [
    currentId: string,
    currentDurationSeconds: number,
    previousId: string,
    previousDurationSeconds: number,
  ];
  reorder: [fromId: string, toId: string];
}>();
const track = ref<HTMLElement | null>(null);
const draggingId = ref("");
let resizeState: {
  pointerId: number;
  id: string;
  startX: number;
  side: "left" | "right";
  startDuration: number;
  previousId: string | null;
  previousStartDuration: number | null;
  trackWidth: number;
  displaySeconds: number;
} | null = null;

const rawLayout = computed(() => {
  let cursor = 0;
  return props.timeline.map((segment, index) => {
    const startSeconds = cursor;
    cursor += Math.max(1, Number(segment.durationSeconds) || 1);
    return { segment, index, startSeconds, endSeconds: cursor, next: props.timeline[index + 1] ?? null };
  });
});
const totalSeconds = computed(() => rawLayout.value.at(-1)?.endSeconds ?? 0);
const workspaceSeconds = computed(() => Math.max(
  DEFAULT_WORKSPACE_SECONDS,
  Number(props.workspaceSeconds) || DEFAULT_WORKSPACE_SECONDS,
));
const displaySeconds = computed(() => Math.max(workspaceSeconds.value, totalSeconds.value));
const canvasWidth = computed(() => Math.max(MIN_CANVAS_WIDTH, Math.ceil(displaySeconds.value / 5)));
const layout = computed(() => rawLayout.value.map((item) => ({
  ...item,
  leftPercent: item.startSeconds / displaySeconds.value * 100,
  widthPercent: Math.max(.05, item.segment.durationSeconds / displaySeconds.value * 100),
  endPercent: item.endSeconds / displaySeconds.value * 100,
})));
const playheadPercent = computed(() => Math.min(100, Math.max(0, ((Number(props.logicalSeconds) || 0) / displaySeconds.value) * 100)));
const rulerTicks = computed(() => {
  const ticks = [];
  for (let seconds = 0; seconds <= displaySeconds.value; seconds += 600) {
    ticks.push({ seconds, percent: seconds / displaySeconds.value * 100 });
  }
  return ticks;
});

onBeforeUnmount(stopDurationResize);

function transitionId(sourceId: string) { return `transition:${sourceId}`; }

function beginReorder(event: DragEvent, id: string) {
  draggingId.value = id;
  event.dataTransfer?.setData("text/plain", id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function dropOn(toId: string) {
  const fromId = draggingId.value;
  draggingId.value = "";
  if (fromId && fromId !== toId) emit("reorder", fromId, toId);
}

function beginDurationResize(
  event: PointerEvent,
  segment: SuperWeatherWeatherSegment,
  side: "left" | "right",
) {
  const width = track.value?.getBoundingClientRect().width ?? 0;
  const previous = props.timeline[props.timeline.findIndex((item) => item.id === segment.id) - 1] ?? null;
  if (!width || (side === "left" && !previous)) return;
  resizeState = {
    pointerId: event.pointerId,
    id: segment.id,
    side,
    startX: event.clientX,
    startDuration: segment.durationSeconds,
    previousId: previous?.id ?? null,
    previousStartDuration: previous?.durationSeconds ?? null,
    trackWidth: width,
    displaySeconds: displaySeconds.value,
  };
  window.addEventListener("pointermove", resizeDuration);
  window.addEventListener("pointerup", stopDurationResize);
  window.addEventListener("pointercancel", stopDurationResize);
}

function resizeDuration(event: PointerEvent) {
  if (!resizeState || event.pointerId !== resizeState.pointerId) return;
  const deltaSeconds = (event.clientX - resizeState.startX)
    / resizeState.trackWidth
    * resizeState.displaySeconds;
  const snap = event.altKey || event.shiftKey ? 10 : 60;

  if (resizeState.side === "left" && resizeState.previousId && resizeState.previousStartDuration != null) {
    const currentDuration = Math.max(
      MIN_SEGMENT_SECONDS,
      Math.round((resizeState.startDuration - deltaSeconds) / snap) * snap,
    );
    const previousDuration = Math.max(
      MIN_SEGMENT_SECONDS,
      Math.round((resizeState.previousStartDuration + deltaSeconds) / snap) * snap,
    );
    emit("updateBoundary", resizeState.id, currentDuration, resizeState.previousId, previousDuration);
    return;
  }

  const duration = Math.max(
    MIN_SEGMENT_SECONDS,
    Math.round((resizeState.startDuration + deltaSeconds) / snap) * snap,
  );
  emit("updateDuration", resizeState.id, duration);
}

function stopDurationResize() {
  resizeState = null;
  window.removeEventListener("pointermove", resizeDuration);
  window.removeEventListener("pointerup", stopDurationResize);
  window.removeEventListener("pointercancel", stopDurationResize);
}

function formatWorkspace(value: number) {
  const hours = Math.max(1, Math.round(value / 3600));
  return String(hours).padStart(2, "0") + " HOUR";
}

function formatTick(value: number) {
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatDuration(value: number) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}
</script>

<style scoped>
.timeline-shell { min-width: 0; }
.timeline-summary { display: flex; align-items: end; gap: 14px; padding: 0 4px 8px; }
.timeline-summary-copy { min-width: 0; display: grid; gap: 3px; }
.timeline-summary-copy span { color: #6edaff; font-size: 8px; letter-spacing: .14em; }
.timeline-summary-copy strong { color: rgba(224, 241, 250, .78); font: 10px ui-monospace, monospace; }
.timeline-summary-copy small { color: rgba(202, 221, 235, .46); font-size: 9px; }
.workspace-picker { display: grid; gap: 3px; margin-left: auto; }
.workspace-picker span { color: rgba(175, 207, 224, .56); font-size: 8px; letter-spacing: .12em; }
.workspace-picker select { height: 27px; padding: 0 8px; border: 1px solid rgba(106, 161, 187, .25); border-radius: 7px; background: rgba(11, 29, 43, .9); color: #dff5ff; font-size: 10px; }
.timeline-track {
  position: relative;
  height: 174px;
  min-width: 1440px;
  border: 1px solid rgba(107, 165, 191, .12);
  border-radius: 10px;
  background:
    linear-gradient(90deg, rgba(117, 181, 209, .06) 1px, transparent 1px) 0 0 / 120px 100%,
    rgba(4, 12, 21, .5);
}
.timeline-ruler { position: absolute; inset: 0 0 auto; height: 30px; border-bottom: 1px solid rgba(115, 170, 196, .12); }
.ruler-tick { position: absolute; top: 7px; transform: translateX(-50%); color: rgba(202, 221, 235, .48); font: 9px ui-monospace, monospace; }
.ruler-tick::after { content: ""; position: absolute; left: 50%; top: 15px; height: 7px; border-left: 1px solid rgba(126, 180, 205, .24); }
.ruler-tick.major { color: rgba(222, 239, 247, .7); }
.playhead {
  position: absolute;
  z-index: 9;
  top: 30px;
  bottom: 0;
  width: 2px;
  background: #f8d25d;
  box-shadow: 0 0 12px rgba(248, 210, 93, .78);
  pointer-events: none;
}
.playhead::before { content: ""; position: absolute; top: -1px; left: -4px; border: 5px solid transparent; border-top-color: #f8d25d; }
.playhead span { position: absolute; top: 5px; left: 7px; color: #ffe9a5; font: 9px ui-monospace, monospace; white-space: nowrap; }
</style>
