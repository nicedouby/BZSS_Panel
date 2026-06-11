<template>
  <aside class="match-feed-panel">
    <section class="match-feed-card match-feed-card-chat">
      <header class="match-chat-header">
        <div class="match-chat-title-block">
          <div class="match-chat-eyebrow">Live feed</div>
          <h2 class="match-chat-title">聊天记录</h2>
          <p class="match-chat-subtitle">
            只显示聊天流，不包含内部事件。
          </p>
        </div>

        <div class="match-chat-status-group">
          <StatusBadge :tone="statusTone">{{ statusText }}</StatusBadge>
          <button
            type="button"
            class="match-chat-action"
            :class="{ active: autoScroll }"
            @click="autoScroll = !autoScroll"
          >
            {{ autoScroll ? "自动滚动" : "暂停滚动" }}
          </button>
          <button
            type="button"
            class="match-chat-action"
            @click="clearChatMessages"
          >
            清空
          </button>
        </div>
      </header>

      <div class="match-chat-toolbar">
        <button
          v-for="channel in channels"
          :key="channel.id"
          type="button"
          class="match-chat-filter"
          :class="{ active: enabledChannels[channel.id] }"
          :data-channel="channel.id"
          @click="toggleChannel(channel.id)"
        >
          <span class="match-chat-filter-label">{{ channel.label }}</span>
          <span class="match-chat-filter-count">{{ channelCounts[channel.id] }}</span>
        </button>
      </div>

      <div ref="chatListRef" class="match-chat-list">
        <div v-if="visibleChatMessages.length === 0" class="match-chat-empty">
          暂无聊天记录
        </div>

        <article
          v-for="message in visibleChatMessages"
          :key="message.id"
          class="match-chat-row"
          :class="[`channel-${message.channel}`]"
        >
          <div class="match-chat-row-head">
            <span class="match-chat-time">{{ formatChatTime(message) }}</span>
            <span class="match-chat-channel">[{{ channelLabels[message.channel] }}]</span>
            <span class="match-chat-player" :title="`${displayPlayer(message)}${message.steamId ? ' (' + message.steamId + ')' : ''}`">
              {{ displayPlayer(message) }}:
            </span>
          </div>

          <div class="match-chat-message-block">
            {{ message.message }}
          </div>

          <div v-if="message.teamId != null || message.squadId != null" class="match-chat-meta">
            <span v-if="message.teamId != null">Team {{ message.teamId }}</span>
            <span v-if="message.squadId != null">Squad {{ message.squadId }}</span>
            <span v-if="message.serverId">Server {{ message.serverId }}</span>
          </div>
        </article>
      </div>
    </section>

    <section class="match-feed-card match-feed-card-xm">
      <header class="match-xm-log-header">
        <div class="match-xm-log-title">醒目标志日志</div>
        <div class="match-xm-log-subtitle">只显示内部事件里以 /xm 开头的内容</div>
        <div class="match-xm-log-meta">
          <StatusBadge :tone="xmStatusTone">{{ xmStatusText }}</StatusBadge>
          <button
            type="button"
            class="match-chat-action"
            @click="clearXmMessages"
          >
            清空
          </button>
        </div>
      </header>

      <div class="match-xm-log-list">
        <div v-if="xmErrorText" class="match-xm-log-error">
          {{ xmErrorText }}
        </div>

        <div v-if="visibleXmLines.length === 0 && !xmErrorText" class="match-xm-log-empty">
          暂无 /xm 日志
        </div>

        <article
          v-for="entry in visibleXmLines"
          :key="`xm-${entry.seq}`"
          class="match-xm-log-row"
          :class="{ expanded: expandedXmSeq === entry.seq }"
          @click="toggleXmExpanded(entry.seq)"
        >
          <div class="match-xm-log-row-head">
            <span class="match-chat-time">{{ formatConsoleTime(entry) }}</span>
            <span class="match-chat-channel">[{{ entry.label || entry.stream || "MODULE" }}]</span>
            <span class="match-chat-player" :title="consoleTooltip(entry)">
              {{ consoleScope(entry) }}
            </span>
          </div>
          <div class="match-xm-log-message">{{ extractXmMessage(entry.message || "") }}</div>
          <div class="match-xm-log-meta-row">
            <span v-if="entry.eventName">{{ entry.eventName }}</span>
            <span v-if="entry.operation">{{ entry.operation }}</span>
          </div>
          <div v-if="expandedXmSeq === entry.seq" class="match-xm-log-raw">
            原文: {{ entry.message }}
          </div>
        </article>
      </div>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { apiGet } from "../../app/apiClient";
import { useAuthStore } from "../../stores/auth.store";
import StatusBadge from "../common/StatusBadge.vue";
import type { ConsoleLine } from "../../composables/useConsoleLines";

type ConsoleFeedLine = ConsoleLine & {
  label?: string;
  source?: string;
  moduleId?: string;
};

defineOptions({
  name: "MatchChatPanel",
});

type ChatChannel = "all" | "team" | "squad" | "admin" | "system" | "unknown";

interface ChatMessageEvent {
  id: string;
  serverId: string;
  timestamp: number;
  logTime?: string | null;
  channel: ChatChannel;
  playerName?: string | null;
  eosId?: string | null;
  steamId?: string | null;
  teamId?: number | null;
  squadId?: number | null;
  message: string;
}

interface SocketEnvelope {
  event?: string;
  items?: unknown;
  item?: unknown;
}

const MAX_CHAT_MESSAGES = 300;
const MAX_XM_MESSAGES = 120;

const auth = useAuthStore();
const chatListRef = ref<HTMLElement | null>(null);
const socketRef = ref<WebSocket | null>(null);
const autoScroll = ref(true);
const chatMessages = ref<ChatMessageEvent[]>([]);
const xmMessages = ref<ConsoleFeedLine[]>([]);
const xmLastSeq = ref(0);
const expandedXmSeq = ref<number | null>(null);
const reconnectDelay = ref(1000);
const transportState = ref<"idle" | "connecting" | "live" | "reconnecting" | "offline" | "unsupported">("idle");

const enabledChannels = reactive<Record<ChatChannel, boolean>>({
  all: true,
  team: true,
  squad: true,
  admin: true,
  system: true,
  unknown: true,
});

const channels = [
  { id: "all", label: "公开" },
  { id: "team", label: "阵营" },
  { id: "squad", label: "小队" },
  { id: "admin", label: "管理" },
  { id: "system", label: "系统" },
  { id: "unknown", label: "未知" },
] as const;

const channelLabels: Record<ChatChannel, string> = {
  all: "公开",
  team: "阵营",
  squad: "小队",
  admin: "管理",
  system: "系统",
  unknown: "未知",
};

const channelCounts = computed<Record<ChatChannel, number>>(() => {
  const counts: Record<ChatChannel, number> = {
    all: 0,
    team: 0,
    squad: 0,
    admin: 0,
    system: 0,
    unknown: 0,
  };

  for (const message of chatMessages.value) {
    counts[message.channel] += 1;
  }

  return counts;
});

const visibleChatMessages = computed(() => {
  return chatMessages.value.filter((message) => enabledChannels[message.channel] !== false);
});

const visibleXmLines = computed(() => xmMessages.value.slice(-MAX_XM_MESSAGES));

const xmErrorText = computed(() => {
  const error = xmQuery.error.value;
  if (!error) return "";
  return error instanceof Error ? error.message : String(error);
});

const statusText = computed(() => {
  switch (transportState.value) {
    case "live":
      return "在线";
    case "connecting":
      return "连接中";
    case "reconnecting":
      return "重连中";
    case "offline":
      return "已断开";
    case "unsupported":
      return "不可用";
    default:
      return "待连接";
  }
});

const statusTone = computed(() => {
  switch (transportState.value) {
    case "live":
      return "ok";
    case "connecting":
      return "idle";
    case "reconnecting":
      return "warn";
    case "offline":
    case "unsupported":
      return "error";
    default:
      return "idle";
  }
});

const xmStatusText = computed(() => {
  if (!auth.checked) return "待认证";
  if (!auth.authenticated) return "未登录";
  if (xmQuery.error.value && xmMessages.value.length === 0) return "加载失败";
  if (xmQuery.isFetching.value && xmMessages.value.length === 0) return "加载中";
  return `在线 · ${visibleXmLines.value.length}`;
});

const xmStatusTone = computed(() => {
  if (!auth.checked || !auth.authenticated) return "idle";
  if (xmQuery.error.value && xmMessages.value.length === 0) return "error";
  if (xmQuery.isFetching.value) return "warn";
  return "ok";
});

const xmQuery = useQuery({
  queryKey: computed(() => ["match-xm-lines", auth.checked, auth.authenticated]),
  enabled: computed(() => auth.checked && auth.authenticated),
  queryFn: async () => {
    const params = new URLSearchParams({
      stream: "modules",
      scope: "all",
      level: "all",
      q: "/xm",
      afterSeq: String(xmLastSeq.value),
      limit: "200",
    });

    return apiGet<{ lines?: ConsoleLine[] }>(`/api/console/lines?${params.toString()}`);
  },
  refetchInterval: () => {
    if (!auth.checked || !auth.authenticated) return false;
    return 1200;
  },
  refetchOnWindowFocus: false,
  placeholderData: (previousData) => previousData,
});

let reconnectTimer: number | null = null;
let shouldReconnect = false;

onMounted(() => {
  watchAuthState();
});

onBeforeUnmount(() => {
  shouldReconnect = false;
  disconnectChatSocket();
  clearReconnectTimer();
});

watch(
  () => [auth.checked, auth.authenticated] as const,
  () => {
    watchAuthState();
  },
  { immediate: true },
);

watch(
  () => chatMessages.value.length,
  async () => {
    if (!autoScroll.value) return;
    await nextTick();
    scrollChatToBottom();
  },
);

watch(
  () => xmQuery.data.value?.lines,
  (incoming) => {
    if (!Array.isArray(incoming) || incoming.length === 0) return;

    const next = [...xmMessages.value];
    for (const raw of incoming) {
      const line = normalizeConsoleLine(raw);
      if (!line || !isXmLine(String(line.message ?? ""))) continue;

      const seq = Number(line.seq ?? 0);
      if (seq > xmLastSeq.value) {
        xmLastSeq.value = seq;
      }
      if (next.some((item) => Number(item.seq ?? 0) === seq)) continue;
      next.push(line);
    }

    next.sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0));
    xmMessages.value = next.slice(-MAX_XM_MESSAGES);
  },
  { deep: true },
);

function watchAuthState() {
  if (!auth.checked || !auth.authenticated) {
    shouldReconnect = false;
    disconnectChatSocket();
    chatMessages.value = [];
    xmMessages.value = [];
    xmLastSeq.value = 0;
    transportState.value = auth.checked ? "offline" : "idle";
    return;
  }

  shouldReconnect = true;

  if (!socketRef.value) {
    connectChatSocket();
  }
}

function connectChatSocket() {
  if (typeof window.WebSocket === "undefined") {
    transportState.value = "unsupported";
    return;
  }

  clearReconnectTimer();
  transportState.value = socketRef.value ? "reconnecting" : "connecting";

  const socket = new WebSocket(buildWebSocketUrl("/ws/chat"));
  socketRef.value = socket;

  socket.addEventListener("open", handleSocketOpen);
  socket.addEventListener("message", handleSocketMessage);
  socket.addEventListener("close", handleSocketClose);
  socket.addEventListener("error", handleSocketError);
}

function handleSocketOpen() {
  reconnectDelay.value = 1000;
  transportState.value = "live";
}

function handleSocketMessage(event: MessageEvent<string>) {
  let payload: SocketEnvelope | ChatMessageEvent[] | ChatMessageEvent | null = null;

  try {
    payload = JSON.parse(String(event.data ?? "null"));
  } catch {
    return;
  }

  if (Array.isArray(payload)) {
    replaceChatMessages(payload);
    return;
  }

  if (!payload || typeof payload !== "object") return;

  const envelope = payload as SocketEnvelope;
  if (envelope.event === "server:chat:recent") {
    replaceChatMessages(Array.isArray(envelope.items) ? envelope.items : []);
    return;
  }

  if (envelope.event === "server:chat:message") {
    appendChatMessage(envelope.item);
  }
}

function handleSocketClose() {
  socketRef.value = null;

  if (!shouldReconnect) {
    transportState.value = "offline";
    return;
  }

  transportState.value = "reconnecting";
  scheduleReconnect();
}

function handleSocketError() {
  if (!shouldReconnect) return;
  transportState.value = "reconnecting";
}

function scheduleReconnect() {
  clearReconnectTimer();

  const delay = reconnectDelay.value;
  reconnectDelay.value = Math.min(Math.floor(delay * 1.6), 10_000);

  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    if (!shouldReconnect || !auth.checked || !auth.authenticated || socketRef.value) {
      return;
    }
    connectChatSocket();
  }, delay);
}

function clearReconnectTimer() {
  if (reconnectTimer != null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function disconnectChatSocket() {
  clearReconnectTimer();

  const socket = socketRef.value;
  socketRef.value = null;

  if (!socket) return;

  socket.removeEventListener("open", handleSocketOpen);
  socket.removeEventListener("message", handleSocketMessage);
  socket.removeEventListener("close", handleSocketClose);
  socket.removeEventListener("error", handleSocketError);

  try {
    socket.close();
  } catch {}
}

function replaceChatMessages(items: unknown[]) {
  const next = items
    .map((item) => normalizeChatMessage(item))
    .filter((item): item is ChatMessageEvent => Boolean(item));

  chatMessages.value = dedupeChatMessages(next);
}

function appendChatMessage(item: unknown) {
  const normalized = normalizeChatMessage(item);
  if (!normalized) return;

  const next = [...chatMessages.value, normalized];
  chatMessages.value = dedupeChatMessages(next);
}

function dedupeChatMessages(items: ChatMessageEvent[]) {
  const seen = new Set<string>();
  const result: ChatMessageEvent[] = [];

  for (const item of items) {
    const id = String(item.id || "");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(item);
  }

  return result.slice(-MAX_CHAT_MESSAGES);
}

function normalizeChatMessage(raw: unknown): ChatMessageEvent | null {
  if (!raw || typeof raw !== "object") return null;

  const source = raw as Record<string, any>;
  const timestamp = normalizeTimestamp(source.timestamp ?? source.time ?? source.at);
  const message = String(source.message ?? "").trim();
  if (!message) return null;

  return {
    id: normalizeId(source.id ?? source.seq ?? `${timestamp}-${source.channel ?? ""}-${source.playerName ?? source.name ?? ""}-${message}`),
    serverId: String(source.serverId ?? source.server_id ?? ""),
    timestamp,
    logTime: normalizeNullableText(source.logTime ?? source.log_time),
    channel: normalizeChannel(source.chatChannel ?? source.channel),
    playerName: normalizeNullableText(source.playerName ?? source.name),
    eosId: normalizeNullableText(source.eosId ?? source.eosID ?? source.eosid),
    steamId: normalizeNullableText(source.steamId ?? source.steamID ?? source.steamid),
    teamId: normalizeNullableNumber(source.teamId ?? source.teamID),
    squadId: normalizeNullableNumber(source.squadId ?? source.squadID),
    message,
  };
}

function normalizeConsoleLine(raw: unknown): ConsoleFeedLine | null {
  if (!raw || typeof raw !== "object") return null;

  const source = raw as Record<string, any>;
  const message = String(source.message ?? "").trim();
  if (!message) return null;

  return {
    seq: Number(source.seq ?? 0),
    time: String(source.time ?? ""),
    stream: String(source.stream ?? "modules"),
    scope: String(source.scope ?? ""),
    level: String(source.level ?? "info"),
    message,
    channel: String(source.channel ?? ""),
    eventName: String(source.eventName ?? ""),
    operation: String(source.operation ?? ""),
    dataSummary: String(source.dataSummary ?? ""),
    tags: Array.isArray(source.tags) ? source.tags.map((item: unknown) => String(item)) : [],
    label: String(source.label ?? ""),
    source: String(source.source ?? ""),
    moduleId: String(source.moduleId ?? ""),
  };
}

function normalizeChannel(value: unknown): ChatChannel {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return "unknown";

  if (text === "chatall" || text === "all") return "all";
  if (text === "chatteam" || text === "team") return "team";
  if (text === "chatsquad" || text === "squad") return "squad";
  if (text === "chatadmin" || text === "admin") return "admin";
  if (text === "chatsystem" || text === "system") return "system";
  return "unknown";
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;

  const text = String(value ?? "").trim();
  if (!text) return Date.now();

  const parsed = Date.parse(text);
  if (Number.isFinite(parsed)) return parsed;

  const numeric = Number(text);
  if (Number.isFinite(numeric)) return numeric;

  return Date.now();
}

function normalizeNullableText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizeNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeId(value: unknown): string {
  const text = String(value ?? "").trim();
  return text || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isXmLine(text: string): boolean {
  return Boolean(extractXmMessage(text) !== null);
}

function displayPlayer(message: ChatMessageEvent): string {
  if (message.playerName) return message.playerName;
  if (message.channel === "system") return "System";
  if (message.channel === "admin") return "Admin";
  return "Unknown";
}

function playerTooltip(message: ChatMessageEvent): string {
  return [message.steamId, message.eosId].filter(Boolean).join(" / ");
}

function formatChatTime(message: ChatMessageEvent): string {
  if (message.logTime) return message.logTime;
  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(message.timestamp));
}

function formatConsoleTime(entry: ConsoleFeedLine): string {
  if (entry.time) {
    const text = String(entry.time);
    const iso = text.match(/T(\d{2}:\d{2}:\d{2})/);
    if (iso) return iso[1];
    const plain = text.match(/(\d{2}:\d{2}:\d{2})/);
    if (plain) return plain[1];
    return text;
  }

  return "";
}

function extractXmMessage(text: string): string | null {
  const trimmed = String(text ?? "").trimStart();
  if (!trimmed.toLowerCase().startsWith("/xm")) {
    return null;
  }

  const content = trimmed.slice(3).trimStart();
  return content || "(空内容)";
}

function consoleScope(entry: ConsoleFeedLine): string {
  return String(entry.scope ?? entry.source ?? entry.moduleId ?? "module");
}

function consoleTooltip(entry: ConsoleFeedLine): string {
  const parts = [entry.source, entry.eventName, entry.operation]
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
  return parts.join(" · ");
}

function scrollChatToBottom() {
  const el = chatListRef.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

function clearChatMessages() {
  chatMessages.value = [];
}

function clearXmMessages() {
  xmMessages.value = [];
  expandedXmSeq.value = null;
}

function toggleChannel(channel: ChatChannel) {
  enabledChannels[channel] = !enabledChannels[channel];
}

function toggleXmExpanded(seq: number) {
  expandedXmSeq.value = expandedXmSeq.value === seq ? null : seq;
}

function buildWebSocketUrl(path: string) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}
</script>

<style scoped>
.match-feed-panel {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow: hidden;
}

.match-feed-card {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 16px;
  border: 1px solid rgba(130, 154, 180, 0.22);
  box-shadow: var(--shadow-md);
}

.match-feed-card-chat {
  flex: 1.35 1 0;
  background:
    radial-gradient(circle at 0% 0%, rgba(96, 165, 250, 0.1), transparent 28%),
    radial-gradient(circle at 100% 0%, rgba(34, 197, 94, 0.06), transparent 24%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.014)),
    rgba(13, 20, 28, 0.96);
}

.match-feed-card-xm {
  flex: 1.2 1 0;
  background:
    radial-gradient(circle at 0% 0%, rgba(250, 204, 21, 0.12), transparent 26%),
    radial-gradient(circle at 100% 0%, rgba(251, 191, 36, 0.08), transparent 24%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.012)),
    rgba(10, 13, 18, 0.97);
  border-color: rgba(250, 204, 21, 0.24);
}

.match-chat-header {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  padding: 7px 11px 6px;
  border-bottom: 1px solid rgba(130, 154, 180, 0.14);
  background: rgba(8, 12, 18, 0.62);
}

.match-chat-title-block {
  min-width: 0;
}

.match-chat-eyebrow {
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--color-text-muted);
}

.match-chat-title {
  margin: 1px 0 0;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.2;
  color: var(--color-text-primary);
}

.match-chat-subtitle {
  display: none;
}

.match-chat-status-group,
.match-xm-log-meta {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  align-items: center;
}

.match-chat-action {
  min-height: 24px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid rgba(130, 154, 180, 0.22);
  background: rgba(20, 28, 39, 0.85);
  color: var(--color-text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.match-chat-action.active {
  color: #dbeafe;
  border-color: rgba(96, 165, 250, 0.38);
  background: rgba(37, 99, 235, 0.18);
}

.match-chat-toolbar {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: none;
  gap: 4px;
  padding: 4px 6px;
  border-bottom: 1px solid rgba(130, 154, 180, 0.1);
}

.match-chat-toolbar::-webkit-scrollbar {
  display: none;
}

.match-chat-filter {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-height: 20px;
  padding: 0 4px;
  border-radius: 4px;
  border: 1px solid rgba(130, 154, 180, 0.18);
  background: rgba(19, 26, 37, 0.7);
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 10px;
  transition: all 0.12s ease;
  flex: 1 1 auto;
}

.match-chat-filter.active {
  background: rgba(31, 41, 55, 0.95);
  color: var(--color-text-primary);
  border-color: rgba(148, 163, 184, 0.4);
}

.match-chat-filter[data-channel="all"].active {
  border-color: rgba(96, 165, 250, 0.5);
  color: #dbeafe;
}

.match-chat-filter[data-channel="team"].active {
  border-color: rgba(52, 211, 153, 0.45);
  color: #bbf7d0;
}

.match-chat-filter[data-channel="squad"].active {
  border-color: rgba(250, 204, 21, 0.45);
  color: #fef08a;
}

.match-chat-filter[data-channel="admin"].active {
  border-color: rgba(248, 113, 113, 0.45);
  color: #fecaca;
}

.match-chat-filter[data-channel="system"].active {
  border-color: rgba(192, 132, 252, 0.45);
  color: #e9d5ff;
}

.match-chat-filter[data-channel="unknown"].active {
  border-color: rgba(148, 163, 184, 0.45);
  color: #e2e8f0;
}

.match-chat-filter-label {
  font-weight: 600;
}

.match-chat-filter-count {
  min-width: 12px;
  padding: 0 3px;
  border-radius: 999px;
  text-align: center;
  font-size: 9px;
  color: var(--color-text-muted);
  background: rgba(255, 255, 255, 0.06);
}

.match-chat-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 6px 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.match-chat-list::-webkit-scrollbar {
  width: 4px;
}

.match-chat-list::-webkit-scrollbar-track {
  background: transparent;
}

.match-chat-list::-webkit-scrollbar-thumb {
  border-radius: 2px;
  background: rgba(130, 154, 180, 0.2);
}

.match-chat-list::-webkit-scrollbar-thumb:hover {
  background: rgba(130, 154, 180, 0.35);
}

.match-chat-empty {
  flex-shrink: 0;
  padding: 24px 12px;
  border-radius: 12px;
  border: 1px dashed rgba(130, 154, 180, 0.22);
  color: var(--color-text-muted);
  text-align: center;
  font-size: 13px;
}

.match-chat-row {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 5px 8px;
  border-radius: 8px;
  border: 1px solid rgba(130, 154, 180, 0.12);
  background: rgba(255, 255, 255, 0.025);
  align-self: stretch;
  overflow: hidden;
  transition: background-color 0.12s ease;
}

.match-chat-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.match-chat-row-head,
.match-xm-log-row-head {
  display: flex;
  flex-wrap: nowrap;
  gap: 5px;
  align-items: center;
  min-width: 0;
  flex-shrink: 0;
}

.match-chat-time {
  color: var(--color-text-muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.match-chat-channel {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.06em;
  flex-shrink: 0;
}

.match-chat-player {
  min-width: 0;
  max-width: 140px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text-primary);
  font-weight: 600;
  font-size: 11px;
  flex-shrink: 0;
}

.match-chat-message-block {
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: 11px;
  line-height: 1.35;
  word-break: break-word;
  white-space: pre-wrap;
  margin-top: 2px;
  padding-left: 2px;
}

.match-chat-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--color-text-muted);
  font-size: 10px;
}

.match-chat-row.channel-all {
  border-color: rgba(96, 165, 250, 0.18);
}

.match-chat-row.channel-team {
  border-color: rgba(52, 211, 153, 0.18);
}

.match-chat-row.channel-squad {
  border-color: rgba(250, 204, 21, 0.18);
}

.match-chat-row.channel-admin {
  border-color: rgba(248, 113, 113, 0.18);
}

.match-chat-row.channel-system {
  border-color: rgba(192, 132, 252, 0.18);
}

.match-chat-row.channel-unknown {
  border-color: rgba(148, 163, 184, 0.16);
}

.match-chat-row.channel-all .match-chat-channel {
  color: #93c5fd;
}

.match-chat-row.channel-team .match-chat-channel {
  color: #86efac;
}

.match-chat-row.channel-squad .match-chat-channel {
  color: #fde047;
}

.match-chat-row.channel-admin .match-chat-channel {
  color: #fca5a5;
}

.match-chat-row.channel-system .match-chat-channel {
  color: #d8b4fe;
}

.match-chat-row.channel-unknown .match-chat-channel {
  color: #cbd5e1;
}

.match-xm-log-header {
  flex: 0 0 auto;
  padding: 7px 11px 6px;
  border-bottom: 1px solid rgba(250, 204, 21, 0.12);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.match-xm-log-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #fef08a;
  text-transform: uppercase;
}

.match-xm-log-subtitle {
  display: none;
}

.match-xm-log-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.match-xm-log-list::-webkit-scrollbar {
  width: 4px;
}

.match-xm-log-list::-webkit-scrollbar-track {
  background: transparent;
}

.match-xm-log-list::-webkit-scrollbar-thumb {
  border-radius: 2px;
  background: rgba(250, 204, 21, 0.2);
}

.match-xm-log-empty,
.match-xm-log-error {
  flex-shrink: 0;
  padding: 16px 14px;
  border-radius: 13px;
  font-size: 12px;
  text-align: center;
}

.match-xm-log-empty {
  border: 1px dashed rgba(250, 204, 21, 0.28);
  color: rgba(254, 240, 138, 0.9);
}

.match-xm-log-error {
  border: 1px solid rgba(248, 113, 113, 0.28);
  color: #fecaca;
  background: rgba(248, 113, 113, 0.08);
}

.match-xm-log-row {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid rgba(250, 204, 21, 0.2);
  background: rgba(250, 204, 21, 0.06);
  cursor: pointer;
  overflow: hidden;
  transition: background-color 0.12s ease;
}

.match-xm-log-row:hover {
  background: rgba(250, 204, 21, 0.1);
}

.match-xm-log-message {
  min-width: 0;
  color: #fef3c7;
  font-size: 11px;
  line-height: 1.4;
  word-break: break-word;
  white-space: pre-wrap;
}

.match-xm-log-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  color: rgba(253, 224, 71, 0.88);
  font-size: 10px;
  font-weight: 400;
  opacity: 0.9;
}

.match-xm-log-raw {
  min-width: 0;
  border-top: 1px solid rgba(250, 204, 21, 0.16);
  padding-top: 6px;
  color: rgba(254, 243, 199, 0.82);
  font-size: 11px;
  line-height: 1.45;
  word-break: break-word;
  white-space: pre-wrap;
}

@media (max-width: 1180px) {
  .match-feed-panel {
    min-height: 560px;
  }
}
</style>
