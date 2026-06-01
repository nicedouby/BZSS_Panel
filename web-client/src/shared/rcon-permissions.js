// -*- coding: utf-8 -*-

const COMMAND_PERMISSION_ALIASES = new Map([
  ["tb", "rcon.tb"],
  ["adminbroadcast", "rcon.broadcast"],
  ["adminwarn", "rcon.warn"],
  ["adminkick", "rcon.kick"],
  ["adminban", "rcon.ban"],
  ["adminforceteamchange", "rcon.tb"],
  ["admindisbandsquad", "rcon.disband_squad"],
  ["adminkickfromsquad", "rcon.kick_squad"],
  ["listplayers", "rcon.read"],
  ["listsquads", "rcon.read"],
  ["showcurrentmap", "rcon.read"],
  ["shownextmap", "rcon.read"],
  ["showserverinfo", "rcon.read"],
  ["adminnorespawntimer", "rcon.tank_battle"],
  ["adminforceallvehicleavailability", "rcon.tank_battle"],
  ["adminforceallroleavailability", "rcon.tank_battle"],
  ["admindisablevehiclekitrequirement", "rcon.tank_battle"],
  ["admindisablevehicleclaiming", "rcon.tank_battle"],
  ["adminforcealldeployableavailability", "rcon.tank_battle"],
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
  if (!normalizedName) return "rcon.command";

  const alias = COMMAND_PERMISSION_ALIASES.get(normalizedName);
  if (alias) return alias;

  return `rcon.${toPermissionSegment(normalizedName)}`;
}

export function canSendRconCommand(user, commandText, options = {}) {
  if (!user) return false;
  if (Boolean(user.isSuperAdmin)) return true;

  const permissions = normalizePermissionList(user.permissions ?? user.permission);
  if (permissions.includes("*")) return true;

  const requiredPermission = resolveRconPermission(commandText, options);
  if (!requiredPermission) return false;

  return hasPermission(permissions, requiredPermission);
}

export function hasPermission(permissions, wanted) {
  const normalizedPermissions = normalizePermissionList(permissions);
  const required = normalizePermissionName(wanted);
  if (!required) return true;

  if (normalizedPermissions.includes("*")) return true;
  if (normalizedPermissions.includes(required)) return true;

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

function toPermissionSegment(value) {
  const text = String(value ?? "").trim();
  if (!text) return "command";

  const snake = text
    .replace(/([a-z\d])([A-Z])/g, "$1_$2")
    .replace(/[^a-z\d]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

  return snake || "command";
}
