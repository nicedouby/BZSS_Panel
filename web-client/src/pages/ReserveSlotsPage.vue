<template>
  <section class="bz-page reserve-slots-page">
    <PageHeader
      :title="t('routeTitle.reserveSlots')"
      subtitle="管理管理员配置中的预留位区块，并同步到本地 JSON 供页面展示。"
    >
      <template #actions>
        <button type="button" class="bz-btn bz-btn-ghost" @click="reloadPage">
          刷新
        </button>
      </template>
    </PageHeader>

    <div class="reserve-shell">
      <ReserveSlotsSection ref="sectionRef" :can-edit="canEdit" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { t } from "../i18n";
import PageHeader from "../components/common/PageHeader.vue";
import ReserveSlotsSection from "../components/settings/ReserveSlotsSection.vue";
import { useAuthStore } from "../stores/auth.store";

const auth = useAuthStore();
const sectionRef = ref<{ loadState?: (force?: boolean) => void } | null>(null);
const canEdit = computed(() => Boolean(auth.user?.isSuperAdmin));

function reloadPage() {
  void sectionRef.value?.loadState?.(true);
}
</script>

<style scoped>
.reserve-slots-page {
  display: grid;
  gap: 12px;
  min-height: 0;
  padding-bottom: 12px;
}

.reserve-shell {
  min-height: 0;
  display: grid;
}
</style>
