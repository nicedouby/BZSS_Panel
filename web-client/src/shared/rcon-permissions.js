// -*- coding: utf-8 -*-

const COMMAND_PERMISSION_ALIASES = new Map([
  ["tb", "rcon.tb"],
  ["adminbroadcast", "rcon.broadcast"],
  ["adminwarn", "rcon.warn"],
  ["adminkick", "rcon.kick"],
  ["adminforceteamchange", "rcon.tb"],
  ["admindisbandsquad", "rcon.disband"],
  ["adminkickfromsquad", "rcon.remove"],
]);

const PERMISSION_ALIASES = new Map([
  ["squad.switch", ["rcon.tb"]],
  ["squad.kick", ["rcon.kick"]],
  ["squad.remove", ["rcon.remove"]],
  ["squad.disband", ["rcon.disband"]],
  ["warning.send", ["rcon.warn"]],
  ["server.broadcast", ["rcon.broadcast"]],
]);

export const ALLOWED_MANUAL_RCON_PERMISSIONS = Object.freeze([
  "rcon.tb",
  "rcon.warn",
  "rcon.broadcast",
  "rcon.kick",
  "rcon.disband",
  "rcon.remove",
]);

export function normalizeRconCommandName(commandText) {
  const raw = String(commandText ?? "").trim();
  if (!raw) return "";

  const firstToken = raw.split(/\s+/, 1)[0] ?? "";
  return firstToken.trim().toLowerCase();
}

export function resolveRconPermission(commandText, options = {}) {
  const explicit = normalizePermissionName(
    options.requiredPermission
      ?? options.permission
      ?? options.permissionKey
      ?? options.rconPermission
      ?? options.commandPermission,
  );
  if (explicit) return explicit;

  const normalizedName = normalizeRconCommandName(commandText);
  if (!normalizedName) return "";

  const alias = COMMAND_PERMISSION_ALIASES.get(normalizedName);
  return alias ?? "";
}

export function canSendRconCommand(user, commandText, options = {}) {
  if (!user) return false;
  if (Boolean(user.isSuperAdmin)) return true;

  const permissions = normalizePermissionList(user.permissions ?? user.permission);
  if (permissions.includes("*")) return true;

  const requiredPermission = resolveRconPermission(commandText, options);
  if (!requiredPermission) return false;
  if (!ALLOWED_MANUAL_RCON_PERMISSIONS.includes(requiredPermission)) return false;

  return hasPermission(permissions, requiredPermission);
}

export function hasPermission(permissions, wanted) {
  const normalizedPermissions = normalizePermissionList(permissions);
  const required = normalizePermissionName(wanted);
  if (!required) return true;

  if (normalizedPermissions.includes("*")) return true;
  if (normalizedPermissions.includes(required)) return true;
  for (const alias of PERMISSION_ALIASES.get(required) ?? []) {
    if (normalizedPermissions.includes(alias)) return true;
    const [aliasNamespace] = alias.split(".");
    if (aliasNamespace && normalizedPermissions.includes(`${aliasNamespace}.*`)) return true;
  }

  const [namespace] = required.split(".");
  if (namespace && normalizedPermissions.includes(`${namespace}.*`)) return true;

  return false;
}

export function normalizePermissionList(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => normalizePermissionName(item))
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => normalizePermissionName(item))
      .filter(Boolean);
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => normalizePermissionName(key))
      .filter(Boolean);
  }

  return [];
}

function normalizePermissionName(value) {
  return String(value ?? "").trim();
}
