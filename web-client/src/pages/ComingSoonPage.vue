<template>
  <section class="page">
    <PageHeader :title="title" :subtitle="subtitle" />
    <PageCard>
      <DataState
        :empty="true"
        empty-title="Coming soon"
        :empty-text="message"
      />
    </PageCard>
  </section>
</template>

<script setup lang="ts">
import PageHeader from "../components/common/PageHeader.vue";
import PageCard from "../components/common/PageCard.vue";
import DataState from "../components/common/DataState.vue";

withDefaults(defineProps<{
  title?: string;
  subtitle?: string;
  message?: string;
}>(), {
  title: "Coming Soon",
  subtitle: "This Vue page has not been migrated yet.",
  message: "The page is reserved in the new client but not implemented yet.",
});
</script>
