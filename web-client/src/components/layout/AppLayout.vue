<template>
  <div class="app-shell">
    <Sidebar />
    <main class="main-shell">
      <Topbar />
      <section class="content-shell">
        <RouterView />
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { RouterView } from "vue-router";
import Topbar from "./Topbar.vue";
import Sidebar from "./Sidebar.vue";
</script>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  background: #101317;
}

.main-shell {
  min-width: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.content-shell {
  padding: 18px;
  min-width: 0;
}

@media (max-width: 780px) {
  .app-shell {
    grid-template-columns: 1fr;
  }
}
</style>
