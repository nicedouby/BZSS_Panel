<template>
  <section class="snapshot-test">
    <header class="hero">
      <div>
        <p class="eyebrow">ASTRBOT / PLAYER SNAPSHOT</p>
        <h1>玩家信息图片测试</h1>
        <p>输入已入库玩家的 Steam64、QQ 号或数据库玩家 ID，生成与“查询我的信息”完全相同的图片回执。</p>
      </div>
    </header>

    <form class="controls" @submit.prevent="generate">
      <label>
        <span>玩家标识</span>
        <input v-model.trim="playerInput" autocomplete="off" placeholder="Steam64 / QQ 号 / 数据库玩家 ID" :disabled="loading">
      </label>
      <button type="submit" :disabled="loading || !playerInput">{{ loading ? "正在生成…" : "生成图片" }}</button>
    </form>

    <p v-if="errorText" class="error">{{ errorText }}</p>
    <p v-else class="hint">不会更改 QQ 绑定，也不会刷新或修改玩家资料。</p>

    <div v-if="imageUrl" class="preview">
      <div class="preview-head"><strong>生成结果</strong><a :href="imageUrl" target="_blank" rel="noopener">在新标签页打开</a></div>
      <img :src="imageUrl" alt="玩家信息图片预览">
    </div>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";

const playerInput = ref("");
const loading = ref(false);
const errorText = ref("");
const imageUrl = ref("");

function releaseImageUrl() {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value);
  imageUrl.value = "";
}

async function generate() {
  if (!playerInput.value || loading.value) return;
  loading.value = true;
  errorText.value = "";
  releaseImageUrl();
  try {
    const response = await fetch("/api/astrbot/panel-test/player-snapshot", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerInput: playerInput.value }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.message || body?.error || `生成失败（${response.status}）`);
    }
    const image = await response.blob();
    if (!image.size) throw new Error("服务端返回了空图片。");
    imageUrl.value = URL.createObjectURL(image);
  } catch (error: any) {
    errorText.value = error?.message || "图片生成失败。";
  } finally {
    loading.value = false;
  }
}

onBeforeUnmount(releaseImageUrl);
</script>

<style scoped>
.snapshot-test{max-width:1320px;margin:0 auto;padding:28px;display:grid;gap:18px;color:var(--color-text-primary)}
.hero,.controls,.preview{border:1px solid rgba(125,211,252,.22);background:linear-gradient(135deg,rgba(8,20,35,.92),rgba(13,27,46,.82));border-radius:18px}
.hero{padding:26px 28px}.eyebrow{margin:0;color:#67e8f9;font-size:12px;font-weight:900;letter-spacing:.18em}.hero h1{margin:8px 0;font-size:28px}.hero p:last-child{margin:0;color:var(--color-text-muted)}
.controls{display:flex;gap:12px;padding:16px;align-items:end}.controls label{display:grid;gap:7px;flex:1;font-size:13px;font-weight:700}.controls input{width:100%;box-sizing:border-box;border:1px solid var(--color-border-default);border-radius:10px;padding:11px 13px;background:#07111f;color:var(--color-text-primary);font:inherit}.controls button{border:0;border-radius:10px;padding:12px 18px;background:linear-gradient(90deg,#0891b2,#4f46e5);color:#fff;font-weight:800;cursor:pointer}.controls button:disabled{opacity:.55;cursor:wait}.hint,.error{margin:0;padding:12px 14px;border-radius:10px}.hint{background:rgba(56,189,248,.08);color:#bae6fd}.error{background:rgba(239,68,68,.12);color:#fecaca}.preview{padding:14px;overflow:auto}.preview-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:12px}.preview-head a{color:#67e8f9}.preview img{display:block;width:min(1280px,100%);height:auto;border-radius:12px;border:1px solid rgba(148,163,184,.25)}@media(max-width:680px){.snapshot-test{padding:14px}.hero{padding:20px}.controls{align-items:stretch;flex-direction:column}.controls button{width:100%}}
</style>
