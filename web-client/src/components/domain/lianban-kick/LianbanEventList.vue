<template>
  <PageCard title="最近事件" description="用于快速确认这个插件到底有没有在工作。">
    <EmptyState v-if="!events.length" title="当前没有事件记录。" compact />
    <div v-else class="lianban-event-list">
      <article v-for="event in events" :key="event.id" class="lianban-event">
        <div class="lianban-event__head">
          <strong>{{ event.kind }}</strong>
          <span>{{ formatTime(event.at) }}</span>
        </div>
        <dl class="lianban-event__grid">
          <div v-if="event.playerName">
            <dt>玩家</dt>
            <dd>{{ event.playerName }}</dd>
          </div>
          <div v-if="event.steamID">
            <dt>SteamID</dt>
            <dd>{{ event.steamID }}</dd>
          </div>
          <div v-if="event.eosID">
            <dt>EOSID</dt>
            <dd>{{ event.eosID }}</dd>
          </div>
          <div v-if="event.matchType">
            <dt>匹配</dt>
            <dd>{{ event.matchType }}</dd>
          </div>
          <div v-if="event.playersScanned != null">
            <dt>扫描人数</dt>
            <dd>{{ event.playersScanned }}</dd>
          </div>
          <div v-if="event.entries != null">
            <dt>条目数</dt>
            <dd>{{ event.entries }}</dd>
          </div>
          <div v-if="event.error">
            <dt>错误</dt>
            <dd class="lianban-event__error">{{ event.error }}</dd>
          </div>
        </dl>
      </article>
    </div>
  </PageCard>
</template>

<script setup lang="ts">
import PageCard from "../../common/PageCard.vue";
import EmptyState from "../../ui/EmptyState.vue";
import { formatTime } from "../../../composables/useDateTimeFormat";
import type { LianbanEvent } from "./types";

defineProps<{
  events: LianbanEvent[];
}>();
</script>

<style scoped>
.lianban-event-list {
  display: grid;
  gap: 12px;
}

.lianban-event {
  border: 1px solid var(--color-border-default);
  border-radius: var(--card-radius, 14px);
  padding: 14px;
  background: rgba(255, 255, 255, 0.02);
}

.lianban-event__head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.lianban-event__head span {
  color: var(--color-text-secondary);
  font-size: 12px;
}

.lianban-event__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.lianban-event__grid dt {
  color: var(--color-text-muted);
  font-size: 12px;
  margin-bottom: 4px;
}

.lianban-event__grid dd {
  margin: 0;
  word-break: break-all;
}

.lianban-event__error {
  color: var(--color-status-danger, var(--color-status-error));
}

@media (max-width: 900px) {
  .lianban-event__grid {
    grid-template-columns: 1fr;
  }
}
</style>
