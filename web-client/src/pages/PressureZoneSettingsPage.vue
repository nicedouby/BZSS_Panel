<template>
  <div class="pressure-settings-page">
    <header class="settings-header">
      <div class="title-block">
        <span class="title-icon">◎</span>
        <div>
          <p class="eyebrow">PRESSURE ZONE POLICY</p>
          <h1>压家圈基础参数</h1>
          <p>这里设置全服务器通用的压家圈计算规则；战术地图与模拟器统一引用。</p>
        </div>
      </div>
      <div class="header-actions">
        <RouterLink class="button ghost" to="/debug/pressure-zone">前往地图模拟器</RouterLink>
        <button class="button ghost" type="button" :disabled="loading || saving" @click="loadDefaults">载入默认值</button>
        <button class="button primary" type="button" :disabled="!canSave" @click="saveConfig">
          {{ saving ? "保存中…" : dirty ? "保存并应用" : "已保存" }}
        </button>
      </div>
    </header>

    <div v-if="loading" class="state-card">正在读取基础参数…</div>
    <div v-else-if="loadError" class="state-card error">
      <strong>基础参数读取失败</strong><span>{{ loadError }}</span><button type="button" @click="loadConfig">重试</button>
    </div>
    <template v-else-if="config">
      <section class="reference-strip">
        <div class="reference-heading">
          <strong>参数效果基准</strong>
          <span>不是地图模拟：固定使用最近点 900 m、前线 2400 m、交战点距 1 km，帮助确认每次调整确实改变结果。</span>
        </div>
        <div class="preview-control">
          <span>地图边长基准</span>
          <div class="segmented">
            <button v-for="size in [2000, 4000, 6000, 8000]" :key="size" type="button" :class="{ active: previewSize === size }" @click="previewSize = size">{{ size / 1000 }} km</button>
          </div>
        </div>
        <div class="preview-stat"><span>地图缩放系数</span><strong>{{ preview.mapScale.toFixed(2) }}</strong></div>
        <div class="preview-stat hard"><span>Hard 最终半径</span><strong>{{ Math.round(preview.hardRadius) }} m</strong></div>
        <div class="preview-stat soft"><span>Soft 最终半径</span><strong>{{ Math.round(preview.softRadius) }} m</strong></div>
        <div class="preview-stat combat"><span>1 km 点距缓冲</span><strong>{{ Math.round(preview.combatRadius) }} m</strong></div>
      </section>

      <div class="settings-layout">
        <nav class="section-nav" aria-label="参数分组">
          <a href="#map-policy"><span>01</span><b>地图缩放</b><small>尺寸与坐标单位</small></a>
          <a href="#hard-policy"><span>02</span><b>Hard 禁入圈</b><small>主基地核心范围</small></a>
          <a href="#soft-policy"><span>03</span><b>Soft 警戒圈</b><small>基地外层缓冲</small></a>
          <a href="#combat-policy"><span>04</span><b>交战缓冲区</b><small>当前交战点范围</small></a>
          <div class="inheritance-note">
            <strong>统一参数来源</strong>
            <span>保存后立即用于战术地图；Layer 只保存地图几何，不再覆盖本页参数。</span>
          </div>
        </nav>

        <main class="parameter-sections">
          <section id="map-policy" class="parameter-card map-card">
            <header><span>01</span><div><h2>地图缩放</h2><p>统一不同地图尺寸产生的交战区大小差异。</p></div></header>
            <div class="parameter-list">
              <PressureZoneParameterControl v-model="config.baseRadiusMultiplier" label="基地圈整体倍率" description="最直观的整体大小控制，同时放大或缩小 Hard 与 Soft 的公式结果；最小/最大半径及前线安全距离仍会限制最终范围。" :min="0.25" :max="4" :step="0.05" unit="×" />
              <PressureZoneParameterControl v-model="config.referenceDiagonalMeters" label="参考对角线" description="达到此对角线长度时，地图缩放系数为 1。" :min="500" :max="20000" :step="100" unit="m" />
              <PressureZoneParameterControl v-model="config.minMapScale" label="最小缩放系数" description="小地图不会低于此倍率。" :min="0.1" :max="5" :step="0.05" unit="×" />
              <PressureZoneParameterControl v-model="config.maxMapScale" label="最大缩放系数" description="大地图不会高于此倍率。" :min="0.1" :max="5" :step="0.05" unit="×" />
              <label class="coordinate-mode">
                <span><b>坐标单位</b><small>默认自动识别 UE 厘米坐标与米制坐标。</small></span>
                <span class="coordinate-actions"><button type="button" :class="{ active: config.coordinateScaleMeters == null }" @click="config.coordinateScaleMeters = null">自动识别</button><button type="button" :class="{ active: config.coordinateScaleMeters != null }" @click="config.coordinateScaleMeters = config.coordinateScaleMeters ?? 0.01">手动</button><input v-if="config.coordinateScaleMeters != null" v-model.number="config.coordinateScaleMeters" type="number" min="0.0001" max="1000" step="0.01" /><em v-if="config.coordinateScaleMeters != null">m / 单位</em></span>
              </label>
            </div>
          </section>

          <section id="hard-policy" class="parameter-card hard-card">
            <header><span>02</span><div><h2>Hard 禁入圈</h2><p>玩家进入后直接判定为压家。地图贡献与最近点贡献相加，再由最小/最大半径和前线安全距离限制。</p></div></header>
            <div class="parameter-list">
              <PressureZoneParameterControl v-model="config.hard.mapFactor" label="地图比例" description="地图对角线参与 Hard 半径计算的比例。" :min="0" :max="0.5" :step="0.005" unit="×" />
              <PressureZoneParameterControl v-model="config.hard.nearestObjectiveFactor" label="最近点比例" description="Main 到最近旗点距离参与计算的比例。" :min="0" :max="2" :step="0.05" unit="×" />
              <PressureZoneParameterControl v-model="config.hard.minRadiusMeters" label="最小半径" description="任何地图上的 Hard 圈都不会更小。" :min="0" :max="3000" :step="25" unit="m" />
              <PressureZoneParameterControl v-model="config.hard.maxRadiusMeters" label="最大半径" description="任何地图上的 Hard 圈都不会更大。" :min="0" :max="5000" :step="25" unit="m" />
              <PressureZoneParameterControl v-model="config.hard.frontSafetyMarginMeters" label="前线安全余量" description="Hard 圈边缘与当前己方前线点至少保留的机动距离。" :min="0" :max="3000" :step="25" unit="m" />
            </div>
          </section>

          <section id="soft-policy" class="parameter-card soft-card">
            <header><span>03</span><div><h2>Soft 警戒圈</h2><p>Hard 圈外的预警范围，同样采用地图贡献与最近点贡献相加，并保证至少比 Hard 多出指定距离。</p></div></header>
            <div class="parameter-list">
              <PressureZoneParameterControl v-model="config.soft.mapFactor" label="地图比例" description="地图对角线参与 Soft 半径计算的比例。" :min="0" :max="1" :step="0.01" unit="×" />
              <PressureZoneParameterControl v-model="config.soft.nearestObjectiveFactor" label="最近点比例" description="Main 到最近旗点距离参与计算的比例。" :min="0" :max="3" :step="0.05" unit="×" />
              <PressureZoneParameterControl v-model="config.soft.minExtraOverHardMeters" label="Hard 外额外距离" description="保证 Soft 圈至少比 Hard 圈向外扩展的距离。" :min="0" :max="3000" :step="25" unit="m" />
              <PressureZoneParameterControl v-model="config.soft.maxRadiusMeters" label="最大半径" description="限制 Soft 圈在大地图上无限扩大。" :min="0" :max="10000" :step="50" unit="m" />
              <PressureZoneParameterControl v-model="config.soft.frontSafetyMarginMeters" label="前线安全余量" description="Soft 圈边缘与当前己方前线点保留的距离。" :min="0" :max="3000" :step="25" unit="m" />
            </div>
          </section>

          <section id="combat-policy" class="parameter-card combat-card">
            <header><span>04</span><div><h2>交战缓冲区</h2><p>围绕双方相邻已控点生成缓冲区，进入此处不计为压家。</p></div></header>
            <div class="parameter-list">
              <PressureZoneParameterControl v-model="config.combat.gapFactor" label="交战点距比例" description="双方交战点距离参与缓冲区长度计算的比例。" :min="0" :max="3" :step="0.05" unit="×" />
              <PressureZoneParameterControl v-model="config.combat.lateralFactor" label="横向宽度比例" description="缓冲区横向宽度相对于纵向半径的比例。" :min="0" :max="3" :step="0.05" unit="×" />
              <PressureZoneParameterControl v-model="config.combat.minRadiusMeters" label="最小半径" description="交战点很近时仍保留的最低机动空间。" :min="0" :max="5000" :step="25" unit="m" />
              <PressureZoneParameterControl v-model="config.combat.maxRadiusMeters" label="最大半径" description="交战点很远时限制缓冲区规模。" :min="0" :max="10000" :step="50" unit="m" />
              <PressureZoneParameterControl v-model="config.combat.polygonArcSegments" label="边缘精度" description="缓冲区圆弧分段数；越高越平滑，但 SVG 点数也越多。" :min="6" :max="64" :step="1" unit="段" />
            </div>
          </section>
        </main>
      </div>

      <footer class="save-bar" :class="{ dirty }">
        <div><span class="save-dot"></span><strong>{{ dirty ? "有未保存的参数修改" : "基础参数已同步" }}</strong><small>{{ validationError || statusText || "保存后会立即重算当前战术地图压家圈。" }}</small></div>
        <button class="button primary" type="button" :disabled="!canSave" @click="saveConfig">{{ saving ? "保存中…" : "保存并立即应用" }}</button>
      </footer>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import PressureZoneParameterControl from "../components/dynamic-pressure-zone/PressureZoneParameterControl.vue";
import { fetchDynamicPressureZoneBaseConfig, saveDynamicPressureZoneBaseConfig, type PressureZoneConfig } from "../app/dynamicPressureZoneApi";

const config = ref<PressureZoneConfig | null>(null);
const defaults = ref<PressureZoneConfig | null>(null);
const savedSnapshot = ref("");
const loading = ref(true);
const saving = ref(false);
const loadError = ref("");
const statusText = ref("");
const previewSize = ref(4000);

const dirty = computed(() => Boolean(config.value) && JSON.stringify(config.value) !== savedSnapshot.value);
const validationError = computed(() => {
  if (!config.value) return "";
  const value = config.value;
  const fields: Array<[string, number, number, number]> = [
    ["参考对角线", value.referenceDiagonalMeters, 500, 20000], ["最小地图缩放", value.minMapScale, .1, 5], ["最大地图缩放", value.maxMapScale, .1, 5],
    ["基地圈整体倍率", value.baseRadiusMultiplier, .25, 4],
    ["Hard 地图比例", value.hard.mapFactor, 0, 2], ["Hard 最近点比例", value.hard.nearestObjectiveFactor, 0, 3], ["Hard 最小半径", value.hard.minRadiusMeters, 0, 10000], ["Hard 最大半径", value.hard.maxRadiusMeters, 0, 20000], ["Hard 安全余量", value.hard.frontSafetyMarginMeters, 0, 10000],
    ["Soft 地图比例", value.soft.mapFactor, 0, 3], ["Soft 最近点比例", value.soft.nearestObjectiveFactor, 0, 5], ["Soft 额外距离", value.soft.minExtraOverHardMeters, 0, 10000], ["Soft 最大半径", value.soft.maxRadiusMeters, 0, 30000], ["Soft 安全余量", value.soft.frontSafetyMarginMeters, 0, 10000],
    ["交战点距比例", value.combat.gapFactor, 0, 5], ["交战横向比例", value.combat.lateralFactor, 0, 5], ["交战最小半径", value.combat.minRadiusMeters, 0, 20000], ["交战最大半径", value.combat.maxRadiusMeters, 0, 30000], ["交战边缘精度", value.combat.polygonArcSegments, 6, 128],
  ];
  const invalid = fields.find(([, numeric, min, max]) => !Number.isFinite(Number(numeric)) || Number(numeric) < min || Number(numeric) > max);
  if (invalid) return `${invalid[0]}必须在 ${invalid[2]}–${invalid[3]} 之间。`;
  if (value.coordinateScaleMeters != null && (!Number.isFinite(Number(value.coordinateScaleMeters)) || value.coordinateScaleMeters <= 0 || value.coordinateScaleMeters > 1000)) return "手动坐标单位必须大于 0 且不超过 1000。";
  if (value.minMapScale > value.maxMapScale) return "最小缩放系数不能大于最大缩放系数。";
  if (value.hard.minRadiusMeters > value.hard.maxRadiusMeters) return "Hard 最小半径不能大于最大半径。";
  if (value.combat.minRadiusMeters > value.combat.maxRadiusMeters) return "交战区最小半径不能大于最大半径。";
  return "";
});
const canSave = computed(() => dirty.value && !saving.value && !validationError.value);
const preview = computed(() => {
  const value = config.value!;
  const diagonal = Math.hypot(previewSize.value, previewSize.value);
  const mapScale = clamp(diagonal / value.referenceDiagonalMeters, value.minMapScale, value.maxMapScale);
  const nearestObjectiveDistance = 900;
  const frontDistance = 2400;
  const hardRaw = (
    (diagonal * value.hard.mapFactor)
    + (nearestObjectiveDistance * value.hard.nearestObjectiveFactor)
  ) * value.baseRadiusMultiplier;
  const hardClamped = clamp(hardRaw, value.hard.minRadiusMeters, value.hard.maxRadiusMeters);
  const hardRadius = Math.min(
    hardClamped,
    Math.max(value.hard.minRadiusMeters, frontDistance - value.hard.frontSafetyMarginMeters),
  );
  const softFloor = hardRadius + value.soft.minExtraOverHardMeters;
  const softRaw = (
    (diagonal * value.soft.mapFactor)
    + (nearestObjectiveDistance * value.soft.nearestObjectiveFactor)
  ) * value.baseRadiusMultiplier;
  const softClamped = clamp(softRaw, softFloor, Math.max(softFloor, value.soft.maxRadiusMeters));
  const softRadius = Math.min(
    softClamped,
    Math.max(softFloor, frontDistance - value.soft.frontSafetyMarginMeters),
  );
  return {
    mapScale,
    hardRadius,
    softRadius,
    combatRadius: clamp(1000 * value.combat.gapFactor * mapScale, value.combat.minRadiusMeters, value.combat.maxRadiusMeters),
  };
});

function cloneConfig(value: PressureZoneConfig) { return JSON.parse(JSON.stringify(value)) as PressureZoneConfig; }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

async function loadConfig() {
  loading.value = true; loadError.value = ""; statusText.value = "";
  try {
    const response = await fetchDynamicPressureZoneBaseConfig();
    config.value = cloneConfig(response.config);
    defaults.value = cloneConfig(response.defaults);
    savedSnapshot.value = JSON.stringify(response.config);
  } catch (error: any) { loadError.value = error?.message ?? "无法读取基础参数"; }
  finally { loading.value = false; }
}

function loadDefaults() {
  if (!defaults.value) return;
  config.value = cloneConfig(defaults.value);
  statusText.value = "已载入系统默认值，保存后才会应用。";
}

async function saveConfig() {
  if (!config.value || !canSave.value) return;
  saving.value = true; statusText.value = "";
  try {
    const response = await saveDynamicPressureZoneBaseConfig(config.value);
    config.value = cloneConfig(response.config);
    savedSnapshot.value = JSON.stringify(response.config);
    statusText.value = "保存成功，当前压家区域已重新计算。";
  } catch (error: any) { statusText.value = error?.message ?? "保存失败"; }
  finally { saving.value = false; }
}

onMounted(loadConfig);
</script>

<style scoped>
.pressure-settings-page { min-height: 100%; padding: 18px; padding-bottom: 92px; color: #dbeafe; background: radial-gradient(circle at 50% -10%, rgba(20, 69, 96, .48), transparent 38%), #040912; }
.settings-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; max-width: 1280px; margin: 0 auto 14px; padding: 16px 18px; border: 1px solid rgba(94, 234, 212, .2); border-radius: 14px; background: rgba(7, 18, 31, .92); }
.title-block { display: flex; align-items: center; gap: 14px; }.title-icon { width: 44px; height: 44px; display: grid; place-items: center; flex: none; border: 1px solid rgba(45, 212, 191, .4); border-radius: 12px; background: rgba(13, 148, 136, .12); color: #5eead4; font-size: 25px; }.eyebrow { margin: 0 0 3px; color: #5eead4; font: 700 10px ui-monospace, monospace; letter-spacing: .16em; }.settings-header h1 { margin: 0; font-size: 22px; }.settings-header p:not(.eyebrow) { margin: 4px 0 0; color: #8198ad; font-size: 12px; }.header-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.button { min-height: 36px; display: inline-flex; align-items: center; justify-content: center; padding: 0 13px; border: 1px solid rgba(148, 163, 184, .28); border-radius: 8px; color: #dbeafe; background: rgba(15, 29, 47, .9); text-decoration: none; cursor: pointer; }.button.primary { border-color: #2dd4bf; background: #0f766e; color: white; font-weight: 700; }.button:disabled { opacity: .45; cursor: default; }.button:not(:disabled):hover { border-color: #5eead4; }
.state-card { max-width: 1280px; margin: 0 auto; padding: 28px; border: 1px solid rgba(148, 163, 184, .2); border-radius: 12px; background: rgba(7, 18, 31, .86); color: #9fb3c6; }.state-card.error { display: flex; gap: 12px; align-items: center; border-color: rgba(248, 113, 113, .35); color: #fecaca; }.state-card button { margin-left: auto; }
.reference-strip { max-width: 1280px; display: grid; grid-template-columns: minmax(230px, 1.4fr) repeat(4, minmax(125px, .7fr)); gap: 8px; margin: 0 auto 14px; }.reference-heading { grid-column: 1 / -1; display: flex; align-items: baseline; gap: 10px; padding: 0 2px; }.reference-heading strong { color: #c9d9e8; font-size: 12px; }.reference-heading span { color: #6f879d; font-size: 10px; }.preview-control,.preview-stat { min-height: 66px; display: flex; flex-direction: column; justify-content: center; gap: 7px; padding: 10px 12px; border: 1px solid rgba(148, 163, 184, .17); border-radius: 10px; background: rgba(7, 18, 31, .82); }.preview-control>span,.preview-stat span { color: #738ba2; font-size: 10px; }.preview-stat strong { font: 700 18px ui-monospace, monospace; }.preview-stat.hard strong { color: #fca5a5; }.preview-stat.soft strong { color: #fdba74; }.preview-stat.combat strong { color: #5eead4; }.segmented { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3px; }.segmented button,.coordinate-actions button { padding: 5px 7px; border: 1px solid transparent; border-radius: 6px; background: rgba(148, 163, 184, .08); color: #8fa8bf; cursor: pointer; }.segmented button.active,.coordinate-actions button.active { border-color: rgba(45, 212, 191, .42); background: rgba(13, 148, 136, .2); color: #99f6e4; }
.settings-layout { max-width: 1280px; display: grid; grid-template-columns: 230px minmax(0, 1fr); align-items: start; gap: 14px; margin: 0 auto; }.section-nav { position: sticky; top: 12px; display: grid; gap: 5px; padding: 9px; border: 1px solid rgba(148, 163, 184, .17); border-radius: 12px; background: rgba(7, 18, 31, .9); }.section-nav>a { display: grid; grid-template-columns: 30px 1fr; gap: 0 8px; padding: 10px; border-radius: 8px; color: #dbeafe; text-decoration: none; }.section-nav>a:hover { background: rgba(45, 212, 191, .08); }.section-nav>a>span { grid-row: 1 / 3; color: #477189; font: 700 12px ui-monospace, monospace; }.section-nav b { font-size: 12px; }.section-nav small { margin-top: 3px; color: #70879c; font-size: 10px; }.inheritance-note { display: grid; gap: 5px; margin-top: 6px; padding: 10px; border-top: 1px solid rgba(148, 163, 184, .12); color: #7890a7; font-size: 10px; }.inheritance-note strong { color: #9fb3c6; }
.parameter-sections { display: grid; gap: 12px; }.parameter-card { scroll-margin-top: 12px; overflow: hidden; border: 1px solid rgba(148, 163, 184, .18); border-radius: 12px; background: rgba(7, 18, 31, .88); }.parameter-card>header { display: flex; align-items: center; gap: 12px; padding: 14px 17px; border-bottom: 1px solid rgba(148, 163, 184, .13); background: rgba(255, 255, 255, .018); }.parameter-card>header>span { color: #4d7188; font: 700 11px ui-monospace, monospace; }.parameter-card h2 { margin: 0; font-size: 15px; }.parameter-card header p { margin: 4px 0 0; color: #7890a7; font-size: 11px; }.hard-card { border-left: 3px solid #ef4444; }.soft-card { border-left: 3px solid #f97316; }.combat-card { border-left: 3px solid #14b8a6; }.map-card { border-left: 3px solid #38bdf8; }.parameter-list { padding: 0 17px; }
.coordinate-mode { min-height: 76px; display: grid; grid-template-columns: minmax(180px, .9fr) minmax(240px, 1.1fr); align-items: center; gap: 20px; padding: 12px 0; }.coordinate-mode>span:first-child { display: grid; gap: 4px; }.coordinate-mode b { font-size: 13px; }.coordinate-mode small { color: #7f95aa; font-size: 11px; }.coordinate-actions { display: flex; align-items: center; gap: 6px; }.coordinate-actions input { width: 90px; padding: 7px; border: 1px solid rgba(148, 163, 184, .28); border-radius: 7px; background: #06101b; color: #e2e8f0; }.coordinate-actions em { color: #7890a7; font: normal 10px ui-monospace, monospace; }
.save-bar { position: fixed; z-index: 20; right: 20px; bottom: 16px; left: max(20px, calc(var(--app-sidebar-width, 0px) + 20px)); max-width: 1240px; display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: auto; padding: 11px 13px; border: 1px solid rgba(148, 163, 184, .22); border-radius: 11px; background: rgba(5, 13, 24, .96); box-shadow: 0 16px 36px rgba(0, 0, 0, .32); }.save-bar>div { display: grid; grid-template-columns: auto auto; align-items: center; gap: 2px 8px; }.save-dot { width: 7px; height: 7px; grid-row: 1 / 3; border-radius: 50%; background: #34d399; }.save-bar.dirty .save-dot { background: #f59e0b; box-shadow: 0 0 10px rgba(245, 158, 11, .8); }.save-bar strong { font-size: 12px; }.save-bar small { color: #7890a7; font-size: 10px; }
@media (max-width: 980px) { .settings-header { align-items: flex-start; }.reference-strip { grid-template-columns: repeat(4, 1fr); }.preview-control { grid-column: 1 / -1; }.settings-layout { grid-template-columns: 1fr; }.section-nav { position: static; grid-template-columns: repeat(4, 1fr); }.inheritance-note { display: none; }.section-nav>a { grid-template-columns: 1fr; }.section-nav>a>span,.section-nav small { display: none; } }
@media (max-width: 720px) { .pressure-settings-page { padding: 10px 10px 92px; }.settings-header { flex-direction: column; }.header-actions { width: 100%; justify-content: stretch; }.header-actions>* { flex: 1; }.reference-strip { grid-template-columns: 1fr 1fr; }.reference-heading { display: grid; gap: 4px; }.preview-control { grid-column: 1 / -1; }.section-nav { grid-template-columns: 1fr 1fr; }.coordinate-mode { grid-template-columns: 1fr; gap: 9px; }.coordinate-actions { flex-wrap: wrap; }.save-bar { right: 10px; bottom: 10px; left: 10px; }.save-bar small { display: none; } }
</style>
