// -*- coding: utf-8 -*-

export const WEB_PAGE_PERMISSION_MATRIX = Object.freeze([
  { route: "/match-status", requiredPermission: "match_state.view" },
  { route: "/match-state", requiredPermission: "match_state.view" },
  { route: "/console", requiredPermission: "console.view", superAdminOnly: true },
  { route: "/chat-monitor", requiredPermission: "chat_monitor.view" },
  { route: "/match/squad-creation-order", requiredPermission: "squad_management.view" },
  { route: "/player-session-records", requiredPermission: "player_session_records.view" },
  { route: "/player-database", requiredPermission: "player_database.view" },
  { route: "/reserve-slots", requiredPermission: "player_database.view" },
  { route: "/combat-manager", requiredPermission: "combat_manager.view", legacyRequiredPermissions: ["kill_manager.view"] },
  { route: "/kill-manage", requiredPermission: "combat_manager.view", legacyRequiredPermissions: ["kill_manager.view"] },
  { route: "/combat-clean", requiredPermission: "combat_manager.view", legacyRequiredPermissions: ["kill_manager.view"] },
  { route: "/combat-log", requiredPermission: "combat_manager.view", legacyRequiredPermissions: ["kill_manager.view"] },
  { route: "/combat-log/query", requiredPermission: "combat_manager.view", legacyRequiredPermissions: ["kill_manager.view"] },
  { route: "/battle-log", requiredPermission: "combat_manager.view", legacyRequiredPermissions: ["kill_manager.view"] },
  { route: "/admin-warns", requiredPermission: "admin_warn.view" },
  { route: "/scheduled-broadcasts", requiredPermission: "scheduled_broadcast.view" },
  { route: "/squad-management", requiredPermission: "squad_management.view" },
  { route: "/squad-rule-chain", requiredPermission: "squad_management.view", legacyRequiredPermissions: ["debug.squad_name_policy.view"] },
  { route: "/squad-rule-chain/squad-name", requiredPermission: "squad_management.view", legacyRequiredPermissions: ["debug.squad_name_policy.view"] },
  { route: "/squad-rule-chain/stepwise", requiredPermission: "squad_management.view" },
  { route: "/squad-rule-chain/fair", requiredPermission: "squad_management.view" },
  { route: "/plugin-subscriptions", requiredPermission: "settings.manage" },
  { route: "/plugins/group-report", requiredPermission: "group_report.view" },
  { route: "/plugins/tactical-report", requiredPermission: "plugin:tactical-report:view" },
  { route: "/plugins/tactical-report/config", requiredPermission: "plugin:tactical-report:update" },
  { route: "/plugins/tactical-report/logs", requiredPermission: "plugin:tactical-report:logs" },
  { route: "/plugins/tactical-report/user-codes", requiredPermission: "plugin:tactical-report:user-codes" },
  { route: "/plugins/panel-ban", requiredPermission: "plugin:panel-ban:view" },
  { route: "/plugins/server-info-statistics", requiredPermission: "server_stats.view" },
  { route: "/weapon-collector", requiredPermission: "combat_manager.view", legacyRequiredPermissions: ["kill_manager.view"] },
  { route: "/debug/udp-forwarder", requiredPermission: "debug.udp_forwarder.view" },
  { route: "/debug/match-snapshots", requiredPermission: "debug.match_snapshots.view" },
  { route: "/match-end-snapshots", requiredPermission: "debug.match_snapshots.view" },
  { route: "/debug/pjsc-average-duration", requiredPermission: "debug.pjsc_average_duration.view" },
  { route: "/debug/draw-vote-guard", requiredPermission: "debug.draw_vote_guard.view" },
  { route: "/debug/welcome-join-warning", requiredPermission: "debug.welcome_join_warning.view" },
  { route: "/debug/squad-name-policy", requiredPermission: "debug.squad_name_policy.view" },
  { route: "/debug/squad-name-tracking", requiredPermission: "squad_management.view" },
  { route: "/debug/squad-name-policy/rules", requiredPermission: "squad_management.view", legacyRequiredPermissions: ["debug.squad_name_policy.view"] },
  { route: "/plugins/stepwise-squad-playtime-guard", requiredPermission: "squad_management.view" },
  { route: "/plugins/fair-squad-guard", requiredPermission: "squad_management.view" },
  { route: "/system/status", requiredPermission: "settings.manage" },
  { route: "/system/logpost", requiredPermission: "settings.manage", superAdminOnly: true },
  { route: "/system/admin-users", requiredPermission: "admin_users.manage", superAdminOnly: true },
  { route: "/system/audit-records", requiredPermission: "audit.view" },
]);

const WEB_PAGE_PERMISSION_MAP = new Map(
  WEB_PAGE_PERMISSION_MATRIX.map((entry) => {
    const route = normalizeRoute(entry.route);
    return [
      route,
      {
        route,
        requiredPermission: String(entry.requiredPermission ?? "").trim(),
        legacyRequiredPermissions: normalizePermissionList(entry.legacyRequiredPermissions),
        superAdminOnly: Boolean(entry.superAdminOnly),
      },
    ];
  }),
);

export function normalizeRoute(route) {
  const raw = String(route ?? "").trim();
  if (!raw) return "/";

  const withoutHash = raw.replace(/^#+/, "");
  let pathnameOnly = withoutHash;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(withoutHash)) {
    try {
      pathnameOnly = new URL(withoutHash).pathname || "/";
    } catch {
      pathnameOnly = withoutHash;
    }
  }

  const withoutQueryOrHash = pathnameOnly.split(/[?#]/, 1)[0];
  if (!withoutQueryOrHash) return "/";

  const withLeadingSlash = withoutQueryOrHash.startsWith("/") ? withoutQueryOrHash : `/${withoutQueryOrHash}`;
  const compacted = withLeadingSlash.replace(/\/{2,}/g, "/");
  if (compacted.length > 1 && compacted.endsWith("/")) {
    return compacted.slice(0, -1);
  }

  return compacted;
}

export function normalizePermissionList(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => String(key).trim())
      .filter(Boolean);
  }

  return [];
}

export function hasPermission(permissions, wanted) {
  const normalizedPermissions = normalizePermissionList(permissions);
  const required = String(wanted ?? "").trim();
  if (!required) return true;

  if (normalizedPermissions.includes("*")) return true;
  if (normalizedPermissions.includes(required)) return true;

  const [namespace] = required.split(".");
  if (namespace && normalizedPermissions.includes(`${namespace}.*`)) return true;

  return false;
}

export function canAccessPage(user, requiredPermission, legacyRequiredPermissions = [], options = {}) {
  const superAdminOnly = Boolean(options?.superAdminOnly);
  if (superAdminOnly) return Boolean(user?.isSuperAdmin);

  const required = String(requiredPermission ?? "").trim();
  if (!required) return true;

  if (Boolean(user?.isSuperAdmin)) return true;

  const permissions = normalizePermissionList(user?.permissions ?? user?.permission);
  if (permissions.includes("*")) return true;
  if (hasPermission(permissions, required)) return true;

  const legacyPermissions = normalizePermissionList(legacyRequiredPermissions);
  return legacyPermissions.some((permission) => hasPermission(permissions, permission));
}

export function resolveWebPagePermission(route) {
  return WEB_PAGE_PERMISSION_MAP.get(normalizeRoute(route)) ?? null;
}
