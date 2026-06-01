<template>
  <section class="bz-page infantry-combat-page">
    <PageHeader
      :title="t('routeTitle.infantryCombatEnhancer')"
    >
      <template #actions>
        <button type="button" class="bz-btn bz-btn-ghost" @click="reload">刷新</button>
        <button type="button" class="bz-btn bz-btn-ghost" @click="settingsOpen = true">设置</button>
        <button type="button" class="bz-btn bz-btn-danger" @click="clearEvents">清空记录</button>
      </template>
    </PageHeader>

    <DataState
      :loading="isEventsLoading || isConfigLoading"
      :error="pageError"
    >
      <div class="ice-shell">
        <div class="ice-top">
          <InfantryCombatSummaryBar :overview="overview" :loading="isEventsFetching" />

          <InfantryCombatToolbar
            :filters="filters"
            :loading="isEventsFetching || isConfigLoading"
            @update:filters="updateFilters"
          />
        </div>

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
.infantry-combat-page {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.ice-shell {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.ice-top {
  display: grid;
  gap: 12px;
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

.ice-top :deep(.ice-summary-card .bz-card-body.compact),
.ice-top :deep(.ice-toolbar-card .bz-card-body.compact) {
  padding-block: 10px;
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
