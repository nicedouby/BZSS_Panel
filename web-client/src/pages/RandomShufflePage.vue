<template>
  <section class="random-shuffle-page">
    <WorkspaceToolbar>
      <template #actions>
        <button type="button" class="primary" @click="generatePlan" :disabled="loading">
          {{ loading ? "生成中.." : "生成打乱方案" }}
        </button>
        <button
          type="button"
          class="danger"
          @click="executePlan"
          :disabled="loading || !plan || plan.switches.length === 0"
        >
          {{ executing ? "执行中.." : "执行跳边" }}
        </button>
      </template>
    </WorkspaceToolbar>

    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="info" class="banner info">{{ info }}</div>

    <div class="workspace" v-if="plan">
      <div class="summary-cards">
        <AppCard class="team-card">
          <h3>Team 1 预计情况</h3>
          <p>玩家总数: <strong>{{ plan.team1.count }}</strong></p>
          <p>总游戏时长: <strong>{{ plan.team1.playtimeHours.toFixed(1) }}h</strong></p>
        </AppCard>
        
        <AppCard class="team-card">
          <h3>Team 2 预计情况</h3>
          <p>玩家总数: <strong>{{ plan.team2.count }}</strong></p>
          <p>总游戏时长: <strong>{{ plan.team2.playtimeHours.toFixed(1) }}h</strong></p>
        </AppCard>
        
        <AppCard class="switch-card">
          <h3>跳边统计</h3>
          <p>预计跳边人数: <strong>{{ plan.switches.length }}</strong></p>
          <p v-if="plan.switches.length === 0" class="text-success">当前队伍已平衡，无需跳边。</p>
        </AppCard>
      </div>

      <div class="switches-list" v-if="plan.switches.length > 0">
        <h3>将要执行跳边的玩家</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>玩家名称</th>
              <th>SteamID</th>
              <th>当前阵营</th>
              <th>目标阵营</th>
              <th>单位类型</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="sw in plan.switches" :key="sw.steamId">
              <td>{{ sw.name }}</td>
              <td><code>{{ sw.steamId }}</code></td>
              <td>Team {{ sw.currentTeam }}</td>
              <td><strong>Team {{ sw.targetTeam }}</strong></td>
              <td>{{ sw.unitType === 'group' ? '抱团' : '单人' }}</td>
              <td>
                <span v-if="executeResults[sw.steamId]" :class="executeResults[sw.steamId].success ? 'text-success' : 'text-danger'">
                  {{ executeResults[sw.steamId].success ? '已跳边' : executeResults[sw.steamId].message }}
                </span>
                <span v-else class="text-muted">待执行</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    
    <div v-else-if="!loading" class="empty-state">
      <p>点击上方“生成打乱方案”获取平衡跳边列表。</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import WorkspaceToolbar from "../components/common/WorkspaceToolbar.vue";
import AppCard from "../components/common/AppCard.vue";
import { request } from "../app/apiClient";

interface PlayerPlan {
  name: string;
  steamId: string;
  currentTeam: string;
  targetTeam: string;
  willSwitch: boolean;
  playtimeHours: number;
  unitType: string;
}

interface TeamPlan {
  players: PlayerPlan[];
  count: number;
  playtimeHours: number;
}

interface ShufflePlan {
  team1: TeamPlan;
  team2: TeamPlan;
  switches: PlayerPlan[];
  timestamp: number;
}

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
  success?: boolean;
}

const plan = ref<ShufflePlan | null>(null);
const loading = ref(false);
const executing = ref(false);
const error = ref("");
const info = ref("");
const executeResults = ref<Record<string, { success: boolean; message: string }>>({});

async function generatePlan() {
  loading.value = true;
  error.value = "";
  info.value = "";
  plan.value = null;
  executeResults.value = {};

  try {
    const res = await request<ApiResult<ShufflePlan>>("/api/plugins/random-shuffle/generatePlan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serverId: "1" }),
    });

    if (res?.ok || res?.success || res?.data) {
      plan.value = res.data || (res as unknown as ShufflePlan);
      info.value = `方案生成成功，预计 ${plan.value!.switches.length} 人需要跳边。`;
    } else {
      error.value = res?.error || "生成失败。";
    }
  } catch (err: any) {
    error.value = err.message || "请求失败";
  } finally {
    loading.value = false;
  }
}

async function executePlan() {
  if (!plan.value || plan.value.switches.length === 0) return;
  
  executing.value = true;
  error.value = "";
  info.value = "正在执行跳边，请稍候...";

  try {
    const res = await request<any>("/api/plugins/random-shuffle/executePlan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ switches: plan.value.switches }),
    });

    if (res?.ok || res?.success || res?.data?.success) {
      const data = res.data || res;
      info.value = `跳边执行完毕。`;
      
      // Update results
      if (Array.isArray(data.results)) {
        for (const item of data.results) {
          executeResults.value[item.steamId] = {
            success: item.success,
            message: item.message
          };
        }
      }
    } else {
      error.value = res?.error || "执行失败。";
    }
  } catch (err: any) {
    error.value = err.message || "请求失败";
  } finally {
    executing.value = false;
  }
}
</script>

<style scoped>
.random-shuffle-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.workspace {
  padding: 20px;
  overflow-y: auto;
}

.summary-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
  margin-bottom: 30px;
}

.team-card h3, .switch-card h3 {
  margin-top: 0;
  margin-bottom: 12px;
  font-size: 16px;
  color: var(--color-text-primary);
}

.team-card p, .switch-card p {
  margin: 6px 0;
  color: var(--color-text-secondary);
}

.team-card strong, .switch-card strong {
  color: var(--color-text-primary);
}

.switches-list h3 {
  margin-top: 0;
  margin-bottom: 16px;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  overflow: hidden;
}

.data-table th, .data-table td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid var(--color-border-default);
}

.data-table th {
  background: var(--color-bg-elevated);
  font-weight: 600;
  color: var(--color-text-primary);
}

.data-table tr:last-child td {
  border-bottom: none;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  color: var(--color-text-muted);
  font-size: 16px;
}

button.primary {
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
  border-color: rgba(59, 130, 246, 0.4);
}

button.primary:hover:not(:disabled) {
  background: rgba(59, 130, 246, 0.25);
}

.text-success { color: #34d399; }
.text-danger { color: #f87171; }
.text-muted { color: var(--color-text-muted); }

code {
  background: rgba(0, 0, 0, 0.2);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: monospace;
}
</style>
