// -*- coding: utf-8 -*-

export const AUDIT_ACTIONS = Object.freeze({
  PLAYTIME_REFRESH_SMART: "playtime.refresh.smart",
  PLAYTIME_REFRESH_FORCE: "playtime.refresh.force",
  PLAYER_SWITCH_TEAM: "player.switch_team",
  PLAYER_WARN: "player.warn",
  PLAYER_REMOVE_FROM_SQUAD: "player.remove_from_squad",
  SERVER_BROADCAST: "server.broadcast",
  TANK_BATTLE_EXECUTE: "tank_battle.execute",
  RCON_COMMAND_EXECUTE: "rcon.command.execute",
});

export const AUDIT_CATEGORIES = Object.freeze({
  PLAYTIME: "playtime",
  PLAYER_MANAGEMENT: "player_management",
  SERVER_MANAGEMENT: "server_management",
  RCON: "rcon",
});

export const AUDIT_RESULTS = Object.freeze({
  SUCCESS: "success",
  FAILED: "failed",
  PARTIAL: "partial",
  FORBIDDEN: "forbidden",
  INVALID: "invalid",
  ACCEPTED: "accepted",
  RUNNING: "running",
  CANCELLED: "cancelled",
});

export const AUDIT_SOURCE_PAGES = Object.freeze({
  MATCH_STATUS: "match_status",
  SQUAD_MANAGEMENT: "squad_management",
  PLAYTIME_MANAGEMENT: "playtime_management",
  TANK_BATTLE_DIALOG: "tank_battle_dialog",
  RCON_CONSOLE: "rcon_console",
  PERMISSION_MANAGEMENT: "permission_management",
  RESERVE_SLOT_MANAGEMENT: "reserve_slot_management",
});
