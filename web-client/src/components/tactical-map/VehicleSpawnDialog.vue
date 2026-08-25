<template>
  <Teleport to="body">
    <div class="vehicle-spawn-backdrop" @pointerdown.self="!pending && emit('close')">
      <section class="vehicle-spawn-dialog" role="dialog" aria-modal="true" aria-labelledby="vehicle-spawn-title">
        <header>
          <div>
            <span>TACTICAL VEHICLE SPAWN</span>
            <h2 id="vehicle-spawn-title">在地图位置创建载具</h2>
          </div>
          <button type="button" class="icon-button" :disabled="pending" aria-label="关闭" @click="emit('close')">×</button>
        </header>

        <div class="vehicle-spawn-coordinates">
          <label>X <input v-model.number="form.x" type="number" step="1" /></label>
          <label>Y <input v-model.number="form.y" type="number" step="1" /></label>
          <label>Z <input v-model.number="form.z" type="number" step="1" /></label>
        </div>
        <p class="height-note">{{ target.heightNote }}</p>

        <div class="vehicle-spawn-filters">
          <input v-model.trim="search" type="search" placeholder="搜索载具名称或资产路径" autofocus />
          <select v-model="category">
            <option value="">全部分类</option>
            <option v-for="item in categories" :key="item" :value="item">{{ item }}</option>
          </select>
        </div>

        <div class="vehicle-spawn-list" role="listbox" aria-label="载具资产">
          <button
            v-for="asset in filteredAssets"
            :key="asset.path"
            type="button"
            class="vehicle-spawn-list__item"
            :class="{ 'is-selected': asset.path === form.assetPath }"
            @click="form.assetPath = asset.path"
          >
            <strong>{{ asset.name }}</strong>
            <span>{{ asset.category }}</span>
            <small>{{ asset.path }}</small>
          </button>
          <p v-if="filteredAssets.length === 0" class="empty-state">没有匹配的载具资产</p>
        </div>

        <label class="vehicle-spawn-path">
          <span>Class 路径（可手动修改）</span>
          <input v-model.trim="form.assetPath" spellcheck="false" placeholder="/Game/Vehicles/.../BP_Name.BP_Name_C" />
        </label>

        <footer>
          <div>
            <strong>{{ selectedName || "尚未选择载具" }}</strong>
            <span>{{ commandPreview }}</span>
          </div>
          <button type="button" class="secondary-button" :disabled="pending" @click="emit('close')">取消</button>
          <button type="button" class="primary-button" :disabled="pending || !isValid" @click="submit">
            {{ pending ? "正在创建…" : "确认创建" }}
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { VEHICLE_SPAWN_ASSETS } from "../../shared/vehicle-spawn-assets";

const props = defineProps<{
  target: { x: number; y: number; z: number; heightNote: string };
  pending: boolean;
}>();

const emit = defineEmits<{
  (event: "close"): void;
  (event: "confirm", payload: { assetPath: string; x: number; y: number; z: number }): void;
}>();

const search = ref("");
const category = ref("");
const form = reactive({
  assetPath: "",
  x: 0,
  y: 0,
  z: 0,
});

watch(
  () => props.target,
  (target) => {
    form.x = Math.round(Number(target.x) || 0);
    form.y = Math.round(Number(target.y) || 0);
    form.z = Math.round(Number(target.z) || 0);
  },
  { immediate: true, deep: true },
);

const categories = [...new Set(VEHICLE_SPAWN_ASSETS.map((asset) => asset.category))]
  .sort((a, b) => a.localeCompare(b));

const filteredAssets = computed(() => {
  const needle = search.value.toLocaleLowerCase();
  return VEHICLE_SPAWN_ASSETS
    .filter((asset) => !category.value || asset.category === category.value)
    .filter((asset) => {
      if (!needle) return true;
      return asset.name.toLocaleLowerCase().includes(needle)
        || asset.category.toLocaleLowerCase().includes(needle)
        || asset.path.toLocaleLowerCase().includes(needle);
    })
    .slice(0, 180);
});

const selectedName = computed(() => (
  VEHICLE_SPAWN_ASSETS.find((asset) => asset.path === form.assetPath)?.name ?? ""
));
const validClassPath = computed(() => /^\/Game\/[A-Za-z0-9_./-]+\.[A-Za-z0-9_-]+_C$/.test(form.assetPath));
const validCoordinates = computed(() => [form.x, form.y, form.z].every((value) => Number.isFinite(Number(value))));
const isValid = computed(() => validClassPath.value && validCoordinates.value);
const commandPreview = computed(() => (
  isValid.value
    ? `SpawnVehicle:${form.assetPath},${Math.round(form.x)},${Math.round(form.y)},${Math.round(form.z)}`
    : "请选择 _C 格式载具资产并检查坐标"
));

function submit() {
  if (!isValid.value || props.pending) return;
  emit("confirm", {
    assetPath: form.assetPath,
    x: Math.round(Number(form.x)),
    y: Math.round(Number(form.y)),
    z: Math.round(Number(form.z)),
  });
}
</script>

<style scoped>
.vehicle-spawn-backdrop {
  position: fixed;
  inset: 0;
  z-index: 5000;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(2, 6, 23, .76);
  backdrop-filter: blur(8px);
}

.vehicle-spawn-dialog {
  width: min(860px, 96vw);
  max-height: min(780px, 92vh);
  display: grid;
  grid-template-rows: auto auto auto auto minmax(180px, 1fr) auto auto;
  gap: 12px;
  padding: 18px;
  overflow: hidden;
  border: 1px solid rgba(52, 211, 153, .42);
  border-radius: 16px;
  color: #dcebf3;
  background: linear-gradient(155deg, rgba(8, 27, 43, .99), rgba(2, 10, 22, .99));
  box-shadow: 0 30px 90px rgba(0, 0, 0, .66);
}

header, footer, .vehicle-spawn-coordinates, .vehicle-spawn-filters {
  display: flex;
  align-items: center;
  gap: 10px;
}

header { justify-content: space-between; }
header span { color: #5eead4; font-size: 10px; letter-spacing: .16em; }
h2 { margin: 3px 0 0; font-size: 20px; }
button, input, select { font: inherit; }
button { cursor: pointer; }

.icon-button {
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 9px;
  color: #cbd5e1;
  background: rgba(148, 163, 184, .12);
  font-size: 24px;
}

.vehicle-spawn-coordinates label {
  flex: 1;
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 7px;
  color: #6ee7c1;
  font: 800 11px ui-monospace, SFMono-Regular, Menlo, monospace;
}

input, select {
  min-width: 0;
  border: 1px solid rgba(148, 163, 184, .26);
  border-radius: 8px;
  outline: none;
  color: #e2e8f0;
  background: rgba(15, 23, 42, .88);
}

input:focus, select:focus { border-color: #34d399; box-shadow: 0 0 0 2px rgba(52, 211, 153, .12); }
.vehicle-spawn-coordinates input, .vehicle-spawn-filters input, .vehicle-spawn-filters select, .vehicle-spawn-path input { height: 38px; padding: 0 10px; }
.height-note { margin: -6px 0 0; color: #94a3b8; font-size: 11px; }
.vehicle-spawn-filters input { flex: 1; }
.vehicle-spawn-filters select { width: min(220px, 32%); }

.vehicle-spawn-list {
  min-height: 180px;
  overflow: auto;
  padding: 5px;
  border: 1px solid rgba(148, 163, 184, .16);
  border-radius: 10px;
  background: rgba(2, 6, 23, .48);
}

.vehicle-spawn-list__item {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(180px, .8fr) minmax(110px, .4fr) minmax(280px, 1.8fr);
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  text-align: left;
  color: #cbd5e1;
  background: transparent;
}

.vehicle-spawn-list__item:hover { background: rgba(52, 211, 153, .08); }
.vehicle-spawn-list__item.is-selected { border-color: rgba(52, 211, 153, .48); background: rgba(52, 211, 153, .14); }
.vehicle-spawn-list__item span { color: #67e8c2; font-size: 11px; }
.vehicle-spawn-list__item small { overflow: hidden; color: #7f94a6; font: 10px ui-monospace, monospace; text-overflow: ellipsis; white-space: nowrap; }
.empty-state { color: #94a3b8; text-align: center; }

.vehicle-spawn-path { display: grid; gap: 5px; color: #9fb3c2; font-size: 11px; }
.vehicle-spawn-path input { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
footer { justify-content: flex-end; }
footer > div { min-width: 0; margin-right: auto; display: grid; gap: 3px; }
footer > div span { max-width: 520px; overflow: hidden; color: #8297a7; font: 9px ui-monospace, monospace; text-overflow: ellipsis; white-space: nowrap; }
.secondary-button, .primary-button { height: 38px; padding: 0 16px; border-radius: 8px; font-weight: 800; }
.secondary-button { border: 1px solid rgba(148, 163, 184, .25); color: #cbd5e1; background: rgba(51, 65, 85, .45); }
.primary-button { border: 1px solid #34d399; color: #042f2e; background: #6ee7b7; }
button:disabled { cursor: not-allowed; opacity: .48; }

@media (max-width: 700px) {
  .vehicle-spawn-backdrop { padding: 8px; }
  .vehicle-spawn-dialog { max-height: 96vh; padding: 12px; }
  .vehicle-spawn-coordinates { align-items: stretch; flex-direction: column; }
  .vehicle-spawn-coordinates label { width: 100%; }
  .vehicle-spawn-list__item { grid-template-columns: 1fr auto; }
  .vehicle-spawn-list__item small { grid-column: 1 / -1; }
  footer { flex-wrap: wrap; }
  footer > div { width: 100%; }
}
</style>
