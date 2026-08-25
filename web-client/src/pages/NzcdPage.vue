<template>
  <section class="nzcd-page">
    <header class="page-header">
      <div>
        <h1>NZCD 娱乐插件</h1>
        <p>玩家输入 nzcd 获取记录值；输入 sxnzcd 消耗一天预留位后重新生成。</p>
      </div>
      <button class="primary" :disabled="saving" @click="save">保存设置</button>
    </header>

    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="notice" class="banner">{{ notice }}</div>

    <section class="panel">
      <h2>基础设置</h2>
      <div class="form-grid">
        <label><span>启用插件</span><input v-model="form.enabled" type="checkbox"></label>
        <label><span>默认最小值（cm）</span><input v-model.number="form.defaultMin" type="number" min="0"></label>
        <label><span>默认最大值（cm）</span><input v-model.number="form.defaultMax" type="number" min="0"></label>
      </div>
      <p class="hint">玩家区间按 Steam64、EOS ID 或玩家名称匹配。12 小时后只清理生成结果，不清理这里的区间设置。</p>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>玩家专属 NZCD 区间</h2>
        <button @click="addRange">新增区间</button>
      </div>
      <div v-if="!form.ranges.length" class="empty">暂无专属区间，所有玩家使用默认区间。</div>
      <div v-for="(range, index) in form.ranges" :key="index" class="range-row">
        <input v-model="range.playerKey" placeholder="Steam64 / EOS ID / 玩家名称">
        <input v-model.number="range.min" type="number" min="0" placeholder="最小">
        <span>—</span>
        <input v-model.number="range.max" type="number" min="0" placeholder="最大">
        <label class="enabled"><input v-model="range.enabled" type="checkbox">启用</label>
        <button class="danger" @click="removeRange(index)">删除</button>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>当前 12 小时记录</h2><button @click="load">刷新</button></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>玩家</th><th>Steam64</th><th>区间</th><th>结果</th><th>更新时间</th></tr></thead>
          <tbody>
            <tr v-for="item in players" :key="item.key">
              <td>{{ item.name || "-" }}</td>
              <td class="mono">{{ item.steamId || "-" }}</td>
              <td>{{ item.min }} - {{ item.max }} cm</td>
              <td>{{ item.value }} cm</td>
              <td>{{ formatTime(item.updatedAt) }}</td>
            </tr>
            <tr v-if="!players.length"><td colspan="5" class="empty">暂无有效记录。</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";

type Range = { playerKey: string; min: number; max: number; enabled: boolean };
type Player = { key: string; name: string; steamId: string; min: number; max: number; value: number; updatedAt: string };

const form = reactive<{ enabled: boolean; defaultMin: number; defaultMax: number; ranges: Range[] }>({
  enabled: true, defaultMin: 1, defaultMax: 30, ranges: [],
});
const players = ref<Player[]>([]);
const saving = ref(false);
const error = ref("");
const notice = ref("");

onMounted(() => void load());

async function request(url: string, init?: RequestInit) {
  const response = await fetch(url, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.message || "请求失败");
  return data;
}

async function load() {
  error.value = "";
  try {
    const state = await request("/api/plugins/plugin.nzcd/state");
    const config = state?.config ?? {};
    form.enabled = config.enabled !== false;
    form.defaultMin = Number(config.defaultMin ?? 1);
    form.defaultMax = Number(config.defaultMax ?? 30);
    form.ranges = Array.isArray(config.ranges) ? config.ranges.map((item: any) => ({
      playerKey: String(item.playerKey ?? ""),
      min: Number(item.min ?? form.defaultMin),
      max: Number(item.max ?? form.defaultMax),
      enabled: item.enabled !== false,
    })) : [];
    players.value = state.players ?? [];
  } catch (err: any) {
    error.value = err?.message ?? "加载 NZCD 设置失败。";
  }
}

async function save() {
  saving.value = true;
  error.value = "";
  notice.value = "";
  try {
    await request("/api/plugins/plugin.nzcd/config", {
      method: "PATCH",
      body: JSON.stringify({ config: { enabled: form.enabled, defaultMin: form.defaultMin, defaultMax: form.defaultMax, ranges: form.ranges } }),
    });
    notice.value = "设置已保存。";
    await load();
  } catch (err: any) {
    error.value = err?.message ?? "保存设置失败。";
  } finally {
    saving.value = false;
  }
}

function addRange() { form.ranges.push({ playerKey: "", min: form.defaultMin, max: form.defaultMax, enabled: true }); }
function removeRange(index: number) { form.ranges.splice(index, 1); }
function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false }); }
</script>

<style scoped>
.nzcd-page { height: 100%; overflow: auto; padding: 24px; color: var(--color-text-primary); background: var(--app-background, var(--color-bg-page)); }
.page-header, .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.page-header { margin-bottom: 20px; }
h1, h2 { margin: 0; }
h1 { font-size: 24px; }
h2 { font-size: 17px; }
p { color: var(--color-text-muted); }
.panel { margin-bottom: 18px; padding: 20px; border: 1px solid var(--color-border-default); border-radius: 12px; background: var(--color-bg-card); }
.form-grid { display: grid; grid-template-columns: repeat(3, minmax(160px, 1fr)); gap: 16px; margin-top: 18px; }
.form-grid label, .enabled { display: flex; align-items: center; gap: 8px; color: var(--color-text-secondary); }
input:not([type="checkbox"]) { min-height: 36px; min-width: 0; box-sizing: border-box; border: 1px solid var(--color-border-default); border-radius: 7px; padding: 0 10px; background: var(--color-bg-elevated); color: var(--color-text-primary); }
button { min-height: 34px; padding: 0 12px; border: 1px solid var(--color-border-default); border-radius: 7px; background: var(--color-bg-elevated); color: var(--color-text-primary); cursor: pointer; }
button.primary { border: 0; background: var(--color-brand-primary); color: #061018; font-weight: 700; }
button.danger { color: var(--color-status-danger); }
.range-row { display: grid; grid-template-columns: minmax(220px, 2fr) 100px 20px 100px auto auto; align-items: center; gap: 10px; margin-top: 12px; }
.enabled { white-space: nowrap; }
.hint, .empty { margin: 14px 0 0; font-size: 13px; }
.banner { margin-bottom: 16px; padding: 12px; border-radius: 8px; background: var(--color-bg-selected); }
.banner.error { color: var(--color-status-danger); }
.table-wrap { margin-top: 16px; overflow: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 10px; text-align: left; border-bottom: 1px solid var(--color-border-soft); }
th { color: var(--color-text-muted); font-size: 12px; }
.mono { font-family: ui-monospace, monospace; }
@media (max-width: 800px) { .form-grid, .range-row { grid-template-columns: 1fr; } .range-row span { display: none; } }
</style>
