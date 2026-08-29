<template>
  <section
    class="page-card"
    :class="[
      `page-card--overflow-${overflow}`,
      `page-card--body-${bodyMode}`,
      `page-card--tone-${tone}`,
      `page-card--padding-${padding}`,
    ]"
  >
    <header v-if="$slots.header || title || $slots.actions" class="card-header">
      <div class="card-title-block">
        <slot name="header">
          <h2 v-if="title" class="card-title">{{ title }}</h2>
          <p v-if="description" class="card-description">{{ description }}</p>
        </slot>
      </div>
      <div v-if="$slots.actions" class="card-actions">
        <slot name="actions" />
      </div>
    </header>
    <div class="card-body" :class="{ compact }">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="card-footer">
      <slot name="footer" />
    </footer>
  </section>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  title?: string;
  description?: string;
  compact?: boolean;
  overflow?: "visible" | "clip" | "auto";
  bodyMode?: "normal" | "fill" | "scroll";
  tone?: "default" | "info" | "warning" | "danger";
  padding?: "none" | "sm" | "md";
}>(), {
  title: "",
  description: "",
  compact: false,
  overflow: "visible",
  bodyMode: "normal",
  tone: "default",
  padding: "md",
});
</script>

<style scoped>
.page-card {
  border: 1px solid var(--color-border-default);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, calc(var(--panel-surface-alpha) + 0.016)), rgba(255, 255, 255, 0.006)),
    var(--color-bg-card);
  border-radius: 18px;
  box-shadow: var(--shadow-md);
  backdrop-filter: blur(12px);
}

.page-card--body-fill,
.page-card--body-scroll {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-height: 0;
  height: 100%;
}

.page-card--tone-info {
  border-color: color-mix(in srgb, var(--color-status-info) 24%, var(--color-border-default));
}

.page-card--tone-warning {
  border-color: color-mix(in srgb, var(--color-status-warning) 24%, var(--color-border-default));
}

.page-card--tone-danger {
  border-color: color-mix(in srgb, var(--color-status-danger, var(--color-status-error)) 24%, var(--color-border-default));
}

.page-card--overflow-visible {
  overflow: visible;
}

.page-card--overflow-clip {
  overflow: hidden;
}

.page-card--overflow-auto {
  overflow: auto;
}

.card-header {
  padding: 16px 18px 0;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.card-title-block {
  min-width: 0;
}

.card-title {
  margin: 0;
  font-size: 16px;
  line-height: 1.3;
}

.card-description {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--color-text-muted);
  line-height: 1.5;
}

.card-actions {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.card-body {
  padding: 18px;
  min-width: 0;
  min-height: 0;
}

.card-body.compact {
  padding: 14px 16px;
}

.page-card--padding-none > .card-body {
  padding: 0;
}

.page-card--padding-sm > .card-body {
  padding: 14px 16px;
}

.page-card--padding-md > .card-body {
  padding: 18px;
}

.page-card--body-fill > .card-body {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
}

.page-card--body-scroll > .card-body {
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.card-footer {
  padding: 0 18px 18px;
}

@media (max-width: 640px) {
  .page-card {
    border-radius: 13px;
  }

  .card-header {
    align-items: stretch;
    flex-direction: column;
    padding: 13px 13px 0;
  }

  .card-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .card-actions :deep(input),
  .card-actions :deep(select),
  .card-actions :deep(textarea) {
    width: 100%;
  }

  .card-body,
  .card-body.compact,
  .page-card--padding-sm > .card-body,
  .page-card--padding-md > .card-body {
    padding: 13px;
  }

  .page-card--padding-none > .card-body {
    padding: 0;
  }

  .card-footer {
    padding: 0 13px 13px;
  }
}
</style>
