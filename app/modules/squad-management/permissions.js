// -*- coding: utf-8 -*-

import { hasPermission } from "../../../web-client/src/shared/rcon-permissions.js";

export function canDisband(viewer, config = {}) {
  const permissions = viewer?.permissions ?? viewer?.permission;
  return Boolean(
    viewer?.isSuperAdmin
    || hasPermission(permissions, config.disbandPermission || "squad.disband")
  );
}

export function canKick(viewer, config = {}) {
  const permissions = viewer?.permissions ?? viewer?.permission;
  return Boolean(
    viewer?.isSuperAdmin
    || hasPermission(permissions, config.kickPermission || "squad.kick")
  );
}

export function canRemove(viewer, config = {}) {
  const permissions = viewer?.permissions ?? viewer?.permission;
  return Boolean(
    viewer?.isSuperAdmin
    || hasPermission(permissions, config.removePermission || "squad.remove")
  );
}
