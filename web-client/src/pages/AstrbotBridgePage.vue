<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import AppPage from "../components/common/AppPage.vue";
import AppPageHeader from "../components/common/AppPageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import AppStatusBadge from "../components/common/AppStatusBadge.vue";
import { formatDateTime, formatRelativeTime } from "../composables/useDateTimeFormat";
import { copyText } from "../utils/clipboard";

type BridgeEvent = {
  type?: string;
  version?: number;
  eventId?: string;
  time?: string;
  serverId?: string;
  data?: Record<string, unknown>;
};

type BridgeAck = {
  eventId?: string;
  eventType?: string;
  receivedAt?: string;
  received?: boolean;
  delivered?: boolean;
  successCount?: number;
  failureCount?: number;
  targets?: Array<{ target?: string; ok?: boolean; error?: string | null }>;
  error?: string | null;
};

type BridgeState = {
  ok?: boolean;
  enabled?: boolean;
  tokenConfigured?: boolean;
  trustedIps?: string[];
  allowedActions?: string[];
  websocket?: {
    enabled?: boolean;
    path?: string;
    connected?: boolean;
    clients?: number;
    connectedAt?: string | null;
    lastHeartbeat?: string | null;
  };
  metrics?: {
    eventsSent?: number;
    eventsFailed?: number;
    lastEvent?: string | null;
    recentEvents?: BridgeEvent[];
  };
  matchFinished?: {
    enabled?: boolean;
    snapshotWaitMs?: number;
    pending?: number;
    dedupeSize?: number;
  };
  delivery?: {
    enabled?: boolean;
    ackReceived?: number;
    delivered?: number;
    failed?: number;
    lastAckAt?: string | null;
    lastDeliveredEventId?: string | null;
    recentAcks?: BridgeAck[];
  };
};

const state = ref<BridgeState | null>(null);
const loading = ref(true);
const error = ref("");
const autoRefresh = ref(true);
const searchQuery = ref("");
const activeFilter = ref<"all" | "match" | "player" | "squad" | "core" | "heartbeat">("all");
const expandedEventIndices = ref<Set<number>>(new Set());
const lastRefreshedAt = ref<Date | null>(null);
const testPublishing = ref(false);
const testError = ref("");
const testWarning = ref("");
const testEventId = ref("");
let timer: ReturnType<typeof setInterval> | null = null;

async function load() {
  try {
    const response = await fetch("/api/astrbot/panel-status", { credentials: "include" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    state.value = payload.data ?? null;
    error.value = "";
    lastRefreshedAt.value = new Date();
  } catch (err) {
    error.value = err instanceof Error ? err.message : "加载失败";
  } finally {
    loading.value = false;
  }
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value;
  if (autoRefresh.value) {
    load();
    startTimer();
  } else {
    stopTimer();
  }
}

function startTimer() {
  stopTimer();
  timer = setInterval(load, 2000);
}

function stopTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function toggleExpandEvent(index: number) {
  const current = new Set(expandedEventIndices.value);
  if (current.has(index)) {
    current.delete(index);
  } else {
    current.add(index);
  }
  expandedEventIndices.value = current;
}

function getEventTypeBadgeTone(type?: string): "ok" | "warn" | "error" | "idle" {
  if (!type) return "idle";
  const lower = type.toLowerCase();
  if (lower.includes("heartbeat")) return "ok";
  if (lower.includes("player")) return "info" as any;
  if (lower.includes("squad")) return "warn";
  if (lower.includes("error") || lower.includes("fail")) return "error";
  return "idle";
}

const statusItems = computed(() => {
  if (!state.value) return [];
  const items: Array<{ label: string; tone: "ok" | "warn" | "error" | "idle" }> = [
    {
      label: state.value.enabled ? "网关已启用" : "网关未启用",
      tone: state.value.enabled ? "ok" : "warn",
    },
    {
      label: state.value.tokenConfigured ? "Token 已配置" : "Token 未配置",
      tone: state.value.tokenConfigured ? "ok" : "idle",
    },
    {
      label: `客户端: ${state.value.websocket?.clients ?? 0}`,
      tone: state.value.websocket?.clients ? "ok" : "idle",
    },
  ];
  return items;
});

const recentEvents = computed(() => state.value?.metrics?.recentEvents || []);
const latestMatchFinished = computed(() =>
  recentEvents.value.find((event) => event.type === "match.finished") ?? null,
);
const activeTestEventId = computed(() => testEventId.value || latestMatchFinished.value?.eventId || "");
const latestTestAck = computed(() => {
  const eventId = activeTestEventId.value;
  if (!eventId) return null;
  return state.value?.delivery?.recentAcks?.find((ack) => ack.eventId === eventId) ?? null;
});
const testStatus = computed(() => {
  if (testPublishing.value) return { label: "正在发布", tone: "idle" as const };
  const ack = latestTestAck.value;
  if (ack) {
    const success = Number(ack.successCount ?? 0);
    const failed = Number(ack.failureCount ?? 0);
    if (ack.delivered && failed === 0) return { label: "QQ群发送成功", tone: "ok" as const };
    if (success > 0 && failed > 0) return { label: "部分目标失败", tone: "warn" as const };
    return { label: "全部发送失败", tone: "error" as const };
  }
  if (activeTestEventId.value) return { label: "等待机器人确认", tone: "warn" as const };
  return { label: "可开始测试", tone: "idle" as const };
});

const filteredEvents = computed(() => {
  return recentEvents.value.filter((ev) => {
    const type = (ev.type || "core.event").toLowerCase();
    const serverId = String(ev.data?.serverId ?? ev.serverId ?? "").toLowerCase();
    const query = searchQuery.value.trim().toLowerCase();

    // Type filter
    if (activeFilter.value === "match" && !type.includes("match")) return false;
    if (activeFilter.value === "player" && !type.includes("player")) return false;
    if (activeFilter.value === "squad" && !type.includes("squad")) return false;
    if (activeFilter.value === "core" && !type.includes("core") && !type.includes("system")) return false;
    if (activeFilter.value === "heartbeat" && !type.includes("heartbeat")) return false;

    // Search query
    if (query) {
      const matchType = type.includes(query);
      const matchServer = serverId.includes(query);
      const matchData = JSON.stringify(ev.data || {}).toLowerCase().includes(query);
      const matchEventId = String(ev.eventId ?? "").toLowerCase().includes(query);
      return matchType || matchServer || matchData || matchEventId;
    }

    return true;
  });
});

async function simulateMatchFinished() {
  const confirmed = window.confirm(
    "这只会发送一条明确标记为测试消息的对局结束事件，不会结束真实对局、执行换图或生成新的正式快照。确定继续吗？",
  );
  if (!confirmed) return;
  testPublishing.value = true;
  testError.value = "";
  testWarning.value = "";
  try {
    const response = await fetch("/api/astrbot/panel-test/match-finished", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        useCurrentServer: true,
        useLatestSnapshot: true,
        winner: "测试阵营",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
    }
    testEventId.value = String(payload?.event?.eventId ?? "");
    testWarning.value = String(payload?.warning ?? "");
    await load();
  } catch (err) {
    testError.value = err instanceof Error ? err.message : "测试事件发布失败";
  } finally {
    testPublishing.value = false;
  }
}

async function copyTextHandler(text: string, label: string) {
  const success = await copyText(text);
  if (success) {
    // text copied successfully
  }
}

onMounted(() => {
  load();
  if (autoRefresh.value) startTimer();
});

onUnmounted(() => {
  stopTimer();
});
</script>

<template>
  <AppPage mode="document" class="astrbot-bridge-page">
    <!-- Header -->
    <AppPageHeader
      title="AstrBot 网关"
      subtitle="Panel 与 AstrBot 的状态同步、WebSocket 实时通信与事件推送摘要。"
      eyebrow="SYSTEM / INTEGRATION"
      :status-items="statusItems"
    >
      <template #actions>
        <button
          type="button"
          class="btn-action"
          :class="{ active: autoRefresh }"
          @click="toggleAutoRefresh"
        >
          <span class="pulse-dot" :class="{ live: autoRefresh }" />
          {{ autoRefresh ? "自动刷新 (2s)" : "已暂停轮询" }}
        </button>
        <button
          type="button"
          class="btn-action primary"
          :disabled="loading"
          @click="load"
        >
          {{ loading ? "刷新中…" : "手动刷新" }}
        </button>
      </template>
    </AppPageHeader>

    <!-- Error Banner -->
    <div v-if="error" class="error-banner" role="alert">
      <span class="icon">⚠️</span>
      <span>无法读取网关状态：{{ error }}</span>
    </div>

    <!-- Main Content when State Loaded -->
    <div v-if="state" class="astrbot-content">
      <!-- Top Metrics Overview Grid -->
      <section class="kpi-grid">
        <div class="kpi-card" :data-tone="state.enabled ? 'ok' : 'idle'">
          <div class="kpi-icon">🤖</div>
          <div class="kpi-body">
            <span class="kpi-label">网关服务状态</span>
            <div class="kpi-value-row">
              <strong class="kpi-value">{{ state.enabled ? "已启用" : "未启用" }}</strong>
              <AppStatusBadge :tone="state.enabled ? 'ok' : 'idle'">
                {{ state.enabled ? "Active" : "Disabled" }}
              </AppStatusBadge>
            </div>
            <span class="kpi-subtext">
              {{ state.tokenConfigured ? "Token 已就绪" : "未设置 API Token" }}
            </span>
          </div>
        </div>

        <div class="kpi-card" :data-tone="state.websocket?.clients ? 'ok' : 'idle'">
          <div class="kpi-icon">⚡</div>
          <div class="kpi-body">
            <span class="kpi-label">WebSocket 通道</span>
            <div class="kpi-value-row">
              <strong class="kpi-value">{{ state.websocket?.clients ?? 0 }} <span class="unit">个客户端</span></strong>
              <AppStatusBadge :tone="state.websocket?.enabled ? 'ok' : 'warn'">
                {{ state.websocket?.enabled ? "已开启" : "已停用" }}
              </AppStatusBadge>
            </div>
            <span class="kpi-subtext code-font">
              {{ state.websocket?.path || "/ws/astrbot" }}
            </span>
          </div>
        </div>

        <div class="kpi-card" :data-tone="state.metrics?.eventsFailed ? 'warn' : 'ok'">
          <div class="kpi-icon">📡</div>
          <div class="kpi-body">
            <span class="kpi-label">事件推送统计</span>
            <div class="kpi-value-row">
              <strong class="kpi-value">{{ state.metrics?.eventsSent ?? 0 }} <span class="unit">次成功</span></strong>
              <AppStatusBadge v-if="state.metrics?.eventsFailed" tone="warn">
                {{ state.metrics.eventsFailed }} 失败
              </AppStatusBadge>
            </div>
            <span class="kpi-subtext">
              最近事件: {{ state.metrics?.lastEvent || "暂无" }}
            </span>
          </div>
        </div>

        <div class="kpi-card" :data-tone="state.websocket?.lastHeartbeat ? 'ok' : 'idle'">
          <div class="kpi-icon">💓</div>
          <div class="kpi-body">
            <span class="kpi-label">最新心跳</span>
            <div class="kpi-value-row">
              <strong class="kpi-value">
                {{ state.websocket?.lastHeartbeat ? formatRelativeTime(state.websocket.lastHeartbeat) : "—" }}
              </strong>
            </div>
            <span class="kpi-subtext">
              {{ formatDateTime(state.websocket?.lastHeartbeat) }}
            </span>
          </div>
        </div>
      </section>

      <PageCard
        title="对局结束推送测试"
        description="通过与真实结束相同的 match.finished v1 链路，验证机器人接收、QQ群发送与 ACK 回传。"
        class="match-test-card"
      >
        <template #actions>
          <AppStatusBadge :tone="testStatus.tone">{{ testStatus.label }}</AppStatusBadge>
        </template>

        <div class="match-test-layout">
          <div class="match-test-status">
            <div class="test-status-item">
              <span>Bridge</span>
              <strong>{{ state.enabled ? "已启用" : "未启用" }}</strong>
            </div>
            <div class="test-status-item">
              <span>Token</span>
              <strong>{{ state.tokenConfigured ? "已配置" : "未配置" }}</strong>
            </div>
            <div class="test-status-item">
              <span>WebSocket</span>
              <strong>{{ state.websocket?.enabled ? "已开启" : "未开启" }}</strong>
            </div>
            <div class="test-status-item">
              <span>机器人客户端</span>
              <strong>{{ state.websocket?.clients ?? 0 }}</strong>
            </div>
            <div class="test-status-item">
              <span>ACK 成功 / 失败</span>
              <strong>{{ state.delivery?.delivered ?? 0 }} / {{ state.delivery?.failed ?? 0 }}</strong>
            </div>
          </div>

          <div class="match-test-result">
            <div class="test-event-heading">
              <div>
                <span class="info-label">最近 match.finished</span>
                <strong>{{ latestMatchFinished?.data?.map || latestMatchFinished?.data?.layer || "暂无事件" }}</strong>
              </div>
              <AppStatusBadge v-if="latestMatchFinished" :tone="latestMatchFinished.data?.simulated ? 'warn' : 'ok'">
                {{ latestMatchFinished.data?.simulated ? "模拟" : "真实" }}
              </AppStatusBadge>
            </div>
            <div v-if="latestMatchFinished" class="match-summary-grid">
              <span>模式 <strong>{{ latestMatchFinished.data?.mode || "—" }}</strong></span>
              <span>胜方 <strong>{{ latestMatchFinished.data?.winner || "—" }}</strong></span>
              <span>人数 <strong>{{ latestMatchFinished.data?.players ?? 0 }}</strong></span>
              <span>快照 <strong>{{ latestMatchFinished.data?.snapshotId || "纯文字" }}</strong></span>
            </div>
            <code v-if="activeTestEventId" class="test-event-id">{{ activeTestEventId }}</code>
            <div v-if="latestTestAck" class="ack-summary">
              <span>机器人已确认：成功 {{ latestTestAck.successCount ?? 0 }}，失败 {{ latestTestAck.failureCount ?? 0 }}</span>
              <span v-if="latestTestAck.error" class="text-danger">{{ latestTestAck.error }}</span>
            </div>
            <p v-else-if="activeTestEventId" class="test-hint">Panel 已发布，正在等待机器人回传 ACK。</p>
            <p v-else class="test-hint">测试不会触发 MATCH_END、RCON、换图或正式快照生成。</p>
          </div>

          <div class="match-test-action">
            <button
              type="button"
              class="btn-action primary"
              :disabled="testPublishing || !state.enabled"
              @click="simulateMatchFinished"
            >
              {{ testPublishing ? "正在发布…" : "模拟对局结束" }}
            </button>
            <span v-if="testWarning" class="test-warning">{{ testWarning }}</span>
            <span v-if="testError" class="text-danger">{{ testError }}</span>
          </div>
        </div>
      </PageCard>

      <!-- Grid layout for Detail Cards -->
      <div class="cards-grid">
        <!-- Configuration & Whitelist Card -->
        <PageCard title="连接配置与接口规范" description="网关参数、鉴权 Token 与 M2M API 接口清单">
          <div class="config-stack">
            <div class="info-list">
              <div class="info-item">
                <span class="info-label">WebSocket 路径</span>
                <div class="info-val code-block">
                  <code>{{ state.websocket?.path || "/ws/astrbot" }}</code>
                  <button type="button" class="btn-sm" @click="copyTextHandler(state.websocket?.path || '/ws/astrbot', 'WebSocket 路径')">
                    复制
                  </button>
                </div>
              </div>

              <div class="info-item">
                <span class="info-label">Token 鉴权状态</span>
                <span class="info-val">
                  <AppStatusBadge :tone="state.tokenConfigured ? 'ok' : 'idle'">
                    {{ state.tokenConfigured ? "已配置安全 Token" : "未配置 (无鉴权)" }}
                  </AppStatusBadge>
                </span>
              </div>

              <div class="info-item">
                <span class="info-label">信任 IP 白名单</span>
                <div class="info-val tags-wrap">
                  <template v-if="state.trustedIps?.length">
                    <span v-for="ip in state.trustedIps" :key="ip" class="chip-tag">{{ ip }}</span>
                  </template>
                  <span v-else class="text-muted">允许所有 IP (全域)</span>
                </div>
              </div>

              <div class="info-item">
                <span class="info-label">允许的 M2M 操作</span>
                <div class="info-val tags-wrap">
                  <template v-if="state.allowedActions?.length">
                    <span v-for="act in state.allowedActions" :key="act" class="chip-tag primary-tag">{{ act }}</span>
                  </template>
                  <span v-else class="text-muted">全功能开放</span>
                </div>
              </div>
            </div>

            <!-- Quick API Endpoint Reference -->
            <div class="endpoint-ref">
              <span class="ref-title">推荐 API 端点指南</span>
              <div class="endpoint-pills">
                <div class="endpoint-pill" @click="copyTextHandler('/api/astrbot/panel-status', 'API 端点')">
                  <span class="method get">GET</span>
                  <span class="path">/api/astrbot/panel-status</span>
                  <span class="desc">网关状态</span>
                </div>
                <div class="endpoint-pill" @click="copyTextHandler('/api/astrbot/health', 'API 端点')">
                  <span class="method get">GET</span>
                  <span class="path">/api/astrbot/health</span>
                  <span class="desc">健康检查</span>
                </div>
                <div class="endpoint-pill" @click="copyTextHandler('/api/astrbot/server-info', 'API 端点')">
                  <span class="method get">GET</span>
                  <span class="path">/api/astrbot/server-info</span>
                  <span class="desc">服务器快照</span>
                </div>
                <div class="endpoint-pill" @click="copyTextHandler('/api/astrbot/bind', 'API 端点')">
                  <span class="method post">POST</span>
                  <span class="path">/api/astrbot/bind</span>
                  <span class="desc">QQ 绑定</span>
                </div>
              </div>
            </div>
          </div>
        </PageCard>

        <!-- Live Events Stream Card -->
        <PageCard title="最近事件推送摘要" description="AstrBot WebSocket 与 Core EventBus 的实时事件记录" class="events-card">
          <template #actions>
            <div class="events-toolbar">
              <!-- Search Box -->
              <div class="search-input-wrap">
                <input
                  v-model="searchQuery"
                  type="text"
                  placeholder="搜索事件 / 服务器 ID / 内容…"
                  class="search-input"
                />
                <button v-if="searchQuery" type="button" class="clear-search" @click="searchQuery = ''">✕</button>
              </div>

              <!-- Filter Tabs -->
              <div class="filter-pills">
                <button
                  v-for="filter in (['all', 'match', 'player', 'squad', 'core', 'heartbeat'] as const)"
                  :key="filter"
                  type="button"
                  class="filter-btn"
                  :class="{ active: activeFilter === filter }"
                  @click="activeFilter = filter"
                >
                  {{
                    filter === "all" ? "全部" :
                    filter === "match" ? "对局" :
                    filter === "player" ? "玩家" :
                    filter === "squad" ? "小队" :
                    filter === "core" ? "核心" : "心跳"
                  }}
                </button>
              </div>
            </div>
          </template>

          <!-- Events List Container -->
          <div class="events-wrapper">
            <div v-if="!filteredEvents.length" class="empty-state">
              <div class="empty-icon">📭</div>
              <p class="empty-text">
                {{ searchQuery || activeFilter !== 'all' ? '没有符合筛选条件的事件记录' : '暂无事件推送记录' }}
              </p>
            </div>

            <div v-else class="events-list">
              <article
                v-for="(event, index) in filteredEvents"
                :key="event.eventId || `${event.time}-${index}`"
                class="event-item"
                :class="{ expanded: expandedEventIndices.has(index) }"
              >
                <div class="event-header" @click="toggleExpandEvent(index)">
                  <div class="event-main-info">
                    <AppStatusBadge :tone="getEventTypeBadgeTone(event.type)">
                      {{ event.type || "core.event" }}
                    </AppStatusBadge>
                    <span v-if="event.data?.serverId || event.serverId" class="server-badge">
                      🖥️ {{ event.data?.serverId || event.serverId }}
                    </span>
                    <span v-if="event.eventId" class="server-badge">{{ event.eventId }}</span>
                  </div>

                  <div class="event-meta">
                    <time :title="formatDateTime(event.time)" class="event-time">
                      {{ formatRelativeTime(event.time) }}
                    </time>
                    <button type="button" class="expand-btn" :aria-label="expandedEventIndices.has(index) ? '收起详情' : '展开详情'">
                      {{ expandedEventIndices.has(index) ? "▲" : "▼" }}
                    </button>
                  </div>
                </div>

                <div v-if="event.type === 'match.finished'" class="match-event-summary">
                  <span>{{ event.data?.map || event.data?.layer || "未知地图" }}</span>
                  <span>{{ event.data?.mode || "未知模式" }}</span>
                  <span>胜方 {{ event.data?.winner || "未知" }}</span>
                  <span>{{ event.data?.players ?? 0 }} 人</span>
                  <span>{{ event.data?.snapshotId || "无快照" }}</span>
                  <AppStatusBadge :tone="event.data?.simulated ? 'warn' : 'ok'">
                    {{ event.data?.simulated ? "模拟" : "真实" }}
                  </AppStatusBadge>
                </div>

                <!-- Expanded JSON Data -->
                <div v-if="expandedEventIndices.has(index)" class="event-detail">
                  <div class="detail-bar">
                    <span class="detail-time">精确时间: {{ formatDateTime(event.time) }}</span>
                    <button
                      v-if="event.data"
                      type="button"
                      class="btn-sm"
                      @click.stop="copyTextHandler(JSON.stringify(event.data, null, 2), '事件 Data')"
                    >
                      复制 JSON
                    </button>
                  </div>
                  <pre v-if="event.data" class="json-code"><code>{{ JSON.stringify(event.data, null, 2) }}</code></pre>
                  <div v-else class="no-payload">无 Data 数据</div>
                </div>
              </article>
            </div>
          </div>
        </PageCard>
      </div>
    </div>
  </AppPage>
</template>

<style scoped>
.astrbot-bridge-page {
  width: 100%;
  box-sizing: border-box;
}

.error-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--color-status-danger, #ef4444) 15%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-status-danger, #ef4444) 30%, transparent);
  color: var(--color-status-danger, #f87171);
  font-size: 14px;
}

.btn-action {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 500;
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.12));
  background: var(--color-bg-card, rgba(255, 255, 255, 0.04));
  color: var(--color-text-primary, #f1f5f9);
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-action:hover {
  background: color-mix(in srgb, var(--color-text-primary, #fff) 8%, var(--color-bg-card, transparent));
}

.btn-action.primary {
  background: var(--color-brand-primary, #3b82f6);
  border-color: var(--color-brand-primary, #3b82f6);
  color: #fff;
}

.btn-action.primary:hover {
  filter: brightness(1.1);
}

.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-text-muted, #64748b);
  display: inline-block;
  transition: background 0.3s ease;
}

.pulse-dot.live {
  background: #22c55e;
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.6);
  animation: pulse-ring 2s infinite;
}

@keyframes pulse-ring {
  0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
  70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
  100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
}

.astrbot-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

/* KPI Grid */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 14px;
}

.kpi-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 16px;
  border-radius: 14px;
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.08));
  background: var(--color-bg-card, rgba(15, 23, 42, 0.6));
  box-shadow: var(--shadow-sm, 0 2px 8px rgba(0,0,0,0.1));
  backdrop-filter: blur(8px);
}

.kpi-card[data-tone="ok"] {
  border-color: color-mix(in srgb, #22c55e 20%, var(--color-border-default, rgba(255, 255, 255, 0.08)));
}

.kpi-icon {
  font-size: 24px;
  line-height: 1;
  padding: 8px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.05);
}

.kpi-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  flex: 1;
}

.kpi-label {
  font-size: 12px;
  color: var(--color-text-muted, #94a3b8);
  font-weight: 500;
}

.kpi-value-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.kpi-value {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-text-primary, #f8fafc);
  line-height: 1.2;
}

.kpi-value .unit {
  font-size: 13px;
  font-weight: 400;
  color: var(--color-text-muted, #94a3b8);
}

.kpi-subtext {
  font-size: 12px;
  color: var(--color-text-secondary, #cbd5e1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.code-font {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.match-test-layout {
  display: grid;
  grid-template-columns: minmax(260px, 0.8fr) minmax(320px, 1.4fr) minmax(180px, 0.6fr);
  gap: 16px;
  align-items: stretch;
}

.match-test-status,
.match-test-result,
.match-test-action {
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.08));
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.18);
  padding: 14px;
}

.match-test-status {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.test-status-item {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.test-status-item span,
.test-hint {
  color: var(--color-text-muted, #94a3b8);
  font-size: 12px;
}

.test-status-item strong {
  color: var(--color-text-primary, #f8fafc);
  font-size: 14px;
}

.match-test-result {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.test-event-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.test-event-heading > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.test-event-heading strong {
  overflow: hidden;
  color: var(--color-text-primary, #f8fafc);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.match-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 14px;
  font-size: 12px;
  color: var(--color-text-muted, #94a3b8);
}

.match-summary-grid strong {
  color: var(--color-text-secondary, #cbd5e1);
  overflow-wrap: anywhere;
}

.test-event-id {
  display: block;
  overflow: hidden;
  padding: 7px 9px;
  border-radius: 7px;
  background: rgba(59, 130, 246, 0.1);
  color: #7dd3fc;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ack-summary,
.match-test-action {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
}

.match-test-action {
  justify-content: center;
}

.match-test-action .btn-action {
  justify-content: center;
}

.test-warning {
  color: #fbbf24;
  line-height: 1.4;
}

.text-danger {
  color: #f87171;
  font-size: 12px;
}

.match-event-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 0 14px 10px;
  color: var(--color-text-secondary, #cbd5e1);
  font-size: 12px;
}

@media (max-width: 1100px) {
  .match-test-layout {
    grid-template-columns: 1fr 1fr;
  }

  .match-test-action {
    grid-column: 1 / -1;
  }
}

@media (max-width: 720px) {
  .match-test-layout {
    grid-template-columns: 1fr;
  }

  .match-test-action {
    grid-column: auto;
  }
}

/* Main Cards Grid */
.cards-grid {
  display: grid;
  grid-template-columns: minmax(300px, 1fr) minmax(360px, 1.4fr);
  gap: 16px;
  align-items: start;
}

@media (max-width: 1024px) {
  .cards-grid {
    grid-template-columns: 1fr;
  }
}

/* Config Stack */
.config-stack {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.info-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.06));
}

.info-item:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.info-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted, #94a3b8);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.info-val {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.code-block {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.08));
}

.code-block code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  color: #38bdf8;
}

.btn-sm {
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.12));
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-primary, #f1f5f9);
  cursor: pointer;
  transition: background 0.2s ease;
}

.btn-sm:hover {
  background: rgba(255, 255, 255, 0.18);
}

.tags-wrap {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.chip-tag {
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.1));
  color: var(--color-text-secondary, #cbd5e1);
}

.chip-tag.primary-tag {
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.3);
  color: #60a5fa;
}

/* Endpoint Ref */
.endpoint-ref {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.08));
}

.ref-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-muted, #94a3b8);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.endpoint-pills {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
}

.endpoint-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.06));
  cursor: pointer;
  transition: all 0.2s ease;
}

.endpoint-pill:hover {
  border-color: rgba(56, 189, 248, 0.3);
  background: rgba(56, 189, 248, 0.05);
}

.method {
  font-size: 10px;
  font-weight: 800;
  padding: 2px 5px;
  border-radius: 4px;
  text-transform: uppercase;
}

.method.get {
  background: rgba(34, 197, 94, 0.2);
  color: #4ade80;
}

.method.post {
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
}

.path {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  color: var(--color-text-primary, #f1f5f9);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.desc {
  font-size: 11px;
  color: var(--color-text-muted, #94a3b8);
}

/* Events Card */
.events-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.search-input-wrap {
  position: relative;
  min-width: 180px;
}

.search-input {
  width: 100%;
  padding: 6px 28px 6px 10px;
  border-radius: 8px;
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.12));
  background: rgba(0, 0, 0, 0.2);
  color: var(--color-text-primary, #f1f5f9);
  font-size: 12px;
  box-sizing: border-box;
}

.search-input:focus {
  outline: none;
  border-color: var(--color-brand-primary, #3b82f6);
}

.clear-search {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  border: none;
  background: transparent;
  color: var(--color-text-muted, #94a3b8);
  font-size: 11px;
  cursor: pointer;
}

.filter-pills {
  display: flex;
  gap: 4px;
  background: rgba(0, 0, 0, 0.2);
  padding: 3px;
  border-radius: 8px;
}

.filter-btn {
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--color-text-muted, #94a3b8);
  cursor: pointer;
  transition: all 0.15s ease;
}

.filter-btn:hover {
  color: var(--color-text-primary, #f1f5f9);
}

.filter-btn.active {
  background: var(--color-brand-primary, #3b82f6);
  color: #fff;
}

/* Events Wrapper & List */
.events-wrapper {
  max-height: 480px;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-right: 4px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  text-align: center;
}

.empty-icon {
  font-size: 32px;
  margin-bottom: 8px;
}

.empty-text {
  font-size: 13px;
  color: var(--color-text-muted, #94a3b8);
  margin: 0;
}

.events-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.event-item {
  border-radius: 10px;
  border: 1px solid var(--color-border-default, rgba(255, 255, 255, 0.08));
  background: rgba(0, 0, 0, 0.15);
  transition: background 0.2s ease, border-color 0.2s ease;
}

.event-item:hover {
  background: rgba(255, 255, 255, 0.02);
  border-color: rgba(255, 255, 255, 0.14);
}

.event-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  cursor: pointer;
  user-select: none;
}

.event-main-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.server-badge {
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--color-text-secondary, #cbd5e1);
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 6px;
  border-radius: 4px;
}

.event-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.event-time {
  font-size: 12px;
  color: var(--color-text-muted, #94a3b8);
}

.expand-btn {
  background: transparent;
  border: none;
  color: var(--color-text-muted, #94a3b8);
  font-size: 10px;
  cursor: pointer;
}

.event-detail {
  padding: 12px 14px;
  border-top: 1px dashed var(--color-border-default, rgba(255, 255, 255, 0.08));
  background: rgba(0, 0, 0, 0.3);
  border-bottom-left-radius: 10px;
  border-bottom-right-radius: 10px;
}

.detail-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.detail-time {
  font-size: 11px;
  color: var(--color-text-muted, #94a3b8);
}

.json-code {
  margin: 0;
  padding: 10px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.05);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  color: #7dd3fc;
  overflow-x: auto;
  max-height: 200px;
}

.no-payload {
  font-size: 12px;
  color: var(--color-text-muted, #94a3b8);
  font-style: italic;
}
</style>
