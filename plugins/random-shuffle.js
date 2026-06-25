// -*- coding: utf-8 -*-

const PLUGIN_ID = "random-shuffle";

export function createPlugin({ core, modules, logger } = {}) {
  const pluginLogger =
    logger ??
    core?.createLogger?.({ moduleId: PLUGIN_ID, source: PLUGIN_ID, channel: "plugin" }) ??
    core?.logger ??
    console;

  const api = {
    async generatePlan(request = {}) {
      const serverId = String(request.serverId || "1");
      const allPlayers = modules?.playerState?.getPlayerList?.(serverId) || [];
      const activePlayers = allPlayers.filter(
        (p) => String(p.teamID) === "1" || String(p.teamID) === "2"
      );

      const playtimeMap = new Map();
      await Promise.all(
        activePlayers.map(async (p) => {
          try {
            const pt = await modules?.playtime?.getBySteamID?.(p.steamID);
            const s = pt?.gameSeconds ?? pt?.game_seconds;
            playtimeMap.set(p.steamID, s != null ? Math.max(0, Math.floor(Number(s) || 0)) : 0);
          } catch {
            playtimeMap.set(p.steamID, 0);
          }
        })
      );

      const groupsSnapshot = core?.groupReport?.getSnapshot?.()?.groups || [];
      const groupMap = new Map();
      for (const group of groupsSnapshot) {
        for (const member of group.members) {
          if (member.steamId) groupMap.set(member.steamId, group.id);
        }
      }

      const units = [];
      const processedSteamIds = new Set();

      for (const player of activePlayers) {
        if (processedSteamIds.has(player.steamID)) continue;

        const groupId = groupMap.get(player.steamID);
        if (groupId) {
          const members = activePlayers.filter((p) => groupMap.get(p.steamID) === groupId);
          members.forEach((m) => processedSteamIds.add(m.steamID));

          units.push({
            id: groupId,
            type: "group",
            players: members,
            size: members.length,
            totalPlaytime: members.reduce((sum, m) => sum + (playtimeMap.get(m.steamID) || 0), 0),
            currentTeam: members[0].teamID,
          });
        } else {
          processedSteamIds.add(player.steamID);
          units.push({
            id: player.steamID,
            type: "solo",
            players: [player],
            size: 1,
            totalPlaytime: playtimeMap.get(player.steamID) || 0,
            currentTeam: player.teamID,
          });
        }
      }

      units.sort(() => Math.random() - 0.5);
      units.sort((a, b) => b.size - a.size);

      const team1 = { count: 0, playtime: 0, units: [] };
      const team2 = { count: 0, playtime: 0, units: [] };

      for (const unit of units) {
        const t1Count = team1.count + unit.size;
        const t2Count = team2.count + unit.size;
        const countDiff1 = Math.abs(t1Count - team2.count);
        const countDiff2 = Math.abs(team1.count - t2Count);

        let assignTo = 1;
        if (countDiff1 < countDiff2) {
          assignTo = 1;
        } else if (countDiff2 < countDiff1) {
          assignTo = 2;
        } else {
          const t1Playtime = team1.playtime + unit.totalPlaytime;
          const t2Playtime = team2.playtime + unit.totalPlaytime;
          const ptDiff1 = Math.abs(t1Playtime - team2.playtime);
          const ptDiff2 = Math.abs(team1.playtime - t2Playtime);

          if (Math.abs(ptDiff1 - ptDiff2) < 3600) {
            assignTo = String(unit.currentTeam) === "2" ? 2 : 1;
          } else if (ptDiff1 < ptDiff2) {
            assignTo = 1;
          } else {
            assignTo = 2;
          }
        }

        if (assignTo === 1) {
          team1.count += unit.size;
          team1.playtime += unit.totalPlaytime;
          team1.units.push(unit);
        } else {
          team2.count += unit.size;
          team2.playtime += unit.totalPlaytime;
          team2.units.push(unit);
        }
      }

      const planResult = {
        team1: { players: [], count: team1.count, playtimeHours: team1.playtime / 3600 },
        team2: { players: [], count: team2.count, playtimeHours: team2.playtime / 3600 },
        switches: [],
        timestamp: Date.now(),
      };

      function processTeam(teamUnits, targetTeamID, planTeam) {
        for (const unit of teamUnits) {
          for (const player of unit.players) {
            const willSwitch = String(player.teamID) !== String(targetTeamID);
            const playerInfo = {
              name: player.name,
              steamId: player.steamID,
              currentTeam: player.teamID,
              targetTeam: String(targetTeamID),
              willSwitch,
              playtimeHours: (playtimeMap.get(player.steamID) || 0) / 3600,
              unitType: unit.type,
            };
            planTeam.players.push(playerInfo);
            if (willSwitch) {
              planResult.switches.push(playerInfo);
            }
          }
        }
      }

      processTeam(team1.units, 1, planResult.team1);
      processTeam(team2.units, 2, planResult.team2);

      return planResult;
    },

    async executePlan(request = {}) {
      const switches = request.switches || [];
      if (!Array.isArray(switches) || switches.length === 0) {
        return { success: true, count: 0, results: [] };
      }

      const concurrency = 5;
      const results = [];
      const executing = new Set();
      const operator = request.viewer || request.operator || null;

      for (const sw of switches) {
        if (!sw.steamId) continue;
        const task = async () => {
          try {
            const res = await modules?.teamBalance?.forceTeamChange?.({
              steamId: sw.steamId,
              system: true,
              reason: "random_shuffle",
              operator,
            });
            return { steamId: sw.steamId, success: res?.ok ?? false, message: res?.message ?? "" };
          } catch (err) {
            return { steamId: sw.steamId, success: false, message: String(err) };
          }
        };

        const p = task().then((res) => {
          executing.delete(p);
          results.push(res);
        });
        executing.add(p);

        if (executing.size >= concurrency) {
          await Promise.race(executing);
        }
      }

      await Promise.all(executing);
      return { success: true, count: results.length, results };
    },
  };

  return {
    manifest: {
      id: PLUGIN_ID,
      name: "随机打乱",
      kind: "plugin",
      version: "1.0.0",
      description: "基于抱团报备和游戏时长的随机打乱插件，提供一键换队功能。",
    },
    apiName: "randomShuffle",
    api,
    async init() {},
    async start() {
      core.randomShuffle = api;
      core.webRegistry?.registerPage?.({
        id: "web.randomShuffle",
        title: "随机打乱",
        group: "插件",
        route: "/plugins/random-shuffle",
        pageModule: "/pages/RandomShufflePage.vue",
        source: PLUGIN_ID,
        description: "生成并执行基于抱团报备的随机打乱跳边方案。",
        required: false,
        enabled: true,
        order: 530,
        icon: "Shuffle",
      });
      pluginLogger?.info?.("[RandomShuffle] Plugin started.");
    },
    async stop() {
      if (core.randomShuffle === api) {
        delete core.randomShuffle;
      }
      pluginLogger?.info?.("[RandomShuffle] Plugin stopped.");
    },
  };
}
