<template>
  <section class="page welcome-join-warning-page">
    <PageHeader
      eyebrow="Plugin Setup"
      title="入服欢迎警告"
      subtitle="对刚刚加入服务器的玩家，在自定义延迟后自动发送欢迎或警示消息。支持实时参数配置、视觉效果预览与流程诊断。"
    >
      <template #actions>
        <button type="button" class="btn ghost" :disabled="loading" @click="loadState(true)">
          {{ loading ? "刷新中..." : "🔄 刷新数据" }}
        </button>
        <button type="button" :class="['btn', autoRefresh ? 'primary' : 'ghost']" @click="toggleAutoRefresh">
          {{ autoRefresh ? "⏸ 停止自动刷新" : "▶ 自动刷新中" }}
        </button>
      </template>
    </PageHeader>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- Top Section: Metric Cards & Settings Form -->
    <div class="dashboard-grid">
      <!-- Running Status Card -->
      <PageCard title="运行状态" description="核心插件当前运行的总体数据与报错监控" compact class="status-card">
        <div class="status-header">
          <span class="status-chip" :data-tone="state?.enabled ? 'ok' : 'danger'">
            {{ state?.enabled ? "● 已启用" : "○ 已禁用" }}
          </span>
          <span class="status-chip" :data-tone="state?.subscribed ? 'ok' : 'danger'">
            {{ state?.subscribed ? "● 已订阅事件" : "○ 未订阅事件" }}
          </span>
          <span class="status-chip subtle">
            延迟：{{ Number(state?.delayMs ?? 0) / 1000 }} 秒
          </span>
          <span class="status-chip subtle">
            待发任务数：{{ state?.pendingCount ?? 0 }}
          </span>
        </div>

        <dl class="metric-grid">
          <div>
            <dt>加入事件计数</dt>
            <dd>{{ state?.joinEventCount ?? 0 }}</dd>
          </div>
          <div>
            <dt>已调度次数</dt>
            <dd>{{ state?.scheduledCount ?? 0 }}</dd>
          </div>
          <div>
            <dt>警告成功数</dt>
            <dd class="text-ok">{{ state?.warnSuccessCount ?? 0 }}</dd>
          </div>
          <div>
            <dt>警告失败数</dt>
            <dd class="text-danger">{{ state?.warnFailedCount ?? 0 }}</dd>
          </div>
          <div class="full-row border-top">
            <dt>最近玩家加入时间</dt>
            <dd>{{ formatTime(state?.lastJoinAt) }}</dd>
          </div>
          <div class="full-row border-top">
            <dt>最近警告发送时间</dt>
            <dd>{{ formatTime(state?.lastWarnAt) }}</dd>
          </div>
          <div class="full-row border-top">
            <dt>最近错误详情</dt>
            <dd class="text-error-msg font-mono">{{ state?.lastError || "无" }}</dd>
          </div>
        </dl>
      </PageCard>

      <!-- Settings configuration form -->
      <PageCard title="全局配置参数" description="实时修改并保存插件的调度规则与通告消息内容" compact class="config-card">
        <template #actions>
          <button type="button" class="btn primary" :disabled="savingConfig" @click="saveConfig">
            {{ savingConfig ? "保存中..." : "💾 保存配置" }}
          </button>
        </template>
        <div class="form-stack">
          <div class="form-row">
            <label class="form-field toggle">
              <span>启用入服欢迎功能</span>
              <input type="checkbox" v-model="configEnabled" class="checkbox-switch" />
            </label>
          </div>
          <div class="form-row split">
            <label class="form-field">
              <span>触发延迟 (秒)</span>
              <input type="number" v-model.number="configDelaySec" min="0" max="3600" class="input" />
            </label>
            <label class="form-field">
              <span>历史日志上限</span>
              <input type="number" v-model.number="configHistoryLimit" min="20" max="1000" class="input" />
            </label>
          </div>
          <div class="form-row">
            <label class="form-field">
              <span>警告公告文字 (支持换行)</span>
              <textarea v-model="configMessage" class="textarea" rows="3" placeholder="例如：欢迎来到本服！请遵守秩序，文明游戏。"></textarea>
              <div class="field-info">
                <span>字符计数：{{ configMessage.length }} 字符</span>
                <span class="warning-text" v-if="configMessage.length > 150">警告：消息过长可能导致游戏内显示不全</span>
              </div>
            </label>
          </div>
        </div>
      </PageCard>
    </div>

    <!-- Preview & Simulation Grid -->
    <div class="preview-grid">
      <!-- Mock Squad Warning UI Preview -->
      <PageCard title="游戏内 AdminWarn 效果预览" description="根据下方配置的欢迎信息，模拟玩家进入服务器时屏幕置顶横幅的渲染形态" compact class="preview-card">
        <template #actions>
          <label class="form-field toggle inline-toggle">
            <span>模拟萌新玩家</span>
            <input type="checkbox" v-model="mockNewbie" class="checkbox-switch" />
          </label>
        </template>
        <div class="mock-squad-container">
          <div class="mock-game-background">
            <div class="mock-crosshair">+</div>
            <div class="mock-banners-stack">
              <!-- Squad In-game admin warning popup box -->
              <div class="mock-warn-banner">
                <div class="mock-warn-header">ADMIN WARNING FROM SERVER</div>
                <div class="mock-warn-body">{{ configMessage || "欢迎来到 步战鼠鼠" }}</div>
                <div class="mock-warn-footer">Press [ENTER] to dismiss warning</div>
              </div>
              <!-- Newbie secondary warning popup box -->
              <div v-if="mockNewbie" class="mock-warn-banner newbie-banner">
                <div class="mock-warn-header">ADMIN WARNING FROM SERVER (萌新提示)</div>
                <div class="mock-warn-body">{{ "BZSS是一个注重萌新体验的游戏社区\n欢迎加入社区群，萌新可以在群内问各种各样的问题，也可以找人入门，群号就在服务器名称中。" }}</div>
                <div class="mock-warn-footer">Press [ENTER] to dismiss warning</div>
              </div>
            </div>
            <!-- HUD Info -->
            <div class="mock-hud-info">
              <span>SERVER: BZSS COMMUNITY</span>
              <span>PING: 32ms</span>
            </div>
          </div>
        </div>
      </PageCard>

      <!-- Simulation and Ops Card -->
      <PageCard title="诊断调试与功能模拟" description="通过手动发送虚拟加入数据包，确认延迟引擎和 RCON 通信机制" compact class="simulation-card">
        <div class="form-stack">
          <div class="form-row">
            <label class="form-field">
              <span>测试玩家 ID / 游戏昵称</span>
              <input v-model.trim="playerName" type="text" class="input" placeholder="例如：MousePlayer" />
            </label>
          </div>
          <div class="form-row">
            <label class="form-field">
              <span>目标虚拟服务器 (ServerID)</span>
              <input v-model.trim="serverId" type="text" class="input" placeholder="留空则使用当前面板主控服务器" />
            </label>
          </div>
          <div class="button-row">
            <button type="button" class="btn primary flex-1" :disabled="busy" @click="simulateJoin">
              {{ busy ? "执行模拟中..." : "🚀 手动模拟玩家加入" }}
            </button>
            <button type="button" class="btn danger" :disabled="busy" @click="clearHistory">
              清空调度记录
            </button>
          </div>
          <p class="muted-tip">
            点击“手动模拟玩家加入”将产生一个标准的虚拟 Join 事件，并在 <strong>{{ configDelaySec }} 秒</strong> 的设定延迟过后执行 RCON AdminWarn 广播。
          </p>
        </div>
      </PageCard>
    </div>

    <!-- Events Tables Grid -->
    <div class="tables-container">
      <!-- Recent Join Events Card -->
      <PageCard title="核心捕获的原始加入事件" description="最近系统收到的玩家加入信号包（用于排查 UDP LogParser 数据接收异常）" compact>
        <template #actions>
          <div class="search-box">
            <input type="text" v-model="eventSearchQuery" placeholder="搜索玩家/事件/服务器..." class="search-input" />
            <span class="search-count" v-if="filteredRecentEvents.length !== recentEvents.length">
              已过滤: {{ filteredRecentEvents.length }} / {{ recentEvents.length }}
            </span>
          </div>
        </template>
        
        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>记录时间</th>
                <th>事件名称</th>
                <th>玩家姓名</th>
                <th>服务器</th>
                <th>全局事件ID</th>
                <th>解析特征</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!filteredRecentEvents.length">
                <td colspan="6" class="empty-cell">
                  {{ recentEvents.length ? "没有找到符合搜索条件的事件" : "暂无事件日志。可尝试点击“手动模拟玩家加入”生成数据。" }}
                </td>
              </tr>
              <tr v-for="item in filteredRecentEvents" :key="item.id" class="table-row">
                <td class="font-mono text-muted">{{ formatTime(item.at) }}</td>
                <td class="truncate font-semibold text-primary">{{ item.eventName || "-" }}</td>
                <td class="truncate font-semibold text-white">{{ item.playerName || "-" }}</td>
                <td class="truncate">{{ item.serverId || "-" }}</td>
                <td class="truncate text-muted font-mono">{{ item.eventId || "-" }}</td>
                <td>
                  <div class="pill-group">
                    <span v-if="item.hasPayload" class="badge-pill ok">payload</span>
                    <span v-if="item.hasParams" class="badge-pill ok">params</span>
                    <span v-if="item.hasParamMap" class="badge-pill ok">paramMap</span>
                    <span v-if="!item.hasPayload && !item.hasParams && !item.hasParamMap" class="badge-pill skip">无</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </PageCard>

      <!-- Recent Warning Dispatch Logs Card -->
      <PageCard title="调度队列执行与警告发送历史" description="查看每条加入事件在延迟到达后的最终警告派发结果" compact>
        <template #actions>
          <div class="search-box">
            <input type="text" v-model="historySearchQuery" placeholder="搜索玩家/类型/原因/状态..." class="search-input" />
            <span class="search-count" v-if="filteredHistory.length !== history.length">
              已过滤: {{ filteredHistory.length }} / {{ history.length }}
            </span>
          </div>
        </template>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>记录时间</th>
                <th>操作类型</th>
                <th>调度状态</th>
                <th>目标玩家</th>
                <th>关联事件</th>
                <th>详细执行反馈 / 错误原因</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="!filteredHistory.length">
                <td colspan="6" class="empty-cell">
                  {{ history.length ? "没有找到符合搜索条件的记录" : "暂无调度及发送记录。" }}
                </td>
              </tr>
              <tr v-for="item in filteredHistory" :key="item.id" class="table-row">
                <td class="font-mono text-muted">{{ formatTime(item.at) }}</td>
                <td>
                  <span :class="['badge-pill', item.kind === 'join' ? 'info' : 'warn-pill']">
                    {{ item.kind === 'join' ? '入队调度' : '警告派发' }}
                  </span>
                </td>
                <td>
                  <span :class="['badge-pill', item.success ? 'ok' : item.skipped ? 'skip' : 'error']">
                    {{ item.success ? "成功" : item.skipped ? "跳过" : "失败" }}
                  </span>
                </td>
                <td class="truncate font-semibold text-white">{{ item.event?.playerName || "-" }}</td>
                <td class="truncate">{{ item.event?.eventName || "-" }}</td>
                <td class="truncate font-mono" :title="describeItem(item)">{{ describeItem(item) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </PageCard>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { apiGet, apiPost } from "../app/apiClient";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import { useUiStore } from "../stores/ui.store";

type HistoryItem = {
  id: string;
  at: string;
  kind?: string;
  success?: boolean;
  skipped?: boolean;
  reason?: string;
  message?: string;
  delayMs?: number;
  errorMessage?: string;
  event?: {
    eventName?: string;
    playerName?: string;
    serverId?: string;
  };
  result?: {
    errorMessage?: string;
    skipReason?: string;
  };
};

type RecentEvent = {
  id: string;
  at: string;
  eventName: string;
  eventId: string;
  serverId: string;
  playerName: string;
  hasPayload: boolean;
  hasParams: boolean;
  hasParamMap: boolean;
};

const ui = useUiStore();
const loading = ref(false);
const busy = ref(false);
const savingConfig = ref(false);
const error = ref("");
const info = ref("");
const state = ref<any>(null);
const autoRefresh = ref(true);
let autoRefreshTimer: number | null = null;

// Config Form state
const configEnabled = ref(true);
const configDelaySec = ref(15);
const configMessage = ref("");
const configHistoryLimit = ref(100);

// Simulator state
const playerName = ref("DebugPlayer");
const serverId = ref("");
const mockNewbie = ref(false);

// Search Filter state
const eventSearchQuery = ref("");
const historySearchQuery = ref("");

const history = computed<HistoryItem[]>(() => (Array.isArray(state.value?.history) ? state.value.history : []));
const recentEvents = computed<RecentEvent[]>(() => (Array.isArray(state.value?.recentEvents) ? state.value.recentEvents : []));

// Filtered Computed properties
const filteredRecentEvents = computed(() => {
  const query = eventSearchQuery.value.toLowerCase().trim();
  if (!query) return recentEvents.value;
  return recentEvents.value.filter(item => 
    (item.playerName && item.playerName.toLowerCase().includes(query)) ||
    (item.serverId && item.serverId.toLowerCase().includes(query)) ||
    (item.eventName && item.eventName.toLowerCase().includes(query)) ||
    (item.eventId && item.eventId.toLowerCase().includes(query))
  );
});

const filteredHistory = computed(() => {
  const query = historySearchQuery.value.toLowerCase().trim();
  if (!query) return history.value;
  return history.value.filter(item => {
    const pName = item.event?.playerName || "";
    const evName = item.event?.eventName || "";
    const reason = item.reason || "";
    const details = describeItem(item) || "";
    const type = item.kind || "";
    return pName.toLowerCase().includes(query) ||
           evName.toLowerCase().includes(query) ||
           reason.toLowerCase().includes(query) ||
           details.toLowerCase().includes(query) ||
           type.toLowerCase().includes(query);
  });
});

onMounted(() => {
  void loadState();
  document.addEventListener("visibilitychange", handleVisibilityChange);
  setupAutoRefresh();
});

onUnmounted(() => {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  document.removeEventListener("visibilitychange", handleVisibilityChange);
});

function handleVisibilityChange() {
  setupAutoRefresh();
}

function getRefreshIntervalMs() {
  if (typeof document !== "undefined" && document.hidden) return 10_000;
  return 2_000;
}

function setupAutoRefresh() {
  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  if (!autoRefresh.value) return;

  autoRefreshTimer = window.setInterval(() => {
    void loadState();
  }, getRefreshIntervalMs());
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value;
  setupAutoRefresh();
}

async function loadState(force = false) {
  if (loading.value && !force) return;
  loading.value = true;
  error.value = "";

  try {
    const response = await apiGet<{ ok: boolean; data: any }>("/api/plugins/welcome-join-warning/state");
    state.value = response.data ?? null;
    
    // Auto populate config fields from state
    if (state.value) {
      if (force || !configMessage.value) {
        configEnabled.value = state.value.enabled !== false;
        configDelaySec.value = Number(state.value.delayMs ?? 15000) / 1000;
        configMessage.value = state.value.message || "";
        configHistoryLimit.value = state.value.historyLimit ?? 100;
      }
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    loading.value = false;
  }
}

async function saveConfig() {
  if (configDelaySec.value < 0) {
    ui.pushToast({ title: "参数校验失败", message: "触发延迟不能为负数。", tone: "warn" });
    return;
  }
  if (configHistoryLimit.value < 20) {
    ui.pushToast({ title: "参数校验失败", message: "历史日志保留上限不能少于 20 条。", tone: "warn" });
    return;
  }

  savingConfig.value = true;
  error.value = "";

  try {
    const response = await apiPost<{ ok: boolean; data: any }>("/api/plugins/welcome-join-warning/config", {
      enabled: configEnabled.value,
      delayMs: Math.max(0, configDelaySec.value * 1000),
      message: configMessage.value.trim(),
      historyLimit: Math.max(20, configHistoryLimit.value),
    });

    if (response.ok) {
      state.value = response.data ?? null;
      ui.pushToast({ title: "保存成功", message: "全局欢迎警示参数已持久化保存。", tone: "ok" });
    }
  } catch (err) {
    ui.pushToast({ title: "保存配置失败", message: err instanceof Error ? err.message : String(err), tone: "error" });
  } finally {
    savingConfig.value = false;
  }
}

async function simulateJoin() {
  busy.value = true;
  error.value = "";
  info.value = "";

  try {
    await apiPost("/api/plugins/welcome-join-warning/simulate", {
      playerName: playerName.value || "DebugPlayer",
      serverId: serverId.value || undefined,
    });

    ui.pushToast({
      title: "模拟事件已提交",
      message: `已提交虚拟玩家加入。请等待 ${configDelaySec.value} 秒查看警告发送日志。`,
      tone: "ok"
    });
    await loadState(true);
  } catch (err) {
    ui.pushToast({ title: "模拟触发失败", message: err instanceof Error ? err.message : String(err), tone: "error" });
  } finally {
    busy.value = false;
  }
}

async function clearHistory() {
  busy.value = true;
  error.value = "";
  info.value = "";

  try {
    await apiPost("/api/plugins/welcome-join-warning/clear", {});
    ui.pushToast({ title: "记录已清空", message: "调度历史执行流记录清空完毕。", tone: "ok" });
    await loadState(true);
  } catch (err) {
    ui.pushToast({ title: "清空失败", message: err instanceof Error ? err.message : String(err), tone: "error" });
  } finally {
    busy.value = false;
  }
}

function formatTime(value: string | number | null | undefined) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function describeItem(item: HistoryItem) {
  const delayText = Number.isFinite(Number(item.delayMs)) ? `延迟 ${Math.floor(Number(item.delayMs) / 1000)} 秒` : "";
  if (item.kind === "join") {
    return `${item.reason || "join"} ${delayText}`.trim();
  }
  if (item.kind === "warn") {
    return item.result?.errorMessage || item.result?.skipReason || item.errorMessage || item.reason || "warn";
  }
  return item.reason || "-";
}
</script>

<style scoped>
.welcome-join-warning-page {
  display: grid;
  gap: 16px;
  padding: 16px;
  position: relative;
  overflow: visible;
}

.welcome-join-warning-page::before {
  content: "";
  position: absolute;
  inset: -80px auto auto -100px;
  width: 300px;
  height: 300px;
  border-radius: 999px;
  background: radial-gradient(circle, rgba(56, 189, 248, 0.12), transparent 70%);
  pointer-events: none;
  filter: blur(8px);
}

.welcome-join-warning-page :deep(.page-card) {
  border-color: rgba(148, 163, 184, 0.15);
  background:
    radial-gradient(circle at top right, rgba(56, 189, 248, 0.06), transparent 40%),
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.02)), rgba(255, 255, 255, 0.008)),
    var(--color-bg-card);
  box-shadow: 0 16px 32px rgba(2, 6, 23, 0.24);
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.22s ease, box-shadow 0.22s ease;
}

.welcome-join-warning-page :deep(.page-card:hover) {
  transform: translateY(-2px);
  border-color: rgba(96, 165, 250, 0.28);
  box-shadow: 0 20px 40px rgba(2, 6, 23, 0.32);
}

.error-banner {
  border: 1px solid rgba(248, 113, 113, 0.35);
  background: rgba(248, 113, 113, 0.1);
  color: rgb(252, 165, 165);
  border-radius: 12px;
  padding: 12px 16px;
  font-size: 13px;
}

.dashboard-grid,
.preview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.status-card,
.config-card,
.preview-card,
.simulation-card {
  min-width: 0;
}

.status-header {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary);
}

.status-chip[data-tone="ok"] {
  border-color: rgba(52, 211, 153, 0.35);
  color: #34d399;
  background: rgba(52, 211, 153, 0.08);
}

.status-chip[data-tone="danger"] {
  border-color: rgba(248, 113, 113, 0.35);
  color: #f87171;
  background: rgba(248, 113, 113, 0.08);
}

.status-chip.subtle {
  color: var(--color-text-muted);
  border-color: var(--color-border-soft);
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.metric-grid div {
  padding: 8px 10px;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.metric-grid dt {
  font-size: 11px;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.metric-grid dd {
  margin: 4px 0 0;
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.metric-grid .full-row {
  grid-column: 1 / -1;
}

.metric-grid .border-top {
  border-top: 1px solid var(--color-border-soft);
}

.text-ok {
  color: #34d399 !important;
}

.text-danger {
  color: #f87171 !important;
}

.text-error-msg {
  color: #fca5a5 !important;
  font-size: 12px !important;
  word-break: break-all;
}

/* Form Styles */
.form-stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-row.split {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-field span {
  font-size: 11px;
  font-weight: 700;
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.form-field.toggle {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  padding: 10px 12px;
}

.checkbox-switch {
  appearance: none;
  width: 42px;
  height: 22px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  position: relative;
  outline: none;
  cursor: pointer;
  border: 1px solid var(--color-border-soft);
  transition: background-color 0.2s ease, border-color 0.2s ease;
}

.checkbox-switch:checked {
  background: #34d399;
  border-color: rgba(52, 211, 153, 0.4);
}

.checkbox-switch::before {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #ffffff;
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.checkbox-switch:checked::before {
  transform: translateX(20px);
}

.input,
.textarea {
  width: 100%;
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  padding: 8px 12px;
  background: rgba(10, 15, 23, 0.65);
  color: var(--color-text-primary);
  outline: none;
  font-size: 13px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.input:focus,
.textarea:focus {
  border-color: rgba(96, 165, 250, 0.5);
  box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.12);
}

.field-info {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--color-text-muted);
}

.warning-text {
  color: var(--color-status-warning);
}

.button-row {
  display: flex;
  gap: 8px;
}

.flex-1 {
  flex: 1;
}

.muted-tip {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--color-text-muted);
  line-height: 1.5;
}

/* In-game warning preview styling */
.inline-toggle {
  flex-direction: row !important;
  align-items: center;
  gap: 8px;
  background: transparent !important;
  border: none !important;
  padding: 0 !important;
}

.mock-squad-container {
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 12px;
  overflow: hidden;
  background: #020617;
  position: relative;
  box-shadow: inset 0 0 30px rgba(0, 0, 0, 0.95);
}

.mock-game-background {
  min-height: 200px;
  height: auto;
  background: 
    linear-gradient(185deg, rgba(15, 23, 42, 0.8) 0%, rgba(3, 7, 18, 0.96) 100%),
    radial-gradient(circle at center, rgba(120, 140, 160, 0.12) 0%, transparent 64%);
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  gap: 12px;
}

.mock-banners-stack {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  z-index: 2;
}

.newbie-banner {
  margin-top: 0 !important;
  background: linear-gradient(180deg, rgba(59, 130, 246, 0.25) 0%, rgba(37, 99, 235, 0.12) 100%) !important;
  border-color: rgba(59, 130, 246, 0.38) !important;
  box-shadow: 0 4px 18px rgba(37, 99, 235, 0.12) !important;
  animation: mock-newbie-pulse 2.5s infinite ease-in-out !important;
}

.newbie-banner .mock-warn-header {
  color: #60a5fa !important;
}

@keyframes mock-newbie-pulse {
  0%, 100% {
    border-color: rgba(59, 130, 246, 0.38);
    box-shadow: 0 4px 18px rgba(37, 99, 235, 0.12);
  }
  50% {
    border-color: rgba(59, 130, 246, 0.65);
    box-shadow: 0 4px 22px rgba(37, 99, 235, 0.25);
  }
}

.mock-crosshair {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: rgba(255, 255, 255, 0.18);
  font-size: 16px;
  pointer-events: none;
}

.mock-warn-banner {
  width: 92%;
  max-width: 440px;
  background: linear-gradient(180deg, rgba(239, 68, 68, 0.25) 0%, rgba(220, 38, 38, 0.12) 100%);
  border: 1px solid rgba(239, 68, 68, 0.38);
  border-radius: 6px;
  box-shadow: 0 4px 18px rgba(220, 38, 38, 0.12);
  backdrop-filter: blur(4px);
  padding: 8px 12px;
  text-align: center;
  margin-top: 10px;
  animation: mock-warn-pulse 2.5s infinite ease-in-out;
}

@keyframes mock-warn-pulse {
  0%, 100% {
    border-color: rgba(239, 68, 68, 0.38);
    box-shadow: 0 4px 18px rgba(220, 38, 38, 0.12);
  }
  50% {
    border-color: rgba(239, 68, 68, 0.65);
    box-shadow: 0 4px 22px rgba(220, 38, 38, 0.25);
  }
}

.mock-warn-header {
  font-weight: 800;
  color: #ef4444;
  font-size: 10px;
  letter-spacing: 0.12em;
  margin-bottom: 4px;
  text-transform: uppercase;
}

.mock-warn-body {
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-all;
}

.mock-warn-footer {
  color: rgba(255, 255, 255, 0.32);
  font-size: 8px;
  margin-top: 5px;
  font-family: monospace;
}

.mock-hud-info {
  display: flex;
  justify-content: space-between;
  width: 100%;
  color: rgba(255, 255, 255, 0.24);
  font-size: 8px;
  font-family: monospace;
}

/* Tables Layout and Search styling */
.tables-container {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(10, 15, 23, 0.55);
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  padding: 4px 10px;
  transition: border-color 0.15s ease;
}

.search-box:focus-within {
  border-color: rgba(96, 165, 250, 0.4);
}

.search-input {
  background: transparent;
  border: 0;
  color: var(--color-text-primary);
  font-size: 12px;
  outline: none;
  width: 160px;
}

.search-count {
  font-size: 10px;
  color: var(--color-text-muted);
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 6px;
  border-radius: 4px;
}

.table-wrap {
  overflow-x: auto;
  border-radius: 10px;
  border: 1px solid var(--color-border-soft);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  min-width: 800px;
}

.data-table th,
.data-table td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--color-border-soft);
  text-align: left;
}

.data-table th {
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-secondary);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 11px;
}

.table-row {
  transition: background-color 0.12s ease;
}

.table-row:hover {
  background: rgba(96, 165, 250, 0.04);
}

.empty-cell {
  color: var(--color-text-muted);
  text-align: center;
  padding: 24px !important;
}

.truncate {
  max-width: 180px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.badge-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  font-size: 10px;
  font-weight: 700;
  border: 1px solid transparent;
}

.badge-pill.ok {
  background: rgba(52, 211, 153, 0.1);
  border-color: rgba(52, 211, 153, 0.22);
  color: #34d399;
}

.badge-pill.skip {
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.22);
  color: #f59e0b;
}

.badge-pill.error {
  background: rgba(248, 113, 113, 0.1);
  border-color: rgba(248, 113, 113, 0.22);
  color: #f87171;
}

.badge-pill.info {
  background: rgba(96, 165, 250, 0.1);
  border-color: rgba(96, 165, 250, 0.22);
  color: #60a5fa;
}

.badge-pill.warn-pill {
  background: rgba(192, 132, 252, 0.1);
  border-color: rgba(192, 132, 252, 0.22);
  color: #c084fc;
}

.pill-group {
  display: flex;
  gap: 4px;
}

.btn {
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.15);
}

.btn.ghost {
  border-color: transparent;
  background: transparent;
}

.btn.primary {
  border-color: rgba(96, 165, 250, 0.45);
  background: rgba(96, 165, 250, 0.14);
  color: #93c5fd;
}

.btn.primary:hover:not(:disabled) {
  background: rgba(96, 165, 250, 0.22);
}

.btn.danger {
  border-color: rgba(248, 113, 113, 0.4);
  color: rgb(252, 165, 165);
  background: rgba(248, 113, 113, 0.05);
}

.btn.danger:hover:not(:disabled) {
  background: rgba(248, 113, 113, 0.12);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (max-width: 980px) {
  .dashboard-grid,
  .preview-grid {
    grid-template-columns: 1fr;
  }
}
</style>
