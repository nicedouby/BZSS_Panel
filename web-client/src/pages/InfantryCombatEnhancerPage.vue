<template>
  <section class="ice-page">
    <PageHeader
      :title="t('routeTitle.infantryCombatEnhancer')"
      subtitle="查看步兵战斗增强事件、提醒决策和跳过原因"
    >
      <template #actions>
        <button type="button" class="ghost-button" @click="reload">刷新</button>
        <button type="button" class="ghost-button" @click="settingsOpen = true">设置</button>
        <button type="button" class="ghost-button danger" @click="clearEvents">清空记录</button>
      </template>
    </PageHeader>

    <InfantryCombatSummaryBar :overview="overview" :loading="isEventsFetching" />

    <InfantryCombatToolbar
      :filters="filters"
      :loading="isEventsFetching || isConfigLoading"
      @update:filters="updateFilters"
    />

    <DataState
      :error="pageError"
    >
      <div class="ice-main">
        <InfantryCombatEventTable
          class="ice-table-pane"
          :events="visibleEvents"
          :selected-id="selectedEvent?.id"
          @select="setSelectedEvent"
        />

        <InfantryCombatEventDetail
          class="ice-detail-pane"
          :event="selectedEvent"
          @close="setSelectedEvent(null)"
        />
      </div>
    </DataState>

    <InfantryCombatSettingsDrawer
      v-model:open="settingsOpen"
      :config="config"
      :saving="isConfigSaving"
      @save="saveConfig"
    />
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { t } from "../i18n";
import PageHeader from "../components/common/PageHeader.vue";
import DataState from "../components/common/DataState.vue";
import InfantryCombatSummaryBar from "../components/infantry-combat/InfantryCombatSummaryBar.vue";
import InfantryCombatToolbar from "../components/infantry-combat/InfantryCombatToolbar.vue";
import InfantryCombatEventTable from "../components/infantry-combat/InfantryCombatEventTable.vue";
import InfantryCombatEventDetail from "../components/infantry-combat/InfantryCombatEventDetail.vue";
import InfantryCombatSettingsDrawer from "../components/infantry-combat/InfantryCombatSettingsDrawer.vue";
import { useInfantryCombatEnhancer } from "../composables/useInfantryCombatEnhancer";
import type { InfantryCombatConfig, InfantryCombatFilters } from "../types/infantry-combat-enhancer";

const settingsOpen = ref(false);

const {
  filters,
  config,
  overview,
  pageError,
  selectedEvent,
  visibleEvents,
  reload,
  clearEvents,
  patchConfig,
  setSelectedEvent,
  isEventsLoading,
  isEventsFetching,
  isConfigLoading,
  isConfigSaving,
} = useInfantryCombatEnhancer();

function updateFilters(next: InfantryCombatFilters) {
  Object.assign(filters, next);
}

async function saveConfig(next: InfantryCombatConfig) {
  try {
    await patchConfig(next);
    settingsOpen.value = false;
  } catch {}
}
</script>

<style scoped>
.ice-page {
  display: grid;
  gap: 12px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.ghost-button {
  border: 1px solid #31404d;
  background: #0f151b;
  color: #edf2f4;
  border-radius: 10px;
  padding: 8px 12px;
}

.ghost-button.danger {
  border-color: rgba(248, 113, 113, 0.35);
  color: #ffcdcd;
}

.ice-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 12px;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.ice-table-pane,
.ice-detail-pane {
  height: 100%;
  min-height: 0;
  overflow: auto;
}

@media (max-width: 1200px) {
  .ice-main {
    grid-template-columns: 1fr;
  }

  .ice-detail-pane {
    max-height: 420px;
  }
}
</style>
