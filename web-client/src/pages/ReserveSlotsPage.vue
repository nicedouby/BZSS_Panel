<template>
  <section class="bz-page reserve-slots-page">
    <h1 class="sr-only">{{ t('routeTitle.reserveSlots') }}</h1>

    <div class="reserve-shell">
      <ReserveSlotsSection ref="sectionRef" :can-edit="canEdit" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { t } from "../i18n";
import ReserveSlotsSection from "../components/settings/ReserveSlotsSection.vue";
import { useAuthStore } from "../stores/auth.store";

const auth = useAuthStore();
const canEdit = computed(() => Boolean(auth.user?.isSuperAdmin));
</script>

<style scoped>
.reserve-slots-page {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  gap: 12px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.reserve-shell {
  height: 100%;
  min-height: 0;
  display: grid;
  overflow: hidden;
}
</style>

