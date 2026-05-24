<template>
  <section class="page full-height">
    <header class="chat-header">
      <div class="header-left">
        <PageHeader title="聊天监控 / Chat Monitor" subtitle="实时显示所有玩家聊天并进行频率监控" />
      </div>
      <div class="header-right">
        <StatusBadge :tone="autoScroll ? 'ok' : 'idle'" @click="autoScroll = !autoScroll">
          {{ autoScroll ? "自动滚动开" : "自动滚动关" }}
        </StatusBadge>
        <button class="clear-button" @click="clearHistory">清除本地历史</button>
      </div>
    </header>

    <main class="chat-main">
      <div class="chat-log" ref="scrollerRef">
        <article v-for="msg in history" :key="msg.seq" class="chat-line" :class="[`channel-${msg.channel.toLowerCase()}`]">
          <span class="chat-time">{{ formatTime(msg.time) }}</span>
          <span class="chat-channel">[{{ msg.channel }}]</span>
          <span class="chat-name" :title="msg.steamID">{{ msg.name }}:</span>
          <span class="chat-message">{{ msg.message }}</span>
        </article>
      </div>
    </main>

    <footer class="chat-footer">
      <div class="frequency-status">
        <strong>活跃统计:</strong>
        <span>当前记录: {{ history.length }} 条</span>
        <span class="spam-warning" v-if="activeSpammers.length > 0">
          ⚠️ 疑似刷屏: {{ activeSpammers.join(', ') }}
        </span>
      </div>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, nextTick, watch } from "vue";
import PageHeader from "../components/common/PageHeader.vue";
import StatusBadge from "../components/common/StatusBadge.vue";
import { apiGet } from "../app/apiClient";

interface ChatMessage {
  time: string;
  channel: string;
  name: string;
  message: string;
  steamID: string;
  seq: number;
}

const history = ref<ChatMessage[]>([]);
const autoScroll = ref(true);
const scrollerRef = ref<HTMLElement | null>(null);
const activeSpammers = ref<string[]>([]);
let pollTimer: number | null = null;

async function fetchHistory() {
  try {
    const res = await apiGet<{ history: ChatMessage[] }>("/api/chat/history");
    if (res.history) {
      history.value = res.history;
    }
  } catch (e) {
    console.error("Failed to fetch chat history", e);
  }
}

function formatTime(iso: string) {
  if (!iso) return "--:--:--";
  return iso.split("T")[1]?.split(".")[0] || iso;
}

function clearHistory() {
  history.value = [];
}

function scrollToEnd() {
  if (autoScroll.value && scrollerRef.value) {
    scrollerRef.value.scrollTop = scrollerRef.value.scrollHeight;
  }
}

watch(() => history.value.length, () => {
  nextTick(scrollToEnd);
});

onMounted(() => {
  fetchHistory();
  pollTimer = window.setInterval(fetchHistory, 2000);
});

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<style scoped>
.page.full-height {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}

.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 20px;
  background: #161b22;
  border-bottom: 1px solid #30363d;
}

.chat-main {
  flex: 1;
  min-height: 0;
  background: #0d1117;
  padding: 8px 0;
}

.chat-log {
  height: 100%;
  overflow-y: auto;
  padding: 0 16px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 13px;
  line-height: 1.6;
}

.chat-line {
  padding: 2px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  display: flex;
  gap: 10px;
}

.chat-time {
  color: #484f58;
  flex-shrink: 0;
}

.chat-channel {
  font-weight: bold;
  width: 90px;
  flex-shrink: 0;
}

.channel-chatall { color: #f85149; }
.channel-chatteam { color: #58a6ff; }
.channel-chatsquad { color: #3fb950; }
.channel-chatadmin { color: #d29922; }

.chat-name {
  color: #c9d1d9;
  font-weight: bold;
  flex-shrink: 0;
}

.chat-message {
  color: #edf2f4;
  word-break: break-all;
}

.chat-footer {
  padding: 10px 20px;
  background: #161b22;
  border-top: 1px solid #30363d;
  font-size: 12px;
  color: #8b949e;
}

.frequency-status {
  display: flex;
  gap: 20px;
  align-items: center;
}

.spam-warning {
  color: #f85149;
  font-weight: bold;
}

.clear-button {
  background: #21262d;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 12px;
  cursor: pointer;
}

.clear-button:hover {
  background: #30363d;
}
</style>
