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
    const body = packet.body;

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

    const matchChat = body.match(/\[(ChatAll|ChatTeam|ChatSquad|ChatAdmin)] \[Online IDs:([^\]]+)] (.+?) : (.*)/);
    if (matchChat) {
      const result = {
        channel: matchChat[1],
        name: matchChat[3],
        message: matchChat[4],
        time,
      };

      iterateIDs(matchChat[2]).forEach((platform, id) => {
        result[lowerID(platform)] = id;
      });

      this.emit("CHAT_MESSAGE", result);
      return;
    }

    const matchCamOn = body.match(/\[Online Ids:([^\]]+)] (.+) has possessed admin camera\./);
    if (matchCamOn) {
      const result = { name: matchCamOn[2], time };
      iterateIDs(matchCamOn[1]).forEach((platform, id) => {
        result[lowerID(platform)] = id;
      });
      this.emit("POSSESSED_ADMIN_CAM", result);
      return;
    }

    const matchCamOff = body.match(/\[Online IDs:([^\]]+)] (.+) has unpossessed admin camera\./);
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

    const matchTeamKill = body.match(/\[ChatAdmin] ASQKillDeathRuleset : Player (?<killerName>.*?) Team Killed Player (?<victimName>.*)/);
    if (matchTeamKill) {
      this.emit("TEAM_KILL", {
        raw: "TEAM_KILL",
        killerName: matchTeamKill.groups?.killerName?.trim() || "",
        victimName: matchTeamKill.groups?.victimName?.trim() || "",
        tk1: matchTeamKill.groups?.killerName?.trim() || "",
        tk2: matchTeamKill.groups?.victimName?.trim() || "",
        time,
      });
    }
  }

  /**
   * @returns {Promise<Array<object>>}
   */
  async getListPlayers() {
    const raw = await this.execute("ListPlayers");
    const players = [];
    if (!raw) return players;

    for (const line of raw.split("\n")) {
      const m = line.match(
        /^ID: (?<playerID>\d+) \| Online IDs:([^|]+)\| Name: (?<name>.+) \| Team ID: (?<teamID>\d+|N\/A) \| Squad ID: (?<squadID>\d+|N\/A) \| Is Leader: (?<isLeader>True|False) \| Role: (?<role>.+)$/
      );
      if (!m) continue;

      const p = { ...m.groups };
      p.playerID = Number(p.playerID);
      p.isLeader = p.isLeader === "True";
      p.teamID = p.teamID !== "N/A" ? Number(p.teamID) : null;
      p.squadID = p.squadID !== "N/A" ? Number(p.squadID) : null;

      iterateIDs(m[2]).forEach((platform, id) => {
        p[lowerID(platform)] = id;
      });

      p.raw = line;
      players.push(p);
    }

    return players;
  }

  /**
   * @returns {Promise<Array<object>>}
   */
  async getSquads() {
    const raw = await this.execute("ListSquads");
    const squads = [];
    if (!raw) return squads;

    let teamID = null;
    let teamName = null;

    for (const line of raw.split("\n")) {
      const mTeam = line.match(/Team ID: (\d) \((.+)\)/);
      if (mTeam) {
        teamID = Number(mTeam[1]);
        teamName = mTeam[2];
        continue;
      }

      const m = line.match(
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
        raw: line,
      };

      iterateIDs(m[6]).forEach((platform, id) => {
        squad["creator" + capitalID(platform)] = id;
      });

      squads.push(squad);
    }

    return squads;
  }

  async getCurrentMap() {
    const raw = await this.execute("ShowCurrentMap");
    const m = raw.match(/^Current level is ([^,]*), layer is ([^,]*)/);
    return m ? { level: m[1].trim(), layer: m[2].trim() } : { level: null, layer: null };
  }

  async getNextMap() {
    const raw = await this.execute("ShowNextMap");
    const m = raw.match(/^Next level is ([^,]*), layer is ([^,]*)/);
    return {
      level: m && m[1] !== "" ? m[1].trim() : null,
      layer: m && m[2] !== "To be voted" ? m[2].trim() : null,
    };
  }

  broadcast(message) {
    return this.execute(`AdminBroadcast ${message}`);
  }

  warn(anyID, message) {
    return this.execute(`AdminWarn "${anyID}" ${message}`);
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

  disbandSquad(teamID, squadID) {
    return this.execute(`AdminDisbandSquad "${teamID}" ${squadID}`);
  }
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
