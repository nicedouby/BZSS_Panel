import type { Router } from "vue-router";

export function goToPlayerDatabaseSearch(router: Router, query: string) {
  const value = String(query ?? "").trim();
  if (!value) return;
  router.push({ path: "/player-database", query: { q: value } });
}
