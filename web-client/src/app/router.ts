import { createRouter, createWebHistory } from "vue-router";

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

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.checked) await auth.restoreSession();

  if (to.meta?.superAdminOnly) {
    if (!auth.authenticated) return true;
    return auth.user?.isSuperAdmin ? true : { path: "/access-denied" };
  }

  const requiredPermission = String(to.meta?.requiredPermission ?? "").trim();
  if (!requiredPermission) return true;

  const authUser = auth.user as { permissions?: unknown; permission?: unknown; isSuperAdmin?: boolean } | null | undefined;
  const permissions = normalizePermissionList(authUser?.permissions ?? authUser?.permission);
  const legacyPermissions = normalizePermissionList(to.meta?.legacyRequiredPermissions);
  const allowed = canAccessPage(authUser, requiredPermission, legacyPermissions, {
    superAdminOnly: Boolean(to.meta?.superAdminOnly),
  });

  if (allowed) {
    if (!permissions.includes(requiredPermission) && legacyPermissions.some((permission) => permissions.includes(permission))) {
      console.warn(`[router] Deprecated permission fallback used for ${String(to.fullPath ?? to.path)}: ${legacyPermissions.join(", ")}`);
    }
    return true;
  }

  return { path: "/access-denied" };
});
