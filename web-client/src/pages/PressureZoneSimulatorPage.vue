<template>
  <div class="pressure-simulator-page">
    <header class="sim-header">
      <div class="sim-title">
        <span class="sim-title__icon">⌖</span>
        <div><p>DYNAMIC PRESSURE ZONE</p><h1>压家区域模拟器</h1></div>
        <span class="live-badge" :class="{ busy: loading }"><i></i>{{ loading ? "计算中" : "实时重算" }}</span>
      </div>
      <div class="header-actions">
        <select v-model="selectedPreset" aria-label="测试场景" @change="applyPreset(selectedPreset)">
          <option v-for="preset in presets" :key="preset.key" :value="preset.key">{{ preset.name }}</option>
        </select>
        <RouterLink class="tool-button" to="/settings/pressure-zone">基础参数</RouterLink>
        <button class="tool-button primary" type="button" :disabled="saving" @click="saveProfile">{{ saving ? "保存中…" : "保存 Layer" }}</button>
      </div>
    </header>

    <div class="sim-workspace">
      <aside class="editor-panel panel">
        <div class="panel-tabs">
          <button type="button" :class="{ active: editorTab === 'map' }" @click="editorTab = 'map'">地图与 Main</button>
          <button type="button" :class="{ active: editorTab === 'objectives' }" @click="editorTab = 'objectives'">旗点 <b>{{ model.objectives.length }}</b></button>
        </div>

        <div v-if="editorTab === 'map'" class="panel-scroll">
          <section class="editor-section">
            <div class="section-heading"><div><span>MAP SIZE</span><h2>地图尺寸</h2></div><small>单位：米</small></div>
            <label class="sim-map-select"><span>战术地图底图</span><select v-model="selectedMapKey" @change="applySelectedMap"><option value="custom">自定义空白地图</option><option v-for="map in mapOptions" :key="map.key" :value="map.key">{{ map.name }}</option></select></label>
            <div v-if="selectedMapKey === 'custom'" class="size-presets">
              <button v-for="size in [2000, 4000, 6000, 8000]" :key="size" type="button" :class="{ active: model.width === size && model.height === size }" @click="setSquareSize(size)">{{ size / 1000 }} km</button>
            </div>
            <div class="field-row two">
              <label><span>宽度</span><input :value="Math.round(mapWidthMeters)" type="number" :disabled="selectedMapKey !== 'custom'" min="500" max="20000" step="100" @input="updateCustomDimension('width', $event)" /></label>
              <label><span>高度</span><input :value="Math.round(mapHeightMeters)" type="number" :disabled="selectedMapKey !== 'custom'" min="500" max="20000" step="100" @input="updateCustomDimension('height', $event)" /></label>
            </div>
            <div class="field-row two">
              <label><span>模式</span><select v-model="model.mode"><option>AAS</option><option>RAAS</option><option>Invasion</option></select></label>
              <label><span>Layer 名称</span><input v-model="model.layer" /></label>
            </div>
          </section>

          <section class="editor-section">
            <div class="section-heading"><div><span>MAIN BASES</span><h2>主基地位置</h2></div><small>可直接拖动 M1 / M2</small></div>
            <div v-for="main in model.mains" :key="main.teamId" class="main-editor" :class="`team-${main.teamId}`">
              <strong><i></i>TEAM {{ main.teamId }}</strong>
              <label>X <input v-model.number="main.x" type="number" /></label>
              <label>Y <input v-model.number="main.y" type="number" /></label>
            </div>
          </section>

          <section class="editor-section policy-link">
            <span class="policy-link__icon">◎</span>
            <div><strong>使用服务器基础参数</strong><small>{{ baseConfigLoaded ? "已同步 Hard / Soft / Combat 参数" : "基础参数由服务端自动参与计算" }}</small></div>
            <RouterLink to="/settings/pressure-zone">调整</RouterLink>
          </section>
        </div>

        <div v-else class="panel-scroll objectives-editor">
          <section class="add-objective-box" :class="{ active: addMode }">
            <div><strong>{{ addMode ? "点击地图放置新旗点" : "添加旗点" }}</strong><small>{{ addMode ? "放置后可继续连续添加，按 Esc 结束。" : "推荐直接在地图上点击位置。" }}</small></div>
            <button type="button" @click="addMode = !addMode">{{ addMode ? "结束添加" : "地图添加" }}</button>
          </section>
          <div class="new-owner-row">
            <span>新点归属</span>
            <div class="owner-toggle compact"><button type="button" :class="{ active: newOwner === 1 }" @click="newOwner = 1">T1</button><button type="button" :class="{ active: newOwner === 0 }" @click="newOwner = 0">中立</button><button type="button" :class="{ active: newOwner === 2 }" @click="newOwner = 2">T2</button></div>
            <button class="center-add" type="button" @click="addObjectiveAtCenter">＋ 中心添加</button>
          </div>

          <div class="objective-list">
            <article v-for="(item, index) in model.objectives" :key="item.uid" class="objective-row" :class="[{ selected: selectedObjectiveUid === item.uid, combat: isCombatObjective(item) }, `owner-${item.owner}`]" @click="selectedObjectiveUid = item.uid">
              <button class="drag-order" type="button" :title="`旗点顺序 ${index + 1}`">{{ index + 1 }}</button>
              <div class="objective-identity"><strong>{{ item.name || `P${index + 1}` }}</strong><span>{{ Math.round(item.x) }}, {{ Math.round(item.y) }}</span></div>
              <span class="owner-chip">{{ ownerLabel(item.owner) }}</span>
              <div class="row-actions"><button type="button" :disabled="index === 0" title="向前移动" @click.stop="moveObjective(index, -1)">↑</button><button type="button" :disabled="index === model.objectives.length - 1" title="向后移动" @click.stop="moveObjective(index, 1)">↓</button><button type="button" :disabled="model.objectives.length <= 2" title="删除" @click.stop="removeObjective(index)">×</button></div>
            </article>
          </div>

          <section v-if="selectedObjective" class="selected-editor">
            <div class="section-heading"><div><span>SELECTED OBJECTIVE</span><h2>编辑 {{ selectedObjective.name }}</h2></div><small>拖动地图节点更快</small></div>
            <label class="name-field"><span>名称</span><input v-model="selectedObjective.name" /></label>
            <div class="field-row two"><label><span>X 坐标</span><input v-model.number="selectedObjective.x" type="number" /></label><label><span>Y 坐标</span><input v-model.number="selectedObjective.y" type="number" /></label></div>
            <div class="owner-toggle"><button type="button" :class="{ active: selectedObjective.owner === 1 }" @click="selectedObjective.owner = 1">Team 1</button><button type="button" :class="{ active: selectedObjective.owner === 0 }" @click="selectedObjective.owner = 0">Neutral</button><button type="button" :class="{ active: selectedObjective.owner === 2 }" @click="selectedObjective.owner = 2">Team 2</button></div>
          </section>
        </div>
      </aside>

      <main class="map-panel panel">
        <div class="map-toolbar">
          <div class="layer-toggles">
            <label class="hard"><input v-model="layers.hard" type="checkbox" /><span></span>Hard</label>
            <label class="soft"><input v-model="layers.soft" type="checkbox" /><span></span>Soft</label>
            <label class="combat"><input v-model="layers.combat" type="checkbox" /><span></span>Combat</label>
            <label><input v-model="layers.diagnostics" type="checkbox" /><span></span>参数标签</label>
          </div>
          <div class="map-scale-readout">{{ activeMapName }} · {{ Math.round(mapWidthMeters) }} × {{ Math.round(mapHeightMeters) }} m</div>
        </div>
        <div
          ref="viewportRef"
          class="map-viewport tactical-sim-viewport"
          :class="{ 'is-panning': camera.isDragging.value }"
          @pointerdown="startPan"
          @pointermove="onViewportPointerMove"
          @pointerup="stopPointerInteraction"
          @pointercancel="stopPointerInteraction"
          @wheel.prevent="onWheel"
        >
          <div class="viewport-bg-grid"></div>
          <div
            ref="stageRef"
            class="sim-map"
            :class="{ 'add-mode': addMode, dragging: Boolean(dragging) || camera.isDragging.value }"
            :style="mapTransformStyle"
            @click="onMapClick"
          >
            <div class="tiled-map-wrapper">
              <TiledMapRenderer
                v-if="activeMapConfig"
                :tile-base-path="activeMapConfig.tileBasePath"
                :max-zoom="activeMapConfig.maxZoomLevel"
                :tiles-enabled="true"
                :interaction-active="camera.isDragging.value || Boolean(dragging)"
                :viewport-width="viewportWidth"
                :viewport-height="viewportHeight"
                :fallback-image="activeMapConfig.image"
              />
              <div v-else class="sim-map-grid"></div>
            </div>
            <PressureZoneOverlay :state="result" :map-bounds="mapBounds" :show-hard="layers.hard" :show-soft="layers.soft" :show-combat="layers.combat" :show-diagnostics="layers.diagnostics" :show-connections="true" :connection-points="model.objectives" />
            <svg class="sim-objective-layer" viewBox="0 0 1000 1000" preserveAspectRatio="none">
              <g class="distance-lines">
                <g v-for="segment in objectiveSegments" :key="segment.key" :class="{ combat: segment.combat }"><line :x1="segment.a.x" :y1="segment.a.y" :x2="segment.b.x" :y2="segment.b.y" vector-effect="non-scaling-stroke" /><text :x="segment.mid.x" :y="segment.mid.y - 10">{{ segment.distance }}m</text></g>
              </g>
              <g v-for="main in model.mains" :key="`main-${main.teamId}`" class="draggable-node main-node" :class="`team-${main.teamId}`" :transform="`translate(${px(main.x)}, ${py(main.y)})`" @click.stop @pointerdown.stop.prevent="startDrag('main', main.teamId, $event)"><circle r="24" vector-effect="non-scaling-stroke" /><text y="7">M{{ main.teamId }}</text></g>
              <g v-for="(item, index) in model.objectives" :key="item.uid" class="draggable-node objective-node" :class="[`owner-${item.owner}`, { combat: isCombatObjective(item), selected: selectedObjectiveUid === item.uid }]" :transform="`translate(${px(item.x)}, ${py(item.y)})`" @click.stop @pointerdown.stop.prevent="startDrag('objective', item.uid, $event)"><circle r="19" vector-effect="non-scaling-stroke" /><text y="6">P{{ index + 1 }}</text></g>
            </svg>
            <div v-if="addMode" class="add-mode-hint">＋ 点击空白位置添加 {{ ownerLabel(newOwner) }} 旗点</div>
            <div v-if="!result?.active" class="inactive-notice">{{ inactiveReason }}</div>
          </div>
          <header class="sim-tactical-command-bar"><div><span>PRESSURE ZONE LAB</span><strong>{{ activeMapName }}</strong><small>{{ Math.round(mapWidthMeters) }} × {{ Math.round(mapHeightMeters) }} m</small></div><b :class="{ busy: loading }"><i></i>{{ loading ? "重算中" : "实时预览" }}</b></header>
          <section class="sim-map-controls" aria-label="模拟器地图操作"><button type="button" title="放大" @click.stop="zoomIn">+</button><button type="button" title="缩小" @click.stop="zoomOut">−</button><button type="button" title="适配视口" @click.stop="resetView">↺</button></section>
        </div>
        <footer class="map-footer"><span>拖动 M1 / M2 / P1… 修改位置</span><span>旗点顺序只由左侧 ↑↓ 调整</span><span v-if="result?.combat" class="combat-pair">当前交战：{{ result.combat.team1ObjectiveId }} ↔ {{ result.combat.team2ObjectiveId }}</span></footer>
      </main>

      <aside class="result-panel panel">
        <header class="result-header"><div><span>CALCULATION</span><h2>计算结果</h2></div><button type="button" title="立即重算" @click="runSimulation">↻</button></header>
        <div class="result-scroll">
          <div class="metric-grid">
            <div><span>地图缩放</span><strong>{{ fmt(result?.map?.scaleFactor, 2) }}×</strong></div>
            <div><span>交战点距</span><strong>{{ fmt(result?.combat?.gapMeters) }}m</strong></div>
          </div>
          <section v-for="teamId in [1, 2]" :key="teamId" class="team-result" :class="`team-${teamId}`">
            <header><span><i></i>TEAM {{ teamId }}</span><b>{{ baseFor(teamId)?.currentFrontObjectiveId || "--" }}</b></header>
            <div class="radius-row hard"><span>Hard Radius</span><strong>{{ fmt(baseFor(teamId)?.hardRadius) }} m</strong></div>
            <div class="radius-row soft"><span>Soft Radius</span><strong>{{ fmt(baseFor(teamId)?.softRadius) }} m</strong></div>
            <dl><dt>最近点</dt><dd>{{ baseFor(teamId)?.nearestObjectiveId || "--" }}</dd><dt>Main → 最近点</dt><dd>{{ fmt(baseFor(teamId)?.nearestObjectiveDistance) }} m</dd><dt>Main → 当前前线</dt><dd>{{ fmt(baseFor(teamId)?.currentFrontDistance) }} m</dd></dl>
          </section>
          <section class="combat-result">
            <header><span>COMBAT BUFFER</span><b>{{ result?.combat ? `${result.combat.team1ObjectiveId} ↔ ${result.combat.team2ObjectiveId}` : "--" }}</b></header>
            <div class="combat-shape"><span :style="{ width: `${combatShapeWidth}%` }"></span></div>
            <dl><dt>纵向半径</dt><dd>{{ fmt(result?.combat?.longitudinalRadius) }} m</dd><dt>横向半径</dt><dd>{{ fmt(result?.combat?.lateralRadius) }} m</dd><dt>点距基准</dt><dd>{{ fmt(result?.combat?.baseRadius) }} m</dd></dl>
          </section>
          <section class="distance-result"><header><span>旗点距离</span><small>Main 1 / Main 2</small></header><div v-for="(item, index) in model.objectives" :key="item.uid"><b>P{{ index + 1 }}</b><span>{{ distanceToMain(item, 1) }} m</span><span>{{ distanceToMain(item, 2) }} m</span></div></section>
        </div>
      </aside>
    </div>

    <div v-if="statusText || errorText" class="toast" :class="{ error: errorText }"><span>{{ errorText || statusText }}</span><button type="button" @click="statusText = ''; errorText = ''">×</button></div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import PressureZoneOverlay from "../components/tactical-map/PressureZoneOverlay.vue";
import TiledMapRenderer from "../components/tactical-map/TiledMapRenderer.vue";
import { useMapCamera } from "../composables/useMapCamera";
import { provideTacticalMapViewport } from "../composables/tacticalMapViewport";
import { TACTICAL_MAP_CONFIGS, TACTICAL_MAP_LIST, type TacticalMapConfig } from "../shared/tactical-map-data";
import { fetchDynamicPressureZoneBaseConfig, saveDynamicPressureZoneProfile, simulateDynamicPressureZone, type PressureZoneState } from "../app/dynamicPressureZoneApi";

interface ObjectiveModel { uid: string; name: string; x: number; y: number; owner: number }
type DragState = { type: "main" | "objective"; id: number | string; pointerId: number; startX: number; startY: number; moved: boolean };

const stageRef = ref<HTMLElement | null>(null);
const viewportRef = ref<HTMLElement | null>(null);
const viewportWidth = ref(0);
const viewportHeight = ref(0);
const camera = useMapCamera();
const mapTransformStyle = computed(() => camera.getTransform());
provideTacticalMapViewport({ zoom: camera.zoom, panX: camera.x, panY: camera.y });
const result = ref<PressureZoneState | null>(null);
const loading = ref(false);
const saving = ref(false);
const baseConfigLoaded = ref(false);
const errorText = ref("");
const statusText = ref("");
const selectedPreset = ref("straight");
const selectedMapKey = ref("custom");
const editorTab = ref<"map" | "objectives">("map");
const selectedObjectiveUid = ref("");
const addMode = ref(false);
const newOwner = ref(0);
const layers = reactive({ hard: true, soft: true, combat: true, diagnostics: false });
const dragging = ref<DragState | null>(null);
let sequence = 10;
let simulationTimer: number | null = null;
let requestSequence = 0;
let suppressMapClick = false;
let resizeObserver: ResizeObserver | null = null;
let activePanPointerId: number | null = null;

const model = reactive({
  width: 4000,
  height: 4000,
  mode: "RAAS",
  layer: "Pressure Zone Simulator",
  mains: [{ teamId: 1, x: 250, y: 500 }, { teamId: 2, x: 3750, y: 3500 }],
  objectives: [] as ObjectiveModel[],
});

const presets = [
  { key: "straight", name: "普通直线 Layer" }, { key: "snake", name: "蛇形 Layer" },
  { key: "foldback", name: "折返 Layer" }, { key: "small", name: "小地图短点距" },
  { key: "large", name: "大地图长点距" }, { key: "last-near-main", name: "最后旗点靠近 Main" },
  { key: "soft-overlap", name: "交战区与 Soft 重叠" },
];

const mapOptions = TACTICAL_MAP_LIST;
const activeMapConfig = computed<TacticalMapConfig | null>(() => TACTICAL_MAP_CONFIGS[selectedMapKey.value] ?? null);
const activeMapName = computed(() => activeMapConfig.value?.name ?? "自定义模拟地图");
const mapBounds = computed(() => activeMapConfig.value?.bounds ?? ({ minX: 0, minY: 0, maxX: Math.max(1, model.width), maxY: Math.max(1, model.height) }));
const coordinateScaleMeters = computed(() => Math.hypot(mapBounds.value.maxX - mapBounds.value.minX, mapBounds.value.maxY - mapBounds.value.minY) > 20_000 ? 0.01 : 1);
const mapWidthMeters = computed(() => (mapBounds.value.maxX - mapBounds.value.minX) * coordinateScaleMeters.value);
const mapHeightMeters = computed(() => (mapBounds.value.maxY - mapBounds.value.minY) * coordinateScaleMeters.value);
const selectedObjective = computed(() => model.objectives.find((item) => item.uid === selectedObjectiveUid.value) ?? null);
const inactiveReason = computed(() => ({ "unsupported-mode": "当前模式不启用压家区域", "incomplete-geometry": "至少需要两个 Main 和两个旗点" }[result.value?.reason ?? ""] ?? result.value?.reason ?? errorText.value ?? "等待计算"));
const combatShapeWidth = computed(() => Math.max(15, Math.min(100, Number(result.value?.combat?.lateralRadius ?? 0) / 20)));
const objectiveSegments = computed(() => model.objectives.slice(0, -1).map((item, index) => {
  const next = model.objectives[index + 1];
  const id = `p${index + 1}`; const nextId = `p${index + 2}`;
  const a = { x: px(item.x), y: py(item.y) }; const b = { x: px(next.x), y: py(next.y) };
  return { key: `${item.uid}-${next.uid}`, a, b, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.round(Math.hypot(next.x - item.x, next.y - item.y) * coordinateScaleMeters.value), combat: result.value?.combat?.team1ObjectiveId === id && result.value?.combat?.team2ObjectiveId === nextId };
}));

function objective(name: string, x: number, y: number, owner: number): ObjectiveModel { return { uid: `objective-${sequence++}`, name, x, y, owner }; }
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
  if (selectedMapKey.value === "custom") { model.width = scenario.size; model.height = scenario.size; }
  const bounds = mapBounds.value;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const project = (x: number, y: number) => ({ x: bounds.minX + (x / scenario.size) * width, y: bounds.minY + (y / scenario.size) * height });
  model.mains.forEach((main, index) => { const point = project(scenario.mains[index][0], scenario.mains[index][1]); main.x = point.x; main.y = point.y; });
  model.objectives.splice(0, model.objectives.length, ...scenario.points.map((point, index) => { const projected = project(point[0], point[1]); return objective(`P${index + 1}`, projected.x, projected.y, point[2]); }));
  selectedObjectiveUid.value = model.objectives[0]?.uid ?? "";
}

function applySelectedMap() {
  applyPreset(selectedPreset.value);
  void nextTick(resetView);
}

function buildPayload() { return { mode: model.mode, mapBounds: mapBounds.value, mains: model.mains, objectiveChain: model.objectives.map((item, index) => ({ id: `p${index + 1}`, name: item.name, x: item.x, y: item.y })), objectiveState: Object.fromEntries(model.objectives.map((item, index) => [`p${index + 1}`, item.owner || null])) }; }
function scheduleSimulation() { if (simulationTimer != null) window.clearTimeout(simulationTimer); simulationTimer = window.setTimeout(runSimulation, 120); }
async function runSimulation() {
  const current = ++requestSequence; loading.value = true; errorText.value = "";
  try { const response = await simulateDynamicPressureZone(buildPayload()); if (current === requestSequence) result.value = response.state; }
  catch (error: any) { if (current === requestSequence) errorText.value = error?.message ?? "模拟失败"; }
  finally { if (current === requestSequence) loading.value = false; }
}
async function saveProfile() {
  saving.value = true; statusText.value = ""; errorText.value = "";
  try {
    const payload = buildPayload();
    await saveDynamicPressureZoneProfile({ layer: model.layer, mapKey: activeMapConfig.value?.key ?? "", mode: model.mode, mapBounds: payload.mapBounds, mains: Object.fromEntries(model.mains.map((main) => [main.teamId, { x: main.x, y: main.y }])), objectives: payload.objectiveChain });
    statusText.value = `Layer Profile 已保存：${model.layer}`;
  } catch (error: any) { errorText.value = error?.message ?? "保存失败"; }
  finally { saving.value = false; }
}

function updateCustomDimension(axis: "width" | "height", event: Event) {
  const value = Math.max(500, Math.min(20_000, Number((event.target as HTMLInputElement)?.value) || 500));
  if (axis === "width") model.width = value; else model.height = value;
}
function setSquareSize(size: number) {
  const oldWidth = Math.max(1, model.width); const oldHeight = Math.max(1, model.height);
  model.mains.forEach((item) => { item.x = item.x / oldWidth * size; item.y = item.y / oldHeight * size; });
  model.objectives.forEach((item) => { item.x = item.x / oldWidth * size; item.y = item.y / oldHeight * size; });
  model.width = size; model.height = size;
}
function addObjectiveAt(x: number, y: number) { const item = objective(nextObjectiveName(), Math.round(x), Math.round(y), newOwner.value); model.objectives.push(item); selectedObjectiveUid.value = item.uid; editorTab.value = "objectives"; }
function nextObjectiveName() { const used = new Set(model.objectives.map((item) => item.name.trim().toLowerCase())); let number = 1; while (used.has(`p${number}`)) number += 1; return `P${number}`; }
function addObjectiveAtCenter() { const bounds = mapBounds.value; addObjectiveAt((bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2); }
function removeObjective(index: number) { const [removed] = model.objectives.splice(index, 1); if (selectedObjectiveUid.value === removed?.uid) selectedObjectiveUid.value = model.objectives[Math.min(index, model.objectives.length - 1)]?.uid ?? ""; }
function moveObjective(index: number, offset: number) { const target = index + offset; if (target < 0 || target >= model.objectives.length) return; const [item] = model.objectives.splice(index, 1); model.objectives.splice(target, 0, item); }
function ownerLabel(owner: number) { return owner === 1 ? "Team 1" : owner === 2 ? "Team 2" : "Neutral"; }
function baseFor(teamId: number) { return teamId === 1 ? result.value?.bases?.team1 : result.value?.bases?.team2; }
function fmt(value: unknown, digits = 0) { const number = Number(value); return Number.isFinite(number) ? number.toFixed(digits) : "--"; }
function px(x: number) { const bounds = mapBounds.value; return Math.max(0, Math.min(1000, ((Number(x) - bounds.minX) / Math.max(1, bounds.maxX - bounds.minX)) * 1000)); }
function py(y: number) { const bounds = mapBounds.value; return Math.max(0, Math.min(1000, ((Number(y) - bounds.minY) / Math.max(1, bounds.maxY - bounds.minY)) * 1000)); }
function isCombatObjective(item: ObjectiveModel) { const index = model.objectives.indexOf(item); const id = `p${index + 1}`; return result.value?.combat?.team1ObjectiveId === id || result.value?.combat?.team2ObjectiveId === id; }
function distanceToMain(item: ObjectiveModel, teamId: number) { const main = model.mains.find((entry) => entry.teamId === teamId); return main ? Math.round(Math.hypot(item.x - main.x, item.y - main.y) * coordinateScaleMeters.value) : "--"; }
function mapCoordinates(event: MouseEvent | PointerEvent) {
  const rect = stageRef.value?.getBoundingClientRect(); if (!rect) return null;
  const bounds = mapBounds.value;
  return {
    x: bounds.minX + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * (bounds.maxX - bounds.minX),
    y: bounds.minY + Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) * (bounds.maxY - bounds.minY),
  };
}
function startDrag(type: "main" | "objective", id: number | string, event: PointerEvent) { if (type === "objective") selectedObjectiveUid.value = String(id); const target = event.currentTarget as Element; target.setPointerCapture?.(event.pointerId); dragging.value = { type, id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, moved: false }; }
function onPointerMove(event: PointerEvent) {
  if (!dragging.value) return;
  if (Math.hypot(event.clientX - dragging.value.startX, event.clientY - dragging.value.startY) > 2) dragging.value.moved = true;
  const point = mapCoordinates(event); if (!point) return;
  const target = dragging.value.type === "main" ? model.mains.find((item) => item.teamId === dragging.value?.id) : model.objectives.find((item) => item.uid === dragging.value?.id);
  if (target) { target.x = Math.round(point.x); target.y = Math.round(point.y); }
}
function stopDrag(event: PointerEvent) { if (!dragging.value) return; suppressMapClick = dragging.value.moved; const target = event.target as Element; if (target.hasPointerCapture?.(dragging.value.pointerId)) target.releasePointerCapture(dragging.value.pointerId); dragging.value = null; if (suppressMapClick) window.setTimeout(() => { suppressMapClick = false; }, 0); }
function onMapClick(event: MouseEvent) { if (!addMode.value || suppressMapClick) return; const point = mapCoordinates(event); if (point) addObjectiveAt(point.x, point.y); }
function startPan(event: PointerEvent) {
  if (dragging.value || addMode.value || event.button !== 0 || (event.target as Element).closest?.(".draggable-node")) return;
  activePanPointerId = event.pointerId;
  viewportRef.value?.setPointerCapture?.(event.pointerId);
  const rect = viewportRef.value?.getBoundingClientRect();
  camera.startDrag(event.clientX - (rect?.left ?? 0), event.clientY - (rect?.top ?? 0));
}
function onViewportPointerMove(event: PointerEvent) {
  if (dragging.value) { onPointerMove(event); return; }
  if (!camera.isDragging.value || activePanPointerId !== event.pointerId) return;
  const rect = viewportRef.value?.getBoundingClientRect();
  camera.onDrag(event.clientX - (rect?.left ?? 0), event.clientY - (rect?.top ?? 0));
}
function stopPointerInteraction(event: PointerEvent) {
  if (dragging.value) { stopDrag(event); return; }
  if (activePanPointerId !== event.pointerId) return;
  viewportRef.value?.releasePointerCapture?.(event.pointerId);
  activePanPointerId = null;
  camera.endDrag();
  suppressMapClick = true;
  window.setTimeout(() => { suppressMapClick = false; }, 0);
}
function onWheel(event: WheelEvent) {
  const rect = viewportRef.value?.getBoundingClientRect(); if (!rect) return;
  const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
  camera.setZoom(Math.max(.2, Math.min(12, camera.zoom.value * factor)), event.clientX - rect.left, event.clientY - rect.top);
}
function zoomAtCenter(factor: number) {
  const rect = viewportRef.value?.getBoundingClientRect(); if (!rect) return;
  camera.setZoom(Math.max(.2, Math.min(12, camera.zoom.value * factor)), rect.width / 2, rect.height / 2);
}
function zoomIn() { zoomAtCenter(1.25); }
function zoomOut() { zoomAtCenter(.8); }
function resetView() {
  const element = viewportRef.value; if (!element) return;
  const nextZoom = Math.max(.2, Math.min(1.2, Math.min(element.clientWidth, element.clientHeight) / 1000 * .94));
  camera.zoom.value = nextZoom;
  camera.x.value = (element.clientWidth - 1000 * nextZoom) / 2;
  camera.y.value = (element.clientHeight - 1000 * nextZoom) / 2;
}
function onKeydown(event: KeyboardEvent) { if (event.key === "Escape") { addMode.value = false; dragging.value = null; } }

watch(model, scheduleSimulation, { deep: true });
onMounted(async () => {
  window.addEventListener("keydown", onKeydown);
  if (viewportRef.value && typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(([entry]) => { viewportWidth.value = entry.contentRect.width; viewportHeight.value = entry.contentRect.height; });
    resizeObserver.observe(viewportRef.value);
    viewportWidth.value = viewportRef.value.clientWidth; viewportHeight.value = viewportRef.value.clientHeight;
  }
  await nextTick(); resetView();
  try { await fetchDynamicPressureZoneBaseConfig(); baseConfigLoaded.value = true; } catch {}
});
onBeforeUnmount(() => { window.removeEventListener("keydown", onKeydown); resizeObserver?.disconnect(); if (simulationTimer != null) window.clearTimeout(simulationTimer); requestSequence += 1; });
applyPreset("straight");
</script>

<style scoped>
.pressure-simulator-page { height: 100%; min-height: 660px; display: flex; flex-direction: column; gap: 10px; padding: 12px; overflow: hidden; color: #dbeafe; background: radial-gradient(circle at 50% -20%, rgba(17, 66, 91, .55), transparent 40%), #030810; }
.sim-header { min-height: 56px; display: flex; align-items: center; justify-content: space-between; gap: 14px; flex: none; padding: 8px 11px; border: 1px solid rgba(94, 234, 212, .2); border-radius: 11px; background: rgba(6, 16, 28, .94); }.sim-title { display: flex; align-items: center; gap: 10px; }.sim-title__icon { width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid rgba(45, 212, 191, .35); border-radius: 9px; background: rgba(13, 148, 136, .12); color: #5eead4; font-size: 21px; }.sim-title p { margin: 0; color: #4ed7c5; font: 700 8px ui-monospace, monospace; letter-spacing: .14em; }.sim-title h1 { margin: 2px 0 0; font-size: 17px; }.live-badge { display: flex; align-items: center; gap: 5px; margin-left: 5px; padding: 4px 7px; border-radius: 999px; background: rgba(16, 185, 129, .09); color: #6ee7b7; font-size: 9px; }.live-badge i { width: 6px; height: 6px; border-radius: 50%; background: #34d399; }.live-badge.busy i { background: #f59e0b; animation: pulse 1s infinite; }.header-actions { display: flex; align-items: center; gap: 6px; }.header-actions select,.tool-button { height: 34px; padding: 0 10px; border: 1px solid rgba(148, 163, 184, .25); border-radius: 7px; background: #0b1828; color: #dbeafe; font-size: 11px; }.tool-button { display: inline-flex; align-items: center; text-decoration: none; cursor: pointer; }.tool-button.primary { border-color: #2dd4bf; background: #0f766e; color: white; font-weight: 700; }.tool-button:disabled { opacity: .5; }
.sim-workspace { min-height: 0; display: grid; grid-template-columns: 290px minmax(460px, 1fr) 270px; gap: 10px; flex: 1; }.panel { min-width: 0; min-height: 0; overflow: hidden; border: 1px solid rgba(148, 163, 184, .18); border-radius: 10px; background: rgba(5, 13, 24, .92); }.editor-panel,.result-panel,.map-panel { display: flex; flex-direction: column; }.panel-tabs { display: grid; grid-template-columns: 1fr 1fr; flex: none; padding: 7px; border-bottom: 1px solid rgba(148, 163, 184, .12); }.panel-tabs button { padding: 8px; border: 0; border-radius: 6px; background: transparent; color: #7890a7; cursor: pointer; }.panel-tabs button.active { background: rgba(45, 212, 191, .1); color: #99f6e4; }.panel-tabs b { padding: 1px 5px; border-radius: 999px; background: rgba(148, 163, 184, .12); font-size: 9px; }.panel-scroll,.result-scroll { min-height: 0; overflow: auto; scrollbar-width: thin; scrollbar-color: #233b4d transparent; }.editor-section { padding: 13px; border-bottom: 1px solid rgba(148, 163, 184, .1); }.section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; margin-bottom: 11px; }.section-heading span,.result-header span,.combat-result header span { color: #4e738c; font: 700 8px ui-monospace, monospace; letter-spacing: .12em; }.section-heading h2,.result-header h2 { margin: 2px 0 0; font-size: 13px; }.section-heading small { color: #687f94; font-size: 9px; }.size-presets { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-bottom: 9px; }.size-presets button,.owner-toggle button { padding: 6px 4px; border: 1px solid rgba(148, 163, 184, .13); border-radius: 6px; background: rgba(15, 29, 47, .8); color: #7f95aa; font-size: 10px; cursor: pointer; }.size-presets button.active,.owner-toggle button.active { border-color: rgba(45, 212, 191, .48); background: rgba(13, 148, 136, .18); color: #99f6e4; }.field-row { display: grid; gap: 7px; margin-top: 7px; }.field-row.two { grid-template-columns: 1fr 1fr; }.field-row label,.name-field { display: grid; gap: 4px; color: #7890a7; font-size: 9px; }.field-row input,.field-row select,.name-field input { min-width: 0; padding: 7px; border: 1px solid rgba(148, 163, 184, .2); border-radius: 6px; outline: 0; background: #071320; color: #e2e8f0; font: 10px ui-monospace, monospace; }.main-editor { display: grid; grid-template-columns: 74px 1fr 1fr; align-items: end; gap: 6px; margin-top: 7px; padding: 8px; border-left: 2px solid #60a5fa; border-radius: 5px; background: rgba(37, 99, 235, .07); }.main-editor.team-2 { border-color: #f87171; background: rgba(220, 38, 38, .06); }.main-editor strong { align-self: center; color: #a9c5e8; font-size: 9px; }.main-editor strong i { display: inline-block; width: 6px; height: 6px; margin-right: 4px; border-radius: 50%; background: #60a5fa; }.main-editor.team-2 i { background: #f87171; }.main-editor label { display: grid; gap: 3px; color: #61798f; font-size: 8px; }.main-editor input { min-width: 0; width: 100%; padding: 5px; border: 1px solid rgba(148, 163, 184, .18); border-radius: 5px; background: #071320; color: #dbeafe; font: 9px ui-monospace, monospace; }.policy-link { display: grid; grid-template-columns: 30px 1fr auto; align-items: center; gap: 9px; }.policy-link__icon { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 8px; background: rgba(13, 148, 136, .12); color: #5eead4; }.policy-link div { display: grid; gap: 2px; }.policy-link strong { font-size: 10px; }.policy-link small { color: #6f879d; font-size: 8px; }.policy-link a { color: #5eead4; font-size: 9px; text-decoration: none; }
.objectives-editor { padding: 9px; }.add-objective-box { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 8px; padding: 10px; border: 1px dashed rgba(45, 212, 191, .3); border-radius: 8px; background: rgba(13, 148, 136, .05); }.add-objective-box.active { border-style: solid; background: rgba(13, 148, 136, .12); }.add-objective-box div { display: grid; gap: 3px; }.add-objective-box strong { font-size: 10px; }.add-objective-box small { color: #70879c; font-size: 8px; }.add-objective-box button,.center-add { padding: 6px 8px; border: 1px solid rgba(45, 212, 191, .35); border-radius: 6px; background: rgba(13, 148, 136, .13); color: #99f6e4; font-size: 9px; cursor: pointer; }.new-owner-row { display: flex; align-items: center; gap: 6px; padding: 8px 1px; color: #70879c; font-size: 9px; }.new-owner-row .center-add { margin-left: auto; }.owner-toggle { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; margin-top: 9px; }.owner-toggle.compact { width: 105px; margin: 0; }.owner-toggle.compact button { padding: 4px; font-size: 8px; }.objective-list { display: grid; gap: 4px; }.objective-row { display: grid; grid-template-columns: 27px 1fr auto auto; align-items: center; gap: 6px; padding: 6px; border: 1px solid rgba(148, 163, 184, .12); border-radius: 7px; background: rgba(15, 23, 42, .48); cursor: pointer; }.objective-row:hover,.objective-row.selected { border-color: rgba(94, 234, 212, .38); background: rgba(13, 148, 136, .08); }.objective-row.combat { box-shadow: inset 2px 0 #2dd4bf; }.drag-order { width: 25px; height: 25px; border: 1px solid rgba(148, 163, 184, .2); border-radius: 50%; background: #0c1b2a; color: #cbd5e1; font: 700 9px ui-monospace, monospace; }.objective-identity { min-width: 0; display: grid; gap: 2px; }.objective-identity strong { overflow: hidden; text-overflow: ellipsis; font-size: 10px; }.objective-identity span { color: #61798f; font: 8px ui-monospace, monospace; }.owner-chip { padding: 3px 5px; border-radius: 999px; background: rgba(148, 163, 184, .09); color: #94a3b8; font-size: 7px; }.owner-1 .owner-chip { background: rgba(37, 99, 235, .12); color: #93c5fd; }.owner-2 .owner-chip { background: rgba(220, 38, 38, .12); color: #fca5a5; }.row-actions { display: flex; gap: 2px; opacity: .45; }.objective-row:hover .row-actions,.objective-row.selected .row-actions { opacity: 1; }.row-actions button { width: 20px; height: 20px; padding: 0; border: 0; border-radius: 4px; background: rgba(148, 163, 184, .08); color: #94a3b8; cursor: pointer; }.row-actions button:disabled { opacity: .25; }.selected-editor { margin-top: 8px; padding: 10px; border: 1px solid rgba(45, 212, 191, .18); border-radius: 8px; background: rgba(13, 148, 136, .035); }
.map-toolbar { min-height: 42px; display: flex; align-items: center; justify-content: space-between; gap: 10px; flex: none; padding: 7px 10px; border-bottom: 1px solid rgba(148, 163, 184, .12); }.layer-toggles { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }.layer-toggles label { display: flex; align-items: center; gap: 5px; padding: 5px 7px; border-radius: 6px; background: rgba(148, 163, 184, .055); color: #8ba0b4; font-size: 9px; cursor: pointer; }.layer-toggles input { display: none; }.layer-toggles label>span { width: 6px; height: 6px; border-radius: 50%; background: #64748b; opacity: .35; }.layer-toggles input:checked+span { opacity: 1; box-shadow: 0 0 7px currentColor; }.layer-toggles .hard>span { background: #ef4444; }.layer-toggles .soft>span { background: #f97316; }.layer-toggles .combat>span { background: #14b8a6; }.map-scale-readout { color: #668096; font: 9px ui-monospace, monospace; }.map-viewport { min-height: 0; display: grid; place-items: center; flex: 1; overflow: auto; padding: 10px; background: #02060b; }.sim-map { position: relative; width: 100%; max-width: 100%; overflow: hidden; border: 1px solid rgba(94, 234, 212, .16); border-radius: 7px; background: radial-gradient(circle at 50% 50%, rgba(18, 55, 76, .42), transparent 58%), #06101b; touch-action: none; user-select: none; }.sim-map.add-mode { cursor: crosshair; border-color: rgba(45, 212, 191, .55); }.sim-map.dragging { cursor: grabbing; }.sim-map-grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(125, 211, 252, .055) 1px, transparent 1px), linear-gradient(90deg, rgba(125, 211, 252, .055) 1px, transparent 1px); background-size: 5% 5%; }.sim-objective-layer { position: absolute; z-index: 6; inset: 0; width: 100%; height: 100%; overflow: visible; }.draggable-node { cursor: grab; }.draggable-node circle { fill: #07111e; stroke: #cbd5e1; stroke-width: 3px; }.draggable-node text { fill: white; font-size: 17px; font-weight: 800; text-anchor: middle; pointer-events: none; }.main-node.team-1 circle,.objective-node.owner-1 circle { stroke: #60a5fa; }.main-node.team-2 circle,.objective-node.owner-2 circle { stroke: #f87171; }.objective-node.owner-0 circle { stroke: #cbd5e1; }.objective-node.combat circle { fill: #115e59; stroke: #5eead4; }.objective-node.selected circle { stroke-width: 5px; filter: drop-shadow(0 0 7px rgba(94, 234, 212, .8)); }.distance-lines line { stroke: rgba(203, 213, 225, .34); stroke-width: 2px; stroke-dasharray: 7 6; }.distance-lines text { fill: #a9b9c9; font-size: 15px; text-anchor: middle; paint-order: stroke; stroke: #020617; stroke-width: 5px; }.distance-lines .combat line { stroke: #5eead4; stroke-width: 4px; }.distance-lines .combat text { fill: #99f6e4; }.add-mode-hint { position: absolute; z-index: 10; top: 9px; left: 50%; transform: translateX(-50%); padding: 6px 9px; border: 1px solid rgba(45, 212, 191, .45); border-radius: 999px; background: rgba(4, 47, 46, .92); color: #99f6e4; font-size: 9px; pointer-events: none; }.inactive-notice { position: absolute; z-index: 12; inset: 50% auto auto 50%; transform: translate(-50%, -50%); padding: 9px 12px; border: 1px solid #f59e0b; border-radius: 7px; background: rgba(69, 26, 3, .9); color: #fde68a; font-size: 10px; }.map-footer { min-height: 31px; display: flex; align-items: center; gap: 14px; flex: none; padding: 5px 10px; border-top: 1px solid rgba(148, 163, 184, .1); color: #5f778c; font-size: 8px; }.combat-pair { margin-left: auto; color: #5eead4; }
.result-header { min-height: 49px; display: flex; align-items: center; justify-content: space-between; flex: none; padding: 8px 11px; border-bottom: 1px solid rgba(148, 163, 184, .12); }.result-header button { width: 27px; height: 27px; border: 1px solid rgba(148, 163, 184, .18); border-radius: 6px; background: rgba(148, 163, 184, .06); color: #8fa8bf; cursor: pointer; }.result-scroll { padding: 9px; }.metric-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }.metric-grid>div { display: grid; gap: 3px; padding: 9px; border-radius: 7px; background: rgba(148, 163, 184, .055); }.metric-grid span { color: #647d93; font-size: 8px; }.metric-grid strong { font: 700 15px ui-monospace, monospace; }.team-result,.combat-result,.distance-result { margin-top: 8px; padding: 9px; border: 1px solid rgba(148, 163, 184, .12); border-radius: 8px; background: rgba(15, 23, 42, .38); }.team-result { border-left: 2px solid #60a5fa; }.team-result.team-2 { border-left-color: #f87171; }.team-result header,.combat-result header,.distance-result header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 7px; }.team-result header span { color: #8fa8bf; font-size: 8px; }.team-result header i { display: inline-block; width: 6px; height: 6px; margin-right: 5px; border-radius: 50%; background: #60a5fa; }.team-result.team-2 header i { background: #f87171; }.team-result header b,.combat-result header b { color: #dbeafe; font: 700 9px ui-monospace, monospace; }.radius-row { display: flex; align-items: center; justify-content: space-between; padding: 6px 7px; border-radius: 5px; background: rgba(239, 68, 68, .06); }.radius-row+.radius-row { margin-top: 3px; }.radius-row span { color: #b98080; font-size: 8px; }.radius-row strong { color: #fca5a5; font: 700 12px ui-monospace, monospace; }.radius-row.soft { background: rgba(249, 115, 22, .06); }.radius-row.soft span { color: #a77e63; }.radius-row.soft strong { color: #fdba74; }.team-result dl,.combat-result dl { display: grid; grid-template-columns: 1fr auto; gap: 5px; margin: 8px 0 0; color: #667e93; font-size: 8px; }.team-result dd,.combat-result dd { margin: 0; color: #a9bbcc; font: 9px ui-monospace, monospace; }.combat-result { border-color: rgba(45, 212, 191, .17); }.combat-shape { height: 12px; display: flex; align-items: center; justify-content: center; }.combat-shape::before { content: ''; width: 58%; border-top: 1px dashed rgba(94, 234, 212, .3); }.combat-shape span { position: absolute; max-width: 76%; height: 9px; border: 1px solid rgba(45, 212, 191, .45); border-radius: 999px; background: rgba(20, 184, 166, .12); }.distance-result header span { font-size: 9px; font-weight: 700; }.distance-result header small { color: #587187; font-size: 7px; }.distance-result>div:not(header) { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5px; padding: 4px 0; border-top: 1px solid rgba(148, 163, 184, .07); color: #7890a7; font: 8px ui-monospace, monospace; }.distance-result b { color: #b8c6d3; }.toast { position: fixed; z-index: 30; right: 20px; bottom: 18px; display: flex; align-items: center; gap: 12px; max-width: 420px; padding: 10px 12px; border: 1px solid rgba(52, 211, 153, .35); border-radius: 8px; background: rgba(6, 35, 29, .96); color: #a7f3d0; font-size: 10px; box-shadow: 0 12px 30px rgba(0,0,0,.35); }.toast.error { border-color: rgba(248, 113, 113, .4); background: rgba(50, 13, 18, .96); color: #fecaca; }.toast button { border: 0; background: transparent; color: inherit; cursor: pointer; }
.sim-map-select { display: grid; gap: 5px; margin-bottom: 9px; color: #7890a7; font-size: 9px; }
.sim-map-select select { width: 100%; padding: 8px; border: 1px solid rgba(45, 212, 191, .24); border-radius: 7px; background: #071320; color: #dbeafe; font-size: 10px; }
.field-row input:disabled { color: #88a2b6; background: rgba(15, 29, 47, .58); cursor: not-allowed; }
.map-viewport.tactical-sim-viewport { position: relative; display: block; place-items: unset; overflow: hidden; padding: 0; background: #02060b; touch-action: none; }
.viewport-bg-grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(125, 211, 252, .035) 1px, transparent 1px), linear-gradient(90deg, rgba(125, 211, 252, .035) 1px, transparent 1px); background-size: 32px 32px; }
.tactical-sim-viewport .sim-map { position: absolute; width: 1000px; height: 1000px; max-width: none; aspect-ratio: auto; transform-origin: 0 0; border-radius: 0; will-change: transform; }
.tactical-sim-viewport .tiled-map-wrapper { position: absolute; z-index: 0; inset: 0; overflow: hidden; background: radial-gradient(circle at 50% 50%, rgba(18, 55, 76, .42), transparent 58%), #06101b; }
.tactical-sim-viewport .sim-map-grid { background-size: 50px 50px; }
.map-viewport.is-panning,.tactical-sim-viewport .sim-map.dragging { cursor: grabbing; }
.sim-tactical-command-bar { position: absolute; z-index: 20; top: 12px; left: 12px; right: 12px; display: flex; align-items: center; justify-content: space-between; gap: 14px; min-height: 52px; padding: 8px 13px; border: 1px solid rgba(148, 163, 184, .28); border-radius: 11px; background: linear-gradient(90deg, rgba(4, 13, 27, .94), rgba(8, 23, 40, .84)); box-shadow: 0 12px 32px rgba(0,0,0,.32); backdrop-filter: blur(12px); pointer-events: none; }
.sim-tactical-command-bar div { display: grid; gap: 1px; }.sim-tactical-command-bar span { color: #48d6aa; font-size: 8px; font-weight: 800; letter-spacing: .14em; }.sim-tactical-command-bar strong { color: #f1f7fb; font-size: 14px; }.sim-tactical-command-bar small { color: #91aabd; font: 9px ui-monospace, monospace; }.sim-tactical-command-bar>b { display: flex; align-items: center; gap: 6px; color: #a7f3d0; font-size: 9px; }.sim-tactical-command-bar>b i { width: 7px; height: 7px; border-radius: 50%; background: #45d9ac; box-shadow: 0 0 10px rgba(69,217,172,.8); }.sim-tactical-command-bar>b.busy i { background: #f59e0b; }
.sim-map-controls { position: absolute; z-index: 21; bottom: 12px; left: 12px; display: flex; padding: 4px; border: 1px solid rgba(148, 163, 184, .28); border-radius: 10px; background: rgba(4, 14, 27, .9); box-shadow: 0 10px 28px rgba(0,0,0,.28); }
.sim-map-controls button { width: 34px; height: 32px; border: 0; border-radius: 7px; background: transparent; color: #b8ccd9; font-size: 16px; cursor: pointer; }.sim-map-controls button:hover { background: rgba(72, 214, 170, .2); color: #a7f6d4; }
.tactical-sim-viewport .add-mode-hint { top: 78px; }
@keyframes pulse { 50% { opacity: .35; } }
@media (max-width: 1180px) { .sim-workspace { grid-template-columns: 270px minmax(430px, 1fr); }.result-panel { display: none; } }
@media (max-width: 760px) { .pressure-simulator-page { height: auto; min-height: 100%; overflow: auto; }.sim-header { align-items: flex-start; flex-direction: column; }.header-actions { width: 100%; flex-wrap: wrap; }.header-actions select { flex: 1; }.sim-workspace { display: flex; flex-direction: column; }.editor-panel { min-height: 420px; }.map-panel { min-height: 520px; order: -1; }.result-panel { display: flex; min-height: 460px; }.sim-title .live-badge { display: none; }.map-footer { flex-wrap: wrap; }.combat-pair { margin-left: 0; } }
</style>
