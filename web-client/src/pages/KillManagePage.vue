<template>
  <section class="kill-manage-page">
    <header class="page-header">
      <div>
        <h1>RCON 强制击杀</h1>
        <p>仅用于管理端强制执行 `AdminKill`，不展示战斗伤害或击倒记录。</p>
      </div>
    </header>

    <div class="layout">
      <section class="card">
        <h2>执行强制击杀</h2>
        <div class="form-grid">
          <label>
            <span>目标玩家</span>
            <input v-model.trim="targetName" type="text" placeholder="玩家名" />
          </label>
          <label>
            <span>SteamID</span>
            <input v-model.trim="targetSteamId" type="text" placeholder="可选" />
          </label>
          <label class="full">
            <span>原因</span>
            <textarea v-model.trim="reason" rows="3" placeholder="例如：严重违规 / 管理处置" />
          </label>
        </div>

        <div class="actions">
          <button type="button" class="danger" :disabled="submitting || !canSubmit" @click="submitKill">
            {{ submitting ? "执行中..." : "执行 AdminKill" }}
          </button>
        </div>

        <p v-if="statusMessage" class="status" :data-tone="statusTone">
          {{ statusMessage }}
        </p>
      </section>

      <section class="card">
        <h2>最近执行记录</h2>
        <table class="records">
          <thead>
            <tr>
              <th>时间</th>
              <th>目标玩家</th>
              <th>SteamID</th>
              <th>管理原因</th>
              <th>操作者</th>
              <th>结果</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in records" :key="item.createdAt + item.command + item.targetName">
              <td>{{ formatTime(item.createdAt) }}</td>
              <td>{{ item.targetName || "-" }}</td>
              <td>{{ item.targetSteamId || "-" }}</td>
              <td>{{ item.reason || "-" }}</td>
              <td>{{ item.operatorName || item.operatorId || "-" }}</td>
              <td>
                <span class="result" :data-success="item.success">
                  {{ item.success ? "成功" : item.skipped ? "已跳过" : "失败" }}
                </span>
                <small v-if="item.error" class="error">{{ item.error }}</small>
              </td>
            </tr>
            <tr v-if="records.length === 0">
              <td colspan="6" class="empty">暂无记录</td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { apiGet } from "../app/apiClient";
import { killPlayer } from "../app/squadManagementApi";

const targetName = ref("");
const targetSteamId = ref("");
const reason = ref("");
const submitting = ref(false);
const statusMessage = ref("");
const statusTone = ref<"ok" | "warn" | "error" | "idle">("idle");
const records = ref<any[]>([]);

const canSubmit = computed(() => Boolean(targetName.value.trim() || targetSteamId.value.trim()));

function formatTime(value: number) {
  if (!Number.isFinite(Number(value))) return "--";
  return new Date(Number(value)).toLocaleString();
}

async function submitKill() {
  if (!canSubmit.value || submitting.value) return;
  submitting.value = true;
  statusMessage.value = "";
  statusTone.value = "idle";

  try {
    const result = await killPlayer({
      targetName: targetName.value.trim() || undefined,
      targetSteamId: targetSteamId.value.trim() || undefined,
      reason: reason.value.trim() || undefined,
      operatorName: "",
      source: "web.killManage",
    });

    if (result?.success) {
      statusMessage.value = "已执行强制击杀。";
      statusTone.value = "ok";
    } else if (result?.skipped) {
      statusMessage.value = result?.skipReason ? `已跳过：${result.skipReason}` : "已跳过。";
      statusTone.value = "warn";
    } else {
      statusMessage.value = result?.error || "执行失败。";
      statusTone.value = "error";
    }

    await refreshRecords();
  } catch (error) {
    statusMessage.value = error instanceof Error ? error.message : "执行失败。";
    statusTone.value = "error";
  } finally {
    submitting.value = false;
  }
}

async function refreshRecords() {
  try {
    const data = await apiGet<{ records?: any[] }>("/api/kill-manage/recent?limit=20");
    records.value = Array.isArray(data.records) ? data.records : [];
  } catch {
    records.value = [];
  }
}

onMounted(refreshRecords);
</script>
