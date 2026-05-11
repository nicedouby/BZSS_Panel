<template>
  <aside class="sidebar">
    <div class="brand">
      <strong>BZSS</strong>
      <span>Vue Console</span>
    </div>
    <nav>
      <RouterLink v-for="item in nav" :key="item.path" :to="item.path">
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>
  </aside>
</template>

<script setup lang="ts">
const nav = [
  { path: "/match-status", label: "对局状态" },
  { path: "/console", label: "控制台" },
  { path: "/player-database", label: "玩家数据库" },
  { path: "/combat-clean", label: "战斗清洗" },
  { path: "/squad-manage", label: "小队管理" },
  { path: "/plugin-subscriptions", label: "插件订阅" },
];
</script>

<style scoped>
.sidebar {
  border-right: 1px solid #273039;
  background: #13181e;
  padding: 16px 12px;
}

.brand {
  padding: 10px 10px 18px;
}

.brand strong {
  display: block;
  font-size: 20px;
}

.brand span {
  color: #98a5af;
  font-size: 12px;
}

nav {
  display: grid;
  gap: 4px;
}

a {
  color: #dce4e8;
  text-decoration: none;
  padding: 10px;
  border-radius: 6px;
}

a.router-link-active {
  background: #20303a;
  color: #ffffff;
}

@media (max-width: 780px) {
  .sidebar {
    display: none;
  }
}
</style>
