<template>
  <section class="page">
    <PageHeader :title="resolvedTitle" :subtitle="resolvedSubtitle" />
    <PageCard>
      <DataState
        :empty="true"
        :empty-title="t('comingSoon.title')"
        :empty-text="resolvedMessage"
      />
    </PageCard>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import DataState from "../components/common/DataState.vue";
import { t } from "../i18n";

const props = withDefaults(defineProps<{
  title?: string;
  subtitle?: string;
  message?: string;
  titleKey?: string;
  subtitleKey?: string;
  messageKey?: string;
}>(), {
  title: "",
  subtitle: "",
  message: "",
  titleKey: "comingSoon.title",
  subtitleKey: "comingSoon.subtitle",
  messageKey: "comingSoon.message",
});

const resolvedTitle = computed(() => t(props.titleKey, props.title || t("comingSoon.title")));
const resolvedSubtitle = computed(() => t(props.subtitleKey, props.subtitle || t("comingSoon.subtitle")));
const resolvedMessage = computed(() => t(props.messageKey, props.message || t("comingSoon.message")));
</script>
