<template>
  <section class="bz-page reserve-slots-page">
    <PageHeader
      :title="t('routeTitle.reserveSlots')"
    />

    <div class="reserve-shell">
      <ReserveSlotsSection ref="sectionRef" :can-edit="canEdit" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { t } from "../i18n";
import PageHeader from "../components/common/PageHeader.vue";
import ReserveSlotsSection from "../components/settings/ReserveSlotsSection.vue";
import { useAuthStore } from "../stores/auth.store";

const auth = useAuthStore();
const canEdit = computed(() => Boolean(auth.user?.isSuperAdmin));
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
