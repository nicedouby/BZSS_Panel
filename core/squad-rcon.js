// -*- coding: utf-8 -*-

/**
 * Core: SquadRcon
 *
 * Squad 专用 RCON。
 *
 * 继承自 MicePanel_better 的设计：
 * - 低层协议放在 core/rcon.js
 * - Squad 命令与事件解析放在这里
 */

import Rcon from "./rcon.js";
import { iterateIDs, capitalID, lowerID } from "./id-parser.js";

const GAME_START_EVENTS = ["GAME_START", "MATCH_START", "ROUND_START", "NEW_GAME"];
const GAME_END_EVENTS = ["GAME_END", "MATCH_END", "ROUND_END", "ROUND_ENDED"];

function nowString() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export default class SquadRcon extends Rcon {
  _processChatPacket(packet) {
    const time = nowString();
    const body = String(packet.body || "").trim();

    if (!body) return;

    const nativeIsTeamKill = isTeamKillMessage(body);

    this.emit("RCON_NATIVE_PUSH", {
      kind: "push",
      body,
      time,
      isTeamKill: nativeIsTeamKill,
      tags: nativeIsTeamKill ? ["tk"] : [],
    });

    const lifecycleType = detectLifecycleType(body);
    if (lifecycleType) {
      const payload = {
        raw: lifecycleType === "start" ? "GAME_START" : "GAME_END",
        sourceRaw: body,
        time,
      };

      const eventNames = lifecycleType === "start" ? GAME_START_EVENTS : GAME_END_EVENTS;
      for (const eventName of eventNames) {
        this.emit(eventName, payload);
      }
      return;
    }

    const matchTeamKill = body.match(/\[ChatAdmin\]\s+ASQKillDeathRuleset\s+:\s+Player\s+(?<killerName>.*?)\s+Team Killed Player\s+(?<victimName>.*)/i);
    if (matchTeamKill) {
      const killerName = matchTeamKill.groups?.killerName?.trim() || "";
      const victimName = matchTeamKill.groups?.victimName?.trim() || "";
      this.emit("TEAM_KILL", {
        raw: "TEAM_KILL",
        sourceRaw: body,
        killerName,
        victimName,
        tk1: killerName,
        tk2: victimName,
        time,
      });
      return;
    }

    const matchChat = body.match(/\[(ChatAll|ChatTeam|ChatSquad|ChatAdmin)\]\s*\[Online Ids:([^\]]+)\]\s*(.+?)\s*:\s*(.*)/i)
      || body.match(/\[(ChatAll|ChatTeam|ChatSquad|ChatAdmin)\]\s*(.+?)\s*:\s*(.*)/i);

    if (matchChat) {
      const hasIds = matchChat.length === 5;
      const result = {
        channel: matchChat[1],
        name: hasIds ? matchChat[3] : matchChat[2],
        message: hasIds ? matchChat[4] : matchChat[3],
        time,
      };

      if (hasIds) {
        iterateIDs(matchChat[2]).forEach((platform, id) => {
          result[lowerID(platform)] = id;
        });
      }

      this.emit("CHAT_MESSAGE", result);
      return;
    }

    const matchCamOn = body.match(/\[Online Ids:([^\]]+)\]\s*(.+) has possessed admin camera\./i);
    if (matchCamOn) {
      const result = { name: matchCamOn[2], time };
      iterateIDs(matchCamOn[1]).forEach((platform, id) => {
        result[lowerID(platform)] = id;
      });
      this.emit("POSSESSED_ADMIN_CAM", result);
      return;
    }

    const matchCamOff = body.match(/\[Online Ids:([^\]]+)\]\s*(.+) has unpossessed admin camera\./i);
    if (matchCamOff) {
      const result = { name: matchCamOff[2], time };
      iterateIDs(matchCamOff[1]).forEach((platform, id) => {
        result[lowerID(platform)] = id;
      });
      this.emit("UNPOSSESSED_ADMIN_CAM", result);
      return;
    }

    const matchSquadCreated = body.match(
      /(?<playerName>.+?) \(Online IDs: EOS: (?<eosID>\S+)\s+steam: (?<steamID>\S+)\) has created Squad (?<squadID>\d+)\s+\(Squad Name: (?<squadName>.+?)\) on (?<teamName>.+)/
    );
    if (matchSquadCreated) {
      const g = matchSquadCreated.groups;
      this.emit("SQUAD_CREATED", {
        playerName: g.playerName,
        eosID: g.eosID,
        steamID: g.steamID,
        squadID: Number(g.squadID),
        squadName: g.squadName,
        teamName: g.teamName,
        time,
      });
      return;
    }

  }

  /**
   * @returns {Promise<Array<object>>}
   */
  async getListPlayers() {
    const raw = await this.execute("ListPlayers");
    return parseListPlayers(raw);
  }

  /**
   * @returns {Promise<Array<object>>}
   */
  async getSquads() {
    const raw = await this.execute("ListSquads");
    return parseListSquads(raw);
  }

  async getCurrentMap() {
    const raw = await this.execute("ShowCurrentMap");
    return parseCurrentMap(raw);
  }

  async getNextMap() {
    const raw = await this.execute("ShowNextMap");
    return parseNextMap(raw);
  }

  broadcast(message) {
    return this.execute(`AdminBroadcast ${message}`);
  }

  kick(anyID, message) {
    return this.execute(`AdminKick "${anyID}" ${message}`);
  }

  ban(anyID, banLength, message) {
    return this.execute(`AdminBan "${anyID}" ${banLength} ${message}`);
  }

  switchTeam(anyID) {
    return this.execute(`AdminForceTeamChange "${anyID}"`);
  }
}

export function parseListPlayers(raw) {
  const active = [];
  const recentlyDisconnected = [];
  if (!raw) return attachListPlayersSections(active, recentlyDisconnected);

  let section = "active";

  for (const line of String(raw).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^-+\s*Active Players\s*-+$/i.test(trimmed)) {
      section = "active";
      continue;
    }
    if (/^-+\s*Recently Disconnected Players/i.test(trimmed)) {
      section = "recentlyDisconnected";
      continue;
    }

    const m = trimmed.match(
      /^ID: (?<playerID>\d+) \| Online IDs:([^|]+)\| Name: (?<name>.+) \| Team ID: (?<teamID>\d+|N\/A) \| Squad ID: (?<squadID>\d+|N\/A) \| Is Leader: (?<isLeader>True|False) \| Role: (?<role>.+)$/
    );
    if (!m) continue;

    const p = { ...m.groups };
    p.playerID = Number(p.playerID);
    p.name = String(p.name ?? "").trim();
    p.role = String(p.role ?? "").trim();
    p.isLeader = p.isLeader === "True";
    p.teamID = p.teamID !== "N/A" ? Number(p.teamID) : null;
    p.squadID = p.squadID !== "N/A" ? Number(p.squadID) : null;
    p.online = section !== "recentlyDisconnected";

    iterateIDs(m[2]).forEach((platform, id) => {
      p[lowerID(platform)] = id;
    });

    p.raw = trimmed;
    if (section === "recentlyDisconnected") {
      recentlyDisconnected.push(p);
    } else {
      active.push(p);
    }
  }

  return attachListPlayersSections(active, recentlyDisconnected);
}

function attachListPlayersSections(active, recentlyDisconnected) {
  Object.defineProperties(active, {
    active: {
      value: active,
      enumerable: false,
    },
    recentlyDisconnected: {
      value: recentlyDisconnected,
      enumerable: false,
    },
  });
  return active;
}

export function parseListSquads(raw) {
  const squads = [];
  if (!raw) return squads;

  let teamID = null;
  let teamName = null;

  for (const line of String(raw).split("\n")) {
    const trimmed = line.trim();
    const mTeam = trimmed.match(/Team ID: (\d+) \((.+)\)/);
    if (mTeam) {
      teamID = Number(mTeam[1]);
      teamName = mTeam[2];
      continue;
    }

    const m = trimmed.match(
      /ID: (?<squadID>\d+) \| Name: (?<squadName>.+) \| Size: (?<size>\d+) \| Locked: (?<locked>True|False) \| Creator Name: (?<creatorName>.+) \| Creator Online IDs:([^|]+)/
    );
    if (!m) continue;

    const squad = {
      ...m.groups,
      squadID: Number(m.groups.squadID),
      locked: m.groups.locked === "True",
      size: Number(m.groups.size),
      teamID,
      teamName,
      raw: trimmed,
    };

    iterateIDs(m[6]).forEach((platform, id) => {
      squad["creator" + capitalID(platform)] = id;
    });

    squads.push(squad);
  }

  return squads;
}

export function parseCurrentMap(raw) {
  const text = String(raw ?? "").trim();
  const m = text.match(/^Current level is ([^,]*), layer is ([^,]*)/i);
  return m ? { level: cleanMapValue(m[1]), layer: cleanMapValue(m[2]) } : { level: null, layer: null };
}

export function parseNextMap(raw) {
  const text = String(raw ?? "").trim();
  const json = parseMapJson(text);
  if (json) {
    return {
      level: json.level,
      layer: json.layer && json.layer !== "To be voted" ? json.layer : null,
    };
  }

  const m = text.match(/^Next level is ([^,]*), layer is ([^,]*)/i)
    || text.match(/^Next map is ([^,]*), layer is ([^,]*)/i)
    || text.match(/^Next layer is ([^,]*), level is ([^,]*)/i);
  return {
    level: m && cleanMapValue(m[1]) ? cleanMapValue(m[1]) : null,
    layer: m && cleanMapValue(m[2]) && cleanMapValue(m[2]) !== "To be voted" ? cleanMapValue(m[2]) : null,
  };
}

function parseMapJson(text) {
  if (!text.startsWith("{") || !text.endsWith("}")) return null;

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    return {
      level: cleanMapValue(
        parsed.NextLevel_s
        ?? parsed.LevelName_s
        ?? parsed.Level_s
        ?? parsed.MapName_s
        ?? parsed.Map
        ?? parsed.level
        ?? parsed.map
      ),
      layer: cleanMapValue(
        parsed.NextLayer_s
        ?? parsed.Layer_s
        ?? parsed.LayerName_s
        ?? parsed.layer
      ),
    };
  } catch {
    return null;
  }
}

function cleanMapValue(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function detectLifecycleType(rawBody) {
  const body = String(rawBody || "").trim();
  if (!body) return null;

  const normalized = body.toLowerCase();

  const startMarkers = [
    "match has started",
    "round has started",
    "game has started",
    "new game",
    "round start",
    "match start",
    "game start",
    "对局开始",
    "回合开始",
  ];

  const endMarkers = [
    "match has ended",
    "round has ended",
    "game has ended",
    "round ended",
    "match ended",
    "game ended",
    "won the match",
    "对局结束",
    "回合结束",
  ];

  if (containsAnyMarker(normalized, startMarkers)) return "start";
  if (containsAnyMarker(normalized, endMarkers)) return "end";
  return null;
}

function containsAnyMarker(text, markers) {
  for (const marker of markers) {
    if (text.includes(marker)) return true;
  }
  return false;
}

function isTeamKillMessage(value) {
  return /\[ChatAdmin]\s+ASQKillDeathRuleset\s+:\s+Player\s+.*?\s+Team Killed Player\s+/i.test(String(value ?? ""));
}
