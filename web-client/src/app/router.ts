import { createRouter, createWebHistory, type RouteLocationNormalized } from "vue-router";

import ComingSoonPage from "../pages/ComingSoonPage.vue";
import { useAuthStore } from "../stores/auth.store";
import {
  canAccessPage,
  normalizePermissionList,
} from "../shared/web-page-permissions.js";
import { buildPageRoutes } from "./pageRegistry";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/match-status" },
    {
      path: "/system/logpost-diagnostics",
      name: "logpost-diagnostics",
      component: () => import("../pages/LogPostDiagnosticsPage.vue"),
      meta: {
        title: "LogPost 摄取诊断",
        refreshPolicy: "manual",
        layoutMode: "workspace",
        contentPadding: "none",
        superAdminOnly: true,
      },
    },
    {
      path: "/system/logpost-consumption-performance",
      name: "logpost-consumption-performance",
      component: () => import("../pages/LogPostConsumptionPerformancePage.vue"),
      meta: {
        title: "LogPost 消费性能评估",
        refreshPolicy: "polling",
        layoutMode: "workspace",
        contentPadding: "none",
        superAdminOnly: true,
      },
    },
    {
      path: "/tactical-replay",
      name: "tactical-replay",
      component: () => import("../pages/TacticalReplayPage.vue"),
      meta: {
        title: "战术回放工作台",
        refreshPolicy: "manual",
        layoutMode: "workspace",
        contentPadding: "none",
      },
    },
    {
      path: "/tactical-replay/player/:sessionId",
      name: "tactical-replay-player",
      component: () => import("../pages/TacticalReplayPage.vue"),
      meta: {
        title: "战术回放播放器",
        refreshPolicy: "manual",
        layoutMode: "workspace",
        contentPadding: "none",
      },
    },
    {
      path: "/plugins/round-playtime-roster-warning",
      name: "round-playtime-roster-warning",
      component: () => import("../pages/RoundPlaytimeRosterWarningPage.vue"),
      meta: {
        title: "开局时长提醒",
        refreshPolicy: "polling",
        layoutMode: "workspace",
        contentPadding: "none",
        pagePreset: "simple-plugin",
        superAdminOnly: true,
      },
    },
    {
      path: "/plugins/steam-playtime-publicity-reminder",
      name: "steam-playtime-publicity-reminder",
      component: () => import("../pages/SteamPlaytimePublicityReminderPage.vue"),
      meta: {
        title: "督促时长公开",
        refreshPolicy: "polling",
        layoutMode: "workspace",
        contentPadding: "none",
        pagePreset: "simple-plugin",
        superAdminOnly: true,
      },
    },
    ...buildPageRoutes(),
    {
      path: "/combat-clean",
      redirect: (to) => ({ name: "combat-manager", query: to.query, hash: to.hash }),
    },
    {
      path: "/access-denied",
      component: ComingSoonPage,
      props: {
        title: "Access denied",
        subtitle: "权限不足",
        message: "当前登录账号没有访问该页面所需的模块权限，请联系管理员分配对应权限后再试。",
      },
      meta: { title: "Access denied", layoutMode: "document", contentPadding: "default" },
    },
    {
      path: "/:pathMatch(.*)*",
      component: ComingSoonPage,
      props: {
        titleKey: "routeTitle.comingSoon",
        subtitle: "",
        message: "",
      },
      meta: {
        titleKey: "routeTitle.comingSoon",
        layoutMode: "document",
        contentPadding: "default",
      },
    },
  ],
});

let authAccessSubscriptionAttached = false;

router.beforeEach((to) => {
  const auth = useAuthStore();
  attachAuthAccessSubscription(auth);

  if (!auth.checked) {
    // Do not serialize initial route chunk loading behind the session request.
    // App.vue keeps the protected surface hidden until the check completes.
    void auth.restoreSession().then(() => enforceCurrentRouteAccess(auth));
    return true;
  }

  return resolveAccessRedirect(to, auth) ?? true;
});

function attachAuthAccessSubscription(auth: ReturnType<typeof useAuthStore>) {
  if (authAccessSubscriptionAttached) return;
  authAccessSubscriptionAttached = true;
  auth.$subscribe(() => {
    if (!auth.checked || (auth.authenticated && !auth.user)) return;
    enforceCurrentRouteAccess(auth);
  }, { detached: true });
}

function enforceCurrentRouteAccess(auth: ReturnType<typeof useAuthStore>) {
  const current = router.currentRoute.value;
  const redirect = resolveAccessRedirect(current, auth);
  if (!redirect || current.path === redirect.path) return;
  void router.replace(redirect);
}

function resolveAccessRedirect(
  to: RouteLocationNormalized,
  auth: ReturnType<typeof useAuthStore>,
): { path: string } | null {
  if (to.path === "/access-denied" || !auth.authenticated || !auth.user) return null;

  if (to.meta?.superAdminOnly) {
    return auth.user.isSuperAdmin ? null : { path: "/access-denied" };
  }

  const requiredPermission = String(to.meta?.requiredPermission ?? "").trim();
  if (!requiredPermission) return null;

  const authUser = auth.user as {
    permissions?: unknown;
    permission?: unknown;
    isSuperAdmin?: boolean;
  };
  const permissions = normalizePermissionList(authUser.permissions ?? authUser.permission);
  const legacyPermissions = normalizePermissionList(to.meta?.legacyRequiredPermissions);
  const allowed = canAccessPage(authUser, requiredPermission, legacyPermissions, {
    superAdminOnly: Boolean(to.meta?.superAdminOnly),
  });

  if (allowed) {
    if (!permissions.includes(requiredPermission) && legacyPermissions.some((permission) => permissions.includes(permission))) {
      console.warn(`[router] Deprecated permission fallback used for ${String(to.fullPath ?? to.path)}: ${legacyPermissions.join(", ")}`);
    }
    return null;
  }

  return { path: "/access-denied" };
}
