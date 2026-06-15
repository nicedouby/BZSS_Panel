<template>
  <PageCard title="名单文件" description="这里只显示当前已加载的文件名，具体内容仍以联办目录中的文件为准。">
    <EmptyState v-if="!files.length" title="当前没有读取到名单文件。" compact />
    <ul v-else class="lianban-file-list">
      <li v-for="file in files" :key="file">{{ file }}</li>
    </ul>
  </PageCard>
</template>

<script setup lang="ts">
import PageCard from "../../common/PageCard.vue";
import EmptyState from "../../ui/EmptyState.vue";

defineProps<{
  files: string[];
}>();
</script>

<style scoped>
.lianban-file-list {
  margin: 0;
  padding-left: 18px;
}

.lianban-file-list li + li {
  margin-top: 8px;
}
</style>
