import fs from 'fs';
const file = 'd:\\\\BZSS_Panel\\\\modules\\\\match-state\\\\index.js';
let content = fs.readFileSync(file, 'utf8');

const regex = /  function enrichPlayersWithMatchPresence\(serverId, players\) \{\r?\n    const list = Array\.isArray\(players\) \? players : \[\];\r?\n    const getPlayer = modules\?\.matchPlayerPresence\?\.getPlayer;\r?\n/m;

const replacement = `  function enrichPlayersWithMatchPresence(serverId, players) {
    const list = Array.isArray(players) ? players : [];
    const getPlayer = modules?.matchPlayerPresence?.getPlayer;
    const findPlayerState = modules?.playerState?.findPlayer;
    const getPlayerStats = modules?.networkStats?.getPlayerStats;
    const bzssFindPlayer = modules?.bzssCoreMonitor?.findPlayer;

    if (
      typeof getPlayer !== "function" &&
      typeof findPlayerState !== "function" &&
      typeof getPlayerStats !== "function" &&
      typeof bzssFindPlayer !== "function"
    ) {
      return list;
    }

    const serverKey = String(serverId ?? core.webStatus.serverId ?? "").trim();
    return list.map((player) => {
      const presence = typeof getPlayer === "function" ? getPlayer(player, serverKey) : null;
      const playerState = typeof findPlayerState === "function" ? findPlayerState(serverKey, player) : null;
      const netStats = typeof getPlayerStats === "function" && player.steamID ? getPlayerStats(player.steamID) : null;
      const bzssPlayer = typeof bzssFindPlayer === "function" && player.name ? bzssFindPlayer({ name: player.name }) : null;
      if (!presence && !playerState && !netStats && !bzssPlayer) return player;

      const finalPing = bzssPlayer?.ping != null ? bzssPlayer.ping : netStats?.ping;

      return {
        ...player,
        ...(playerState ? {
          squadlessSince: String(playerState.squadlessSince ?? ""),
          squadlessSeconds: Number(playerState.squadlessSeconds ?? 0),
          firstSeenAt: String(playerState.firstSeenAt ?? ""),
          lastSquadChangeAt: String(playerState.lastSquadChangeAt ?? ""),
          squadJoinedAt: String(playerState.squadJoinedAt ?? ""),
          squadLeftAt: String(playerState.squadLeftAt ?? ""),
          lastSeenTime: String(playerState.lastSeenTime ?? ""),
          state: String(playerState.state ?? ""),
        } : {}),
        ...(presence ? {
          matchOnlineSeconds: Math.floor(Number(presence.matchOnlineMs ?? 0) / 1000),
          matchObservedOnlineSeconds: Number(presence.matchObservedOnlineSeconds ?? 0),
          matchEstimatedOnlineSeconds: Number(presence.matchEstimatedOnlineSeconds ?? 0),
          matchFirstSeenAt: String(presence.matchFirstSeenAt ?? ""),
          matchLastSeenAt: String(presence.matchLastSeenAt ?? ""),
          matchJoinCount: Number(presence.matchJoinCount ?? 0),
        } : {}),
        ...(finalPing != null || netStats ? {
          ping: finalPing,
          packetLoss: netStats?.packetLoss,
        } : {}),
      };
    });
  }
`;

if (regex.test(content)) {
  fs.writeFileSync(file, content.replace(regex, replacement));
  console.log('Replaced successfully');
} else {
  console.log('Target not found');
}
