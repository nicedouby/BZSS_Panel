<template>
  <div class="pressure-settings-page" :class="{ embedded: props.embedded }">
    <header class="settings-header">
      <div>
        <p class="eyebrow">SPAWN-CAMP ZONE V2</p>
        <h1 v-if="!props.embedded">压家圈基础参数</h1>
        <strong v-else>地图尺寸自适应压家圈</strong>
        <p>地图尺寸决定总体尺度，Main→P1 限制 Hard，P1→P2 决定 Soft，当前前线点距决定 Combat。</p>
      </div>
      <div class="header-actions">
        <RouterLink v-if="!props.embedded" class="button ghost" to="/debug/pressure-zone">打开模拟器</RouterLink>
        <button class="button ghost" type="button" :disabled="loading || saving" @click="loadDefaults">恢复默认</button>
        <button class="button primary" type="button" :disabled="!canSave" @click="saveConfig">
          {{ saving ? "保存中…" : dirty ? "保存并应用" : "已保存" }}
        </button>
      </div>
    </header>

    <div v-if="loading" class="state-card">正在读取压家圈 V2 参数…</div>
    <div v-else-if="loadError" class="state-card error">
      <strong>读取失败</strong>
      <span>{{ loadError }}</span>
      <button type="button" @click="loadConfig">重试</button>
    </div>

    <template v-else-if="config">
      <section class="live-map-card">
        <div><span>当前地图</span><strong>{{ liveState?.mapKey || liveState?.layer || "未知地图" }}</strong></div>
        <div><span>地图尺寸</span><strong>{{ liveMapSizeText }}</strong></div>
        <div><span>Effective Size</span><strong>{{ formatMeters(liveState?.map?.effectiveSizeMeters) }}</strong></div>
        <div><span>Map Scale</span><strong>{{ formatScale(liveState?.map?.scaleFactor) }}</strong></div>
        <div><span>Team 1 · Main→P1</span><strong>{{ formatMeters(liveState?.bases?.team1?.firstObjectiveDistance) }}</strong></div>
        <div><span>Team 2 · Main→P1</span><strong>{{ formatMeters(liveState?.bases?.team2?.firstObjectiveDistance) }}</strong></div>
      </section>

      <section class="reference-strip">
        <div class="reference-heading">
          <strong>即时参数预览</strong>
          <span>固定假设 Main→P1=1000m、P1→P2=1000m、前线点距=1000m，用于快速观察尺度变化。</span>
        </div>
        <div class="preview-control">
          <span>正方形地图边长</span>
          <div class="segmented">
            <button v-for="size in [2000, 4000, 6000, 8000]" :key="size" type="button" :class="{ active: previewSize === size }" @click="previewSize = size">{{ size / 1000 }} km</button>
          </div>
        </div>
        <div class="preview-stat"><span>Raw Scale</span><strong>{{ preview.rawScale.toFixed(2) }}×</strong></div>
        <div class="preview-stat"><span>Effective Scale</span><strong>{{ preview.mapScale.toFixed(2) }}×</strong></div>
        <div class="preview-stat hard"><span>Hard</span><strong>{{ Math.round(preview.hardRadius) }} m</strong></div>
        <div class="preview-stat soft"><span>Soft</span><strong>{{ Math.round(preview.softRadius) }} m</strong></div>
        <div class="preview-stat combat"><span>Combat</span><strong>{{ Math.round(preview.combatRadius) }} m</strong></div>
      </section>

      <div v-if="validationError" class="validation-banner">{{ validationError }}</div>

      <main class="parameter-grid">
        <section class="parameter-card">
          <header><span>01</span><div><h2>地图尺度</h2><p>使用面积几何平均尺寸并进行平方根缓和缩放。</p></div></header>
          <PressureZoneParameterControl v-model="config.referenceMapSizeMeters" label="参考地图尺寸" description="Effective Size 等于此值时基础缩放为 1。" :min="500" :max="20000" :step="100" unit="m" />
          <PressureZoneParameterControl v-model="config.mapScaleInfluence" label="地图尺寸影响" description="0 表示不随地图变化；1 表示完整采用平方根缩放。" :min="0" :max="1" :step="0.05" unit="×" />
          <PressureZoneParameterControl v-model="config.minMapScale" label="最小缩放系数" description="异常小地图的安全下限。" :min="0.1" :max="2" :step="0.05" unit="×" />
          <PressureZoneParameterControl v-model="config.maxMapScale" label="最大缩放系数" description="异常大地图的安全上限。" :min="0.5" :max="3" :step="0.05" unit="×" />
          <label class="coordinate-mode">
            <span><b>坐标单位</b><small>默认自动识别 UE 厘米与米制坐标。</small></span>
            <span class="coordinate-actions">
              <button type="button" :class="{ active: config.coordinateScaleMeters == null }" @click="config.coordinateScaleMeters = null">自动</button>
              <button type="button" :class="{ active: config.coordinateScaleMeters != null }" @click="config.coordinateScaleMeters = config.coordinateScaleMeters ?? 0.01">手动</button>
              <input v-if="config.coordinateScaleMeters != null" v-model.number="config.coordinateScaleMeters" type="number" min="0.0001" max="1000" step="0.01" />
            </span>
          </label>
        </section>

        <section class="parameter-card hard-card">
          <header><span>02</span><div><h2>Hard 禁入圈</h2><p>基础半径先按地图尺度调整，再由战略第一旗点距离限幅。</p></div></header>
          <PressureZoneParameterControl v-model="config.hard.baseRadiusMeters" label="基础 Hard 半径" description="4km 基准地图附近的理论核心保护半径。" :min="50" :max="3000" :step="25" unit="m" />
          <PressureZoneParameterControl v-model="config.hard.minRadiusMeters" label="正常最小半径" description="正常地图尺度下的最低值；P1 太近时可被突破。" :min="0" :max="3000" :step="25" unit="m" />
          <PressureZoneParameterControl v-model="config.hard.maxRadiusMeters" label="绝对最大半径" description="防止大地图上的保护区无限膨胀。" :min="100" :max="5000" :step="25" unit="m" />
          <PressureZoneParameterControl v-model="config.hard.emergencyMinimumRadiusMeters" label="紧急最小半径" description="当 P1 极近时仍保留的最低主基地核心保护。" :min="0" :max="1000" :step="25" unit="m" />
          <PressureZoneParameterControl v-model="config.hard.maxBaseToFirstObjectiveRatio" label="Main→P1 最大占比" description="Hard 半径最多占 Main 到战略第一旗点距离的比例。" :min="0.05" :max="0.98" :step="0.01" unit="×" />
        </section>

        <section class="parameter-card soft-card">
          <header><span>03</span><div><h2>Soft 警戒圈</h2><p>主要根据本方 P1→P2 的战略间距扩展，不再按地图对角线堆叠。</p></div></header>
          <PressureZoneParameterControl v-model="config.soft.objectiveSpacingRatio" label="P1→P2 间距比例" description="第一段旗点间距中用于 Soft 扩展的比例。" :min="0" :max="1" :step="0.01" unit="×" />
          <PressureZoneParameterControl v-model="config.soft.minExtensionMeters" label="最小扩展" description="Soft 至少比 Hard 多出的距离。" :min="0" :max="2000" :step="25" unit="m" />
          <PressureZoneParameterControl v-model="config.soft.maxExtensionMeters" label="最大扩展" description="旗点很远时限制 Soft 外扩。" :min="0" :max="4000" :step="25" unit="m" />
          <PressureZoneParameterControl v-model="config.soft.fallbackExtensionMeters" label="间距缺失回退" description="没有可用 P1→P2/平均旗点间距时使用。" :min="0" :max="3000" :step="25" unit="m" />
          <PressureZoneParameterControl v-model="config.soft.objectiveSafetyMarginMeters" label="P1 安全余量" description="Soft 边缘与第一旗点至少尝试保留的正常作战空间。" :min="0" :max="3000" :step="25" unit="m" />
        </section>

        <section class="parameter-card combat-card">
          <header><span>04</span><div><h2>Combat Buffer</h2><p>当前双方相邻前线点距是主变量；地图尺寸只允许轻度修正。</p></div></header>
          <PressureZoneParameterControl v-model="config.combat.gapFactor" label="前线点距比例" description="当前相邻交战点距离用于缓冲区半径的比例。" :min="0" :max="1" :step="0.01" unit="×" />
          <PressureZoneParameterControl v-model="config.combat.mapScaleInfluence" label="地图尺寸影响" description="Combat 对地图尺度的敏感度，建议远低于 Hard。" :min="0" :max="1" :step="0.05" unit="×" />
          <PressureZoneParameterControl v-model="config.combat.lateralFactor" label="横向宽度比例" description="胶囊缓冲区横向宽度相对纵向半径的比例。" :min="0.1" :max="3" :step="0.05" unit="×" />
          <PressureZoneParameterControl v-model="config.combat.minRadiusMeters" label="最小缓冲半径" description="交战点很近时仍保留的最低机动空间。" :min="0" :max="3000" :step="25" unit="m" />
          <PressureZoneParameterControl v-model="config.combat.maxRadiusMeters" label="最大缓冲半径" description="交战点很远时防止缓冲区覆盖过多地图。" :min="0" :max="5000" :step="25" unit="m" />
          <PressureZoneParameterControl v-model="config.combat.polygonArcSegments" label="边缘精度" description="SVG 胶囊圆弧分段数。" :min="6" :max="64" :step="1" unit="段" />
        </section>
      </main>

      <section v-if="liveState?.active" class="diagnostics-card">
        <header><strong>当前计算结果</strong><span>用于判断为什么某张地图的圈偏大或偏小。</span></header>
        <div class="diagnostics-grid">
          <div><span>Team 1 Hard</span><b>{{ formatMeters(liveState.bases?.team1?.hardRadius) }}</b><small>{{ limitText(liveState.bases?.team1?.limitingFactor) }}</small></div>
          <div><span>Team 1 Soft</span><b>{{ formatMeters(liveState.bases?.team1?.softRadius) }}</b><small>P1→P2 {{ formatMeters(liveState.bases?.team1?.firstObjectiveSpacing) }}</small></div>
          <div><span>Team 2 Hard</span><b>{{ formatMeters(liveState.bases?.team2?.hardRadius) }}</b><small>{{ limitText(liveState.bases?.team2?.limitingFactor) }}</small></div>
          <div><span>Team 2 Soft</span><b>{{ formatMeters(liveState.bases?.team2?.softRadius) }}</b><small>P1→P2 {{ formatMeters(liveState.bases?.team2?.firstObjectiveSpacing) }}</small></div>
          <div><span>Combat Gap</span><b>{{ formatMeters(liveState.combat?.gapMeters) }}</b><small>{{ limitText(liveState.combat?.limitingFactor) }}</small></div>
          <div><span>Combat Radius</span><b>{{ formatMeters(liveState.combat?.longitudinalRadius) }}</b><small>地图修正 {{ formatScale(liveState.combat?.mapModifier) }}</small></div>
        </div>
        <div v-if="warnings.length" class="warning-list"><span v-for="warning in warnings" :key="warning">{{ warning }}</span></div>
      </section>

      <footer class="save-bar" :class="{ dirty }">
        <div><strong>{{ dirty ? "有未保存修改" : "参数已同步" }}</strong><small>{{ validationError || statusText || "保存后后端立即重算，战术地图下一次状态刷新即可看到新范围。" }}</small></div>
        <button class="button primary" type="button" :disabled="!canSave" @click="saveConfig">{{ saving ? "保存中…" : "保存并立即应用" }}</button>
      </footer>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import PressureZoneParameterControl from "../components/dynamic-pressure-zone/PressureZoneParameterControl.vue";
import {
  fetchDynamicPressureZoneBaseConfig,
  fetchDynamicPressureZoneState,
  saveDynamicPressureZoneBaseConfig,
  type PressureZoneConfig,
  type PressureZoneState,
} from "../app/dynamicPressureZoneApi";

const props = withDefaults(defineProps<{ embedded?: boolean; currentMapSizeMeters?: number | null }>(), {
  embedded: false,
  currentMapSizeMeters: null,
});
const emit = defineEmits<{ (event: "close"): void; (event: "saved"): void }>();

const config = ref<PressureZoneConfig | null>(null);
const defaults = ref<PressureZoneConfig | null>(null);
const liveState = ref<PressureZoneState | null>(null);
const savedSnapshot = ref("");
const loading = ref(true);
const saving = ref(false);
const loadError = ref("");
const statusText = ref("");
const previewSize = ref(props.currentMapSizeMeters ? Math.round(props.currentMapSizeMeters) : 4000);

watch(() => props.currentMapSizeMeters, (value) => {
  if (Number.isFinite(Number(value)) && Number(value) > 0) previewSize.value = Math.round(Number(value));
});

const dirty = computed(() => Boolean(config.value) && JSON.stringify(config.value) !== savedSnapshot.value);
const warnings = computed(() => Array.isArray(liveState.value?.diagnostics?.warnings) ? liveState.value!.diagnostics!.warnings : []);
const liveMapSizeText = computed(() => {
  const map = liveState.value?.map;
  if (!map) return props.currentMapSizeMeters ? `${Math.round(props.currentMapSizeMeters)} m` : "未知";
  return `${Math.round(map.widthMeters)} × ${Math.round(map.heightMeters)} m`;
});

const validationError = computed(() => {
  const value = config.value;
  if (!value) return "";
  const fields: Array<[string, number, number, number]> = [
    ["参考地图尺寸", value.referenceMapSizeMeters, 500, 20000], ["地图尺寸影响", value.mapScaleInfluence, 0, 1], ["最小地图缩放", value.minMapScale, .1, 5], ["最大地图缩放", value.maxMapScale, .1, 5],
    ["Hard 基础半径", value.hard.baseRadiusMeters, 50, 5000], ["Hard 最小半径", value.hard.minRadiusMeters, 0, 10000], ["Hard 最大半径", value.hard.maxRadiusMeters, 0, 20000], ["Hard 紧急最小半径", value.hard.emergencyMinimumRadiusMeters, 0, 5000], ["Main→P1 最大占比", value.hard.maxBaseToFirstObjectiveRatio, .05, .98],
    ["Soft 间距比例", value.soft.objectiveSpacingRatio, 0, 1], ["Soft 最小扩展", value.soft.minExtensionMeters, 0, 10000], ["Soft 最大扩展", value.soft.maxExtensionMeters, 0, 15000], ["Soft 回退扩展", value.soft.fallbackExtensionMeters, 0, 10000], ["Soft P1 安全余量", value.soft.objectiveSafetyMarginMeters, 0, 10000],
    ["Combat 前线比例", value.combat.gapFactor, 0, 2], ["Combat 地图影响", value.combat.mapScaleInfluence, 0, 1], ["Combat 横向比例", value.combat.lateralFactor, .1, 5], ["Combat 最小半径", value.combat.minRadiusMeters, 0, 20000], ["Combat 最大半径", value.combat.maxRadiusMeters, 0, 30000], ["Combat 边缘精度", value.combat.polygonArcSegments, 6, 128],
  ];
  const invalid = fields.find(([, numeric, min, max]) => !Number.isFinite(Number(numeric)) || Number(numeric) < min || Number(numeric) > max);
  if (invalid) return `${invalid[0]}必须在 ${invalid[2]}–${invalid[3]} 之间。`;
  if (value.coordinateScaleMeters != null && (!Number.isFinite(Number(value.coordinateScaleMeters)) || value.coordinateScaleMeters <= 0 || value.coordinateScaleMeters > 1000)) return "手动坐标单位必须大于 0 且不超过 1000。";
  if (value.minMapScale > value.maxMapScale) return "最小地图缩放不能大于最大地图缩放。";
  if (value.hard.minRadiusMeters > value.hard.maxRadiusMeters) return "Hard 最小半径不能大于最大半径。";
  if (value.hard.emergencyMinimumRadiusMeters > value.hard.minRadiusMeters) return "Hard 紧急最小半径不能大于正常最小半径。";
  if (value.soft.minExtensionMeters > value.soft.maxExtensionMeters) return "Soft 最小扩展不能大于最大扩展。";
  if (value.combat.minRadiusMeters > value.combat.maxRadiusMeters) return "Combat 最小半径不能大于最大半径。";
  return "";
});
const canSave = computed(() => dirty.value && !saving.value && !validationError.value);

const preview = computed(() => {
  const value = config.value!;
  const rawScale = Math.sqrt(previewSize.value / value.referenceMapSizeMeters);
  const mapScale = clamp(1 + ((rawScale - 1) * value.mapScaleInfluence), value.minMapScale, value.maxMapScale);
  const baseToP1 = 1000;
  const spacing = 1000;
  let hardRadius = clamp(value.hard.baseRadiusMeters * mapScale, value.hard.minRadiusMeters, value.hard.maxRadiusMeters);
  hardRadius = Math.max(value.hard.emergencyMinimumRadiusMeters, Math.min(hardRadius, baseToP1 * value.hard.maxBaseToFirstObjectiveRatio));
  const extension = clamp(spacing * value.soft.objectiveSpacingRatio, value.soft.minExtensionMeters, value.soft.maxExtensionMeters);
  const softRadius = Math.min(hardRadius + extension, Math.max(hardRadius, baseToP1 - value.soft.objectiveSafetyMarginMeters));
  const combatMapScale = 1 + ((rawScale - 1) * value.combat.mapScaleInfluence);
  const combatRadius = clamp(1000 * value.combat.gapFactor * combatMapScale, value.combat.minRadiusMeters, value.combat.maxRadiusMeters);
  return { rawScale, mapScale, hardRadius, softRadius, combatRadius };
});

onMounted(loadConfig);

async function loadConfig() {
  loading.value = true;
  loadError.value = "";
  try {
    const [configResponse, stateResponse] = await Promise.all([
      fetchDynamicPressureZoneBaseConfig(),
      fetchDynamicPressureZoneState().catch(() => null),
    ]);
    config.value = clone(configResponse.config);
    defaults.value = clone(configResponse.defaults);
    savedSnapshot.value = JSON.stringify(config.value);
    liveState.value = stateResponse?.state ?? null;
    statusText.value = "";
  } catch (error: any) {
    loadError.value = error?.message || String(error);
  } finally {
    loading.value = false;
  }
}

function loadDefaults() {
  if (!defaults.value) return;
  config.value = clone(defaults.value);
  statusText.value = "已载入默认值，尚未保存。";
}

async function saveConfig() {
  if (!config.value || !canSave.value) return;
  saving.value = true;
  statusText.value = "";
  try {
    const response = await saveDynamicPressureZoneBaseConfig(config.value);
    config.value = clone(response.config);
    savedSnapshot.value = JSON.stringify(config.value);
    const stateResponse = await fetchDynamicPressureZoneState().catch(() => null);
    liveState.value = stateResponse?.state ?? liveState.value;
    statusText.value = "已保存并重算当前压家圈。";
    emit("saved");
  } catch (error: any) {
    statusText.value = `保存失败：${error?.message || String(error)}`;
  } finally {
    saving.value = false;
  }
}

function clone<T>(value: T): T { return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function clamp(value: number, min: number, max: number) { return Math.min(Math.max(Number(value), Number(min)), Number(max)); }
function formatMeters(value: unknown) { const numeric = Number(value); return Number.isFinite(numeric) ? `${Math.round(numeric)} m` : "—"; }
function formatScale(value: unknown) { const numeric = Number(value); return Number.isFinite(numeric) ? `${numeric.toFixed(2)}×` : "—"; }
function limitText(value: unknown) {
  switch (String(value ?? "")) {
    case "objective-distance": return "受 Main→P1 限制";
    case "maximum-radius": return "受最大半径限制";
    case "minimum-radius": return "受最小半径限制";
    case "map-scale": return "由地图尺度决定";
    case "objective-safety-margin": return "受 P1 安全余量限制";
    case "front-gap": return "由前线点距决定";
    default: return String(value ?? "—");
  }
}
</script>

<style scoped>
.pressure-settings-page{min-height:100%;padding:20px;color:#dbe7f3;background:#07101a}.pressure-settings-page.embedded{padding:12px;background:transparent}.settings-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:14px}.settings-header h1{margin:2px 0 4px;font-size:23px}.settings-header p{margin:4px 0 0;max-width:820px;color:#8195a8;font-size:12px;line-height:1.5}.eyebrow{color:#2dd4bf!important;font:700 10px ui-monospace,monospace;letter-spacing:.12em}.header-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}.button{min-height:34px;padding:0 12px;border:1px solid rgba(148,163,184,.28);border-radius:8px;color:#dbe7f3;background:rgba(15,23,42,.8);cursor:pointer;text-decoration:none}.button.primary{border-color:rgba(45,212,191,.6);background:rgba(13,148,136,.22)}.button:disabled{opacity:.45;cursor:default}.state-card,.validation-banner{padding:14px;border:1px solid rgba(148,163,184,.2);border-radius:10px;background:rgba(15,23,42,.7)}.state-card.error,.validation-banner{color:#fecaca;border-color:rgba(248,113,113,.35)}.live-map-card{display:grid;grid-template-columns:repeat(6,minmax(120px,1fr));gap:8px;margin-bottom:10px}.live-map-card>div,.preview-stat{padding:10px;border:1px solid rgba(148,163,184,.16);border-radius:9px;background:rgba(9,18,30,.78)}.live-map-card span,.preview-stat span{display:block;color:#71869a;font-size:10px}.live-map-card strong,.preview-stat strong{display:block;margin-top:4px;color:#edf6ff;font:700 13px ui-monospace,monospace}.reference-strip{display:grid;grid-template-columns:minmax(220px,1.5fr) auto repeat(5,minmax(90px,.55fr));gap:8px;align-items:stretch;margin-bottom:12px}.reference-heading{padding:10px 12px;border-left:3px solid #2dd4bf;background:rgba(13,148,136,.08)}.reference-heading strong,.reference-heading span{display:block}.reference-heading span{margin-top:4px;color:#7f95aa;font-size:10px;line-height:1.4}.preview-control{padding:8px 10px;border:1px solid rgba(148,163,184,.16);border-radius:9px;background:rgba(9,18,30,.78)}.preview-control>span{display:block;margin-bottom:6px;color:#71869a;font-size:10px}.segmented{display:flex;gap:4px}.segmented button,.coordinate-actions button{border:1px solid rgba(148,163,184,.2);border-radius:6px;padding:5px 7px;color:#9db0c3;background:rgba(15,23,42,.8);cursor:pointer}.segmented button.active,.coordinate-actions button.active{color:#ccfbf1;border-color:rgba(45,212,191,.5);background:rgba(13,148,136,.2)}.preview-stat.hard strong{color:#fca5a5}.preview-stat.soft strong{color:#fdba74}.preview-stat.combat strong{color:#fde047}.validation-banner{margin-bottom:10px}.parameter-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.parameter-card{padding:14px 16px;border:1px solid rgba(148,163,184,.17);border-radius:12px;background:rgba(9,18,30,.78)}.parameter-card>header{display:flex;gap:10px;padding-bottom:9px;border-bottom:1px solid rgba(148,163,184,.12)}.parameter-card>header>span{color:#2dd4bf;font:700 11px ui-monospace,monospace}.parameter-card h2{margin:0;font-size:15px}.parameter-card header p{margin:3px 0 0;color:#71869a;font-size:10px}.hard-card{border-top-color:rgba(248,113,113,.55)}.soft-card{border-top-color:rgba(251,146,60,.55)}.combat-card{border-top-color:rgba(250,204,21,.55)}.coordinate-mode{display:grid;grid-template-columns:minmax(160px,1fr) minmax(200px,1.2fr);gap:16px;align-items:center;min-height:64px}.coordinate-mode>span:first-child{display:flex;flex-direction:column;gap:3px}.coordinate-mode b{font-size:13px}.coordinate-mode small{color:#7f95aa;font-size:11px}.coordinate-actions{display:flex;align-items:center;gap:6px}.coordinate-actions input{width:90px;padding:6px;border:1px solid rgba(148,163,184,.25);border-radius:6px;color:#e2e8f0;background:#07101a}.diagnostics-card{margin-top:12px;padding:14px;border:1px solid rgba(45,212,191,.2);border-radius:12px;background:rgba(8,25,30,.55)}.diagnostics-card header{display:flex;gap:10px;align-items:baseline;margin-bottom:10px}.diagnostics-card header span{color:#71869a;font-size:10px}.diagnostics-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:8px}.diagnostics-grid>div{padding:9px;border-radius:8px;background:rgba(2,6,23,.45)}.diagnostics-grid span,.diagnostics-grid small{display:block;color:#71869a;font-size:9px}.diagnostics-grid b{display:block;margin:3px 0;font:700 12px ui-monospace,monospace}.warning-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}.warning-list span{padding:4px 7px;border-radius:6px;color:#fed7aa;background:rgba(154,52,18,.22);font:10px ui-monospace,monospace}.save-bar{position:sticky;bottom:0;display:flex;justify-content:space-between;gap:16px;align-items:center;margin-top:14px;padding:10px 12px;border:1px solid rgba(148,163,184,.16);border-radius:10px;background:rgba(4,12,22,.95)}.save-bar>div{display:flex;flex-direction:column}.save-bar small{color:#71869a}.save-bar.dirty{border-color:rgba(45,212,191,.4)}@media(max-width:1200px){.live-map-card{grid-template-columns:repeat(3,1fr)}.reference-strip{grid-template-columns:repeat(3,1fr)}.reference-heading,.preview-control{grid-column:1/-1}.diagnostics-grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:820px){.settings-header{flex-direction:column}.parameter-grid{grid-template-columns:1fr}.live-map-card,.diagnostics-grid{grid-template-columns:repeat(2,1fr)}}
</style>
