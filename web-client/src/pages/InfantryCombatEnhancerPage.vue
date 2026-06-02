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
      class="ice-state"
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

        <div
          class="ice-main"
          :class="{ 'ice-main--with-detail': Boolean(selectedEvent) }"
        >
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
  --ice-page-height: calc(100dvh - 72px);
  --ice-detail-width: 284px;

  width: 100%;
  max-width: none;
  display: grid;
  gap: 12px;
  height: var(--ice-page-height);
  max-height: var(--ice-page-height);
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
}

.ice-shell {
  display: grid;
  gap: 12px;
  min-height: 0;
  height: 100%;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}

.ice-state {
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.ice-top {
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(0, 1fr);
  align-items: stretch;
}

.ice-main {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(260px, var(--ice-detail-width));
  gap: 12px;
  min-height: 0;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
}

.ice-main--with-detail {
  --ice-detail-width: 332px;
}

.ice-table-pane {
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.ice-detail-pane {
  min-height: 0;
  height: 100%;
  overflow: auto;
}

.ice-top :deep(.ice-summary-card .bz-card-body.compact),
.ice-top :deep(.ice-toolbar-card .bz-card-body.compact) {
  padding-block: 10px;
}

@media (min-width: 1280px) {
  .ice-top {
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  }
}

@media (max-width: 1180px) {
  .ice-main {
    grid-template-columns: minmax(0, 1fr);
  }

  .ice-detail-pane {
    max-height: min(420px, 42dvh);
  }
}

@media (max-width: 860px) {
  .ice-top {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
