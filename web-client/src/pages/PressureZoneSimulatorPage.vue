<template>
  <div class="pressure-simulator-page">
    <header class="sim-header">
      <div>
        <p class="eyebrow">DYNAMIC PRESSURE ZONE</p>
        <h1>压家区域模拟器</h1>
        <p>拓扑顺序与实际距离完全分离；拖动 Main 或点位即可实时重算。</p>
      </div>
      <div class="header-actions">
        <select v-model="selectedPreset" @change="applyPreset(selectedPreset)">
          <option v-for="preset in presets" :key="preset.key" :value="preset.key">{{ preset.name }}</option>
        </select>
        <button type="button" :disabled="saving" @click="saveProfile">{{ saving ? "保存中…" : "保存为 Layer Profile" }}</button>
      </div>
    </header>

    <div class="sim-layout">
      <aside class="sim-panel controls-panel">
        <section>
          <h2>地图设置</h2>
          <div class="preset-grid">
            <button v-for="size in [2000, 4000, 6000, 8000]" :key="size" type="button" @click="setSquareSize(size)">{{ size / 1000 }} × {{ size / 1000 }} km</button>
          </div>
          <div class="field-grid two">
            <label>宽度 (m)<input v-model.number="model.width" type="number" min="500" step="100" /></label>
            <label>高度 (m)<input v-model.number="model.height" type="number" min="500" step="100" /></label>
            <label>模式<select v-model="model.mode"><option>AAS</option><option>RAAS</option><option>Invasion</option></select></label>
            <label>Layer<input v-model="model.layer" /></label>
          </div>
        </section>

        <section>
          <h2>Main 坐标</h2>
          <div v-for="main in model.mains" :key="main.teamId" class="coordinate-card" :class="`team-${main.teamId}`">
            <strong>TEAM {{ main.teamId }}</strong>
            <label>X<input v-model.number="main.x" type="number" /></label>
            <label>Y<input v-model.number="main.y" type="number" /></label>
          </div>
        </section>

        <section>
          <div class="section-title-row"><h2>点位拓扑</h2><button type="button" @click="addObjective">＋ 添加</button></div>
          <div class="objective-list">
            <div v-for="(objective, index) in model.objectives" :key="objective.uid" class="objective-card">
              <div class="objective-card__head">
                <strong>P{{ index + 1 }} · {{ objective.name }}</strong>
                <div><button type="button" :disabled="index === 0" @click="moveObjective(index, -1)">↑</button><button type="button" :disabled="index === model.objectives.length - 1" @click="moveObjective(index, 1)">↓</button><button type="button" :disabled="model.objectives.length <= 2" @click="removeObjective(index)">×</button></div>
              </div>
              <div class="field-grid three">
                <label>X<input v-model.number="objective.x" type="number" /></label>
                <label>Y<input v-model.number="objective.y" type="number" /></label>
                <label>归属<select v-model.number="objective.owner"><option :value="1">Team 1</option><option :value="0">Neutral</option><option :value="2">Team 2</option></select></label>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h2>算法参数</h2>
          <div class="field-grid two compact-fields">
            <label>Hard Map<input v-model.number="model.config.hard.mapFactor" type="number" step="0.005" /></label>
            <label>Hard Nearest<input v-model.number="model.config.hard.nearestObjectiveFactor" type="number" step="0.05" /></label>
            <label>Soft Map<input v-model.number="model.config.soft.mapFactor" type="number" step="0.01" /></label>
            <label>Soft Nearest<input v-model.number="model.config.soft.nearestObjectiveFactor" type="number" step="0.05" /></label>
            <label>Combat Gap<input v-model.number="model.config.combat.gapFactor" type="number" step="0.05" /></label>
            <label>Lateral<input v-model.number="model.config.combat.lateralFactor" type="number" step="0.05" /></label>
            <label>Combat Min<input v-model.number="model.config.combat.minRadiusMeters" type="number" step="50" /></label>
            <label>Combat Max<input v-model.number="model.config.combat.maxRadiusMeters" type="number" step="50" /></label>
          </div>
        </section>
      </aside>

      <main class="sim-stage-panel">
        <div class="stage-toolbar">
          <label><input v-model="layers.hard" type="checkbox" /> Hard</label>
          <label><input v-model="layers.soft" type="checkbox" /> Soft</label>
          <label><input v-model="layers.combat" type="checkbox" /> Combat</label>
          <label><input v-model="layers.diagnostics" type="checkbox" /> 参数标签</label>
          <span v-if="loading">计算中…</span>
        </div>
        <div ref="stageRef" class="sim-map" @pointermove="onPointerMove" @pointerup="stopDrag" @pointerleave="stopDrag">
          <div class="sim-map-grid"></div>
          <PressureZoneOverlay
            :state="result"
            :map-bounds="mapBounds"
            :show-hard="layers.hard"
            :show-soft="layers.soft"
            :show-combat="layers.combat"
            :show-diagnostics="layers.diagnostics"
            :show-connections="true"
            :connection-points="model.objectives"
          />
          <svg class="sim-objective-layer" viewBox="0 0 1000 1000" preserveAspectRatio="none">
            <g class="distance-lines">
              <g v-for="segment in objectiveSegments" :key="segment.key" :class="{ combat: segment.combat }">
                <line :x1="segment.a.x" :y1="segment.a.y" :x2="segment.b.x" :y2="segment.b.y" vector-effect="non-scaling-stroke" />
                <text :x="segment.mid.x" :y="segment.mid.y - 10">{{ segment.distance }}m</text>
              </g>
            </g>
            <g
              v-for="main in model.mains"
              :key="`main-${main.teamId}`"
              class="draggable-node main-node"
              :class="`team-${main.teamId}`"
              :transform="`translate(${px(main.x)}, ${py(main.y)})`"
              @pointerdown.stop.prevent="startDrag('main', main.teamId)"
            ><circle r="24" vector-effect="non-scaling-stroke" /><text y="7">M{{ main.teamId }}</text></g>
            <g
              v-for="(objective, index) in model.objectives"
              :key="objective.uid"
              class="draggable-node objective-node"
              :class="[`owner-${objective.owner}`, { combat: isCombatObjective(objective) }]"
              :transform="`translate(${px(objective.x)}, ${py(objective.y)})`"
              @pointerdown.stop.prevent="startDrag('objective', objective.uid)"
            ><circle r="19" vector-effect="non-scaling-stroke" /><text y="6">P{{ index + 1 }}</text></g>
          </svg>
          <div v-if="!result?.active" class="inactive-notice">未启用：{{ result?.reason || errorText || "等待计算" }}</div>
        </div>
        <p class="drag-hint">拖动 M1 / M2 / P1… 修改空间位置；左侧 ↑↓ 只改变拓扑顺序。</p>
      </main>

      <aside class="sim-panel result-panel">
        <section>
          <h2>MAP</h2>
          <dl><dt>Width</dt><dd>{{ fmt(result?.map?.widthMeters) }} m</dd><dt>Height</dt><dd>{{ fmt(result?.map?.heightMeters) }} m</dd><dt>Diagonal</dt><dd>{{ fmt(result?.map?.diagonalMeters) }} m</dd><dt>MapScale</dt><dd>{{ fmt(result?.map?.scaleFactor, 2) }}</dd></dl>
        </section>
        <section v-for="teamId in [1, 2]" :key="teamId">
          <h2>TEAM {{ teamId }} BASE</h2>
          <dl><dt>Nearest</dt><dd>{{ baseFor(teamId)?.nearestObjectiveId || "--" }}</dd><dt>Nearest Distance</dt><dd>{{ fmt(baseFor(teamId)?.nearestObjectiveDistance) }} m</dd><dt>Front</dt><dd>{{ baseFor(teamId)?.currentFrontObjectiveId || "--" }}</dd><dt>Front Distance</dt><dd>{{ fmt(baseFor(teamId)?.currentFrontDistance) }} m</dd><dt>Hard Radius</dt><dd class="hard-value">{{ fmt(baseFor(teamId)?.hardRadius) }} m</dd><dt>Soft Radius</dt><dd class="soft-value">{{ fmt(baseFor(teamId)?.softRadius) }} m</dd></dl>
          <div class="distance-list"><span v-for="item in baseFor(teamId)?.objectiveDistances || []" :key="item.objectiveId">{{ item.objectiveId }} → Main: <b>{{ fmt(item.distanceMeters) }}m</b></span></div>
        </section>
        <section>
          <h2>COMBAT</h2>
          <dl><dt>Pair</dt><dd>{{ result?.combat ? `${result.combat.team1ObjectiveId} ↔ ${result.combat.team2ObjectiveId}` : "--" }}</dd><dt>Gap</dt><dd>{{ fmt(result?.combat?.gapMeters) }} m</dd><dt>Base Radius</dt><dd>{{ fmt(result?.combat?.baseRadius) }} m</dd><dt>Longitudinal</dt><dd>{{ fmt(result?.combat?.longitudinalRadius) }} m</dd><dt>Lateral</dt><dd>{{ fmt(result?.combat?.lateralRadius) }} m</dd></dl>
        </section>
        <p v-if="statusText" class="status-message">{{ statusText }}</p>
        <p v-if="errorText" class="status-message error">{{ errorText }}</p>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import PressureZoneOverlay from "../components/tactical-map/PressureZoneOverlay.vue";
import { saveDynamicPressureZoneProfile, simulateDynamicPressureZone, type PressureZoneState } from "../app/dynamicPressureZoneApi";

interface ObjectiveModel { uid: string; id: string; name: string; x: number; y: number; owner: number }

const stageRef = ref<HTMLElement | null>(null);
const result = ref<PressureZoneState | null>(null);
const loading = ref(false);
const saving = ref(false);
const errorText = ref("");
const statusText = ref("");
const selectedPreset = ref("straight");
const layers = reactive({ hard: true, soft: true, combat: true, diagnostics: true });
let sequence = 10;
let simulationTimer: number | null = null;
let requestSequence = 0;
const dragging = ref<{ type: "main" | "objective"; id: number | string } | null>(null);

const model = reactive({
  width: 4000,
  height: 4000,
  mode: "RAAS",
  layer: "Pressure Zone Simulator",
  mains: [{ teamId: 1, x: 250, y: 500 }, { teamId: 2, x: 3750, y: 3500 }],
  objectives: [] as ObjectiveModel[],
  config: {
    hard: { mapFactor: 0.075, nearestObjectiveFactor: 0.35 },
    soft: { mapFactor: 0.14, nearestObjectiveFactor: 0.70 },
    combat: { gapFactor: 0.60, lateralFactor: 1.20, minRadiusMeters: 450, maxRadiusMeters: 1600 },
  },
});

const presets = [
  { key: "straight", name: "普通直线 Layer" },
  { key: "snake", name: "蛇形 Layer" },
  { key: "foldback", name: "折返 Layer" },
  { key: "small", name: "小地图短点距" },
  { key: "large", name: "大地图长点距" },
  { key: "last-near-main", name: "最后旗点靠近 Main" },
  { key: "soft-overlap", name: "交战区与 Soft 重叠" },
];

const mapBounds = computed(() => ({ minX: 0, minY: 0, maxX: Math.max(1, model.width), maxY: Math.max(1, model.height) }));
const objectiveSegments = computed(() => model.objectives.slice(0, -1).map((objective, index) => {
  const next = model.objectives[index + 1];
  const combat = result.value?.combat?.team1ObjectiveId === objective.id && result.value?.combat?.team2ObjectiveId === next.id;
  const a = { x: px(objective.x), y: py(objective.y) };
  const b = { x: px(next.x), y: py(next.y) };
  return { key: `${objective.uid}-${next.uid}`, a, b, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.round(Math.hypot(next.x - objective.x, next.y - objective.y)), combat };
}));

function objective(id: string, x: number, y: number, owner: number): ObjectiveModel {
  return { uid: `objective-${sequence++}`, id, name: id.toUpperCase(), x, y, owner };
}

function applyPreset(key: string) {
  selectedPreset.value = key;
  const scenarios: Record<string, { size: number; mains: number[][]; points: Array<[number, number, number]> }> = {
    straight: { size: 4000, mains: [[250, 500], [3750, 3500]], points: [[700, 700, 1], [1500, 1450, 1], [2450, 2500, 2], [3300, 3250, 2]] },
    snake: { size: 4000, mains: [[250, 300], [3700, 3650]], points: [[700, 700, 1], [1600, 600, 1], [1250, 1900, 1], [2750, 2150, 2], [2300, 3350, 2], [3400, 3250, 2]] },
    foldback: { size: 4000, mains: [[250, 300], [3700, 3650]], points: [[900, 700, 1], [1800, 1300, 1], [500, 550, 2], [3000, 2900, 2]] },
    small: { size: 2000, mains: [[120, 180], [1880, 1800]], points: [[450, 420, 1], [900, 850, 1], [1100, 1050, 2], [1600, 1550, 2]] },
    large: { size: 8000, mains: [[300, 500], [7700, 7500]], points: [[1200, 1300, 1], [2600, 2200, 1], [5600, 5900, 2], [6900, 6800, 2]] },
    "last-near-main": { size: 4000, mains: [[250, 300], [3700, 3650]], points: [[1000, 900, 1], [1750, 1400, 1], [500, 550, 2], [3200, 3200, 2]] },
    "soft-overlap": { size: 4000, mains: [[250, 300], [3700, 3650]], points: [[500, 400, 1], [700, 500, 1], [900, 650, 2], [3200, 3200, 2]] },
  };
  const scenario = scenarios[key] ?? scenarios.straight;
  model.width = scenario.size; model.height = scenario.size;
  model.mains[0].x = scenario.mains[0][0]; model.mains[0].y = scenario.mains[0][1];
  model.mains[1].x = scenario.mains[1][0]; model.mains[1].y = scenario.mains[1][1];
  model.objectives.splice(0, model.objectives.length, ...scenario.points.map((point, index) => objective(`p${index + 1}`, point[0], point[1], point[2])));
}

function buildPayload() {
  return {
    mode: model.mode,
    mapBounds: mapBounds.value,
    mains: model.mains,
    objectiveChain: model.objectives.map((item, index) => ({ id: `p${index + 1}`, name: item.name, x: item.x, y: item.y })),
    objectiveState: Object.fromEntries(model.objectives.map((item, index) => [`p${index + 1}`, item.owner || null])),
    config: model.config,
  };
}

function scheduleSimulation() {
  if (simulationTimer != null) window.clearTimeout(simulationTimer);
  simulationTimer = window.setTimeout(runSimulation, 100);
}

async function runSimulation() {
  const current = ++requestSequence;
  loading.value = true; errorText.value = "";
  try {
    const response = await simulateDynamicPressureZone(buildPayload());
    if (current === requestSequence) result.value = response.state;
  } catch (error: any) {
    if (current === requestSequence) errorText.value = error?.message ?? "模拟失败";
  } finally {
    if (current === requestSequence) loading.value = false;
  }
}

async function saveProfile() {
  saving.value = true; statusText.value = ""; errorText.value = "";
  try {
    const payload = buildPayload();
    await saveDynamicPressureZoneProfile({
      layer: model.layer,
      mapKey: "",
      mode: model.mode,
      mapBounds: payload.mapBounds,
      mains: Object.fromEntries(model.mains.map((main) => [main.teamId, { x: main.x, y: main.y }])),
      objectives: payload.objectiveChain,
      config: model.config,
    });
    statusText.value = `已保存：${model.layer}`;
  } catch (error: any) { errorText.value = error?.message ?? "保存失败"; }
  finally { saving.value = false; }
}

function setSquareSize(size: number) { model.width = size; model.height = size; }
function addObjective() { const index = model.objectives.length; model.objectives.push(objective(`p${index + 1}`, model.width / 2, model.height / 2, index < model.objectives.length / 2 ? 1 : 2)); }
function removeObjective(index: number) { model.objectives.splice(index, 1); }
function moveObjective(index: number, offset: number) { const target = index + offset; if (target < 0 || target >= model.objectives.length) return; const [item] = model.objectives.splice(index, 1); model.objectives.splice(target, 0, item); }
function baseFor(teamId: number) { return teamId === 1 ? result.value?.bases?.team1 : result.value?.bases?.team2; }
function fmt(value: unknown, digits = 0) { const number = Number(value); return Number.isFinite(number) ? number.toFixed(digits) : "--"; }
function px(x: number) { return Math.max(0, Math.min(1000, (Number(x) / Math.max(1, model.width)) * 1000)); }
function py(y: number) { return Math.max(0, Math.min(1000, (Number(y) / Math.max(1, model.height)) * 1000)); }
function isCombatObjective(item: ObjectiveModel) { const index = model.objectives.indexOf(item); const id = `p${index + 1}`; return result.value?.combat?.team1ObjectiveId === id || result.value?.combat?.team2ObjectiveId === id; }
function startDrag(type: "main" | "objective", id: number | string) { dragging.value = { type, id }; }
function stopDrag() { dragging.value = null; }
function onPointerMove(event: PointerEvent) {
  if (!dragging.value || !stageRef.value) return;
  const rect = stageRef.value.getBoundingClientRect();
  const x = Math.max(0, Math.min(model.width, ((event.clientX - rect.left) / rect.width) * model.width));
  const y = Math.max(0, Math.min(model.height, ((event.clientY - rect.top) / rect.height) * model.height));
  const target = dragging.value.type === "main"
    ? model.mains.find((item) => item.teamId === dragging.value?.id)
    : model.objectives.find((item) => item.uid === dragging.value?.id);
  if (target) { target.x = Math.round(x); target.y = Math.round(y); }
}

watch(model, scheduleSimulation, { deep: true });
applyPreset("straight");
</script>

<style scoped>
.pressure-simulator-page { min-height: 100%; padding: 20px; color: #dbeafe; background: radial-gradient(circle at 50% 0%, #10233c 0, #050b14 45%, #03070d 100%); }
.sim-header { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 16px; padding: 18px 20px; border: 1px solid rgba(94, 234, 212, .24); border-radius: 14px; background: rgba(7, 18, 31, .86); }
.sim-header h1 { margin: 2px 0 6px; font-size: 24px; }.sim-header p { margin: 0; color: #8fa8bf; }.eyebrow { color: #5eead4 !important; font: 700 11px/1.2 ui-monospace, monospace; letter-spacing: .16em; }
.header-actions { display: flex; align-items: center; gap: 8px; }.header-actions select { min-width: 190px; }
button, input, select { border: 1px solid rgba(148, 163, 184, .28); border-radius: 7px; background: rgba(15, 29, 47, .92); color: #e2e8f0; }.header-actions button, .section-title-row button, .preset-grid button { padding: 8px 10px; cursor: pointer; }.header-actions button:hover, .section-title-row button:hover, .preset-grid button:hover { border-color: #5eead4; }
.sim-layout { display: grid; grid-template-columns: minmax(280px, 350px) minmax(520px, 1fr) minmax(260px, 320px); gap: 14px; min-height: 680px; }
.sim-panel, .sim-stage-panel { border: 1px solid rgba(148, 163, 184, .22); border-radius: 12px; background: rgba(5, 13, 24, .9); overflow: auto; }
.sim-panel { padding: 14px; }.sim-panel section + section { margin-top: 18px; padding-top: 16px; border-top: 1px solid rgba(148, 163, 184, .14); }.sim-panel h2 { margin: 0 0 10px; color: #7dd3fc; font: 700 12px/1.2 ui-monospace, monospace; letter-spacing: .1em; }
.preset-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px; }.field-grid { display: grid; gap: 8px; }.field-grid.two { grid-template-columns: 1fr 1fr; }.field-grid.three { grid-template-columns: 1fr 1fr 1.2fr; }.field-grid label, .coordinate-card label { display: grid; gap: 4px; color: #8fa8bf; font-size: 11px; }.field-grid input, .field-grid select, .coordinate-card input, .sim-header select { min-width: 0; padding: 7px; }.compact-fields input { font-family: ui-monospace, monospace; }
.coordinate-card { display: grid; grid-template-columns: auto 1fr 1fr; align-items: end; gap: 8px; margin-bottom: 7px; padding: 9px; border-left: 3px solid #60a5fa; background: rgba(30, 64, 175, .09); }.coordinate-card.team-2 { border-color: #f87171; background: rgba(153, 27, 27, .09); }
.section-title-row, .objective-card__head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }.objective-list { display: grid; gap: 7px; max-height: 360px; overflow: auto; }.objective-card { padding: 9px; border: 1px solid rgba(148, 163, 184, .18); border-radius: 8px; background: rgba(15, 23, 42, .6); }.objective-card__head { margin-bottom: 8px; }.objective-card__head button { width: 27px; height: 25px; margin-left: 3px; cursor: pointer; }
.sim-stage-panel { display: grid; grid-template-rows: auto minmax(480px, 1fr) auto; padding: 12px; overflow: hidden; }.stage-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; min-height: 38px; color: #a5b4c5; font-size: 12px; }.stage-toolbar label { display: flex; gap: 5px; align-items: center; }.sim-map { position: relative; min-height: 480px; aspect-ratio: 1; overflow: hidden; border: 1px solid rgba(94, 234, 212, .24); border-radius: 8px; background: #07121f; touch-action: none; }.sim-map-grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(94, 234, 212, .07) 1px, transparent 1px), linear-gradient(90deg, rgba(94, 234, 212, .07) 1px, transparent 1px); background-size: 10% 10%; }.sim-objective-layer { position: absolute; inset: 0; z-index: 8; width: 100%; height: 100%; overflow: visible; }.draggable-node { cursor: grab; pointer-events: auto; }.draggable-node circle { fill: #0f172a; stroke: #cbd5e1; stroke-width: 3px; }.draggable-node text { fill: white; font-size: 17px; font-weight: 800; text-anchor: middle; pointer-events: none; }.main-node.team-1 circle, .objective-node.owner-1 circle { stroke: #60a5fa; }.main-node.team-2 circle, .objective-node.owner-2 circle { stroke: #f87171; }.objective-node.owner-0 circle { stroke: #cbd5e1; }.objective-node.combat circle { fill: #115e59; stroke: #5eead4; }.distance-lines line { stroke: rgba(203, 213, 225, .45); stroke-width: 2px; stroke-dasharray: 7 6; }.distance-lines text { fill: #cbd5e1; font-size: 16px; text-anchor: middle; paint-order: stroke; stroke: #020617; stroke-width: 5px; }.distance-lines .combat line { stroke: #5eead4; stroke-width: 4px; }.distance-lines .combat text { fill: #99f6e4; }.inactive-notice { position: absolute; z-index: 12; inset: 45% auto auto 50%; transform: translate(-50%, -50%); padding: 10px 14px; border: 1px solid #f59e0b; border-radius: 8px; background: rgba(69, 26, 3, .88); color: #fde68a; }.drag-hint { margin: 8px 0 0; color: #7890a7; font-size: 11px; }
.result-panel dl { display: grid; grid-template-columns: 1fr auto; gap: 7px 10px; margin: 0; font-size: 12px; }.result-panel dt { color: #8097ad; }.result-panel dd { margin: 0; font-family: ui-monospace, monospace; color: #e2e8f0; }.hard-value { color: #fca5a5 !important; }.soft-value { color: #fdba74 !important; }.distance-list { display: grid; gap: 4px; margin-top: 10px; padding-top: 8px; border-top: 1px dashed rgba(148, 163, 184, .18); color: #8299ae; font: 10px/1.3 ui-monospace, monospace; }.status-message { padding: 8px; border-radius: 6px; background: rgba(13, 148, 136, .14); color: #99f6e4; font-size: 12px; }.status-message.error { background: rgba(185, 28, 28, .14); color: #fecaca; }
@media (max-width: 1250px) { .sim-layout { grid-template-columns: 300px minmax(480px, 1fr); }.result-panel { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }.result-panel section + section { margin: 0; padding: 0; border: 0; } }
@media (max-width: 850px) { .pressure-simulator-page { padding: 10px; }.sim-header { flex-direction: column; }.sim-layout { grid-template-columns: 1fr; }.sim-stage-panel { grid-row: 1; }.result-panel { grid-column: auto; grid-template-columns: 1fr 1fr; }.controls-panel { max-height: none; } }
</style>
