// -*- coding: utf-8 -*-

export function canDisband(viewer, config = {}) {
  return Boolean(
    viewer?.isSuperAdmin
    || viewer?.permissions?.includes?.(config.disbandPermission)
  );
}

export function canKick(viewer, config = {}) {
  return Boolean(
    viewer?.isSuperAdmin
    || viewer?.permissions?.includes?.(config.kickPermission)
  );
}

export function canRemove(viewer, config = {}) {
  return Boolean(
    viewer?.isSuperAdmin
    || viewer?.permissions?.includes?.(config.removePermission || "squad.remove")
  );
}

