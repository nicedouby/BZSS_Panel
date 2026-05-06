// -*- coding: utf-8 -*-

/**
 * Core: WebStatus
 *
 * 顶部状态栏的全局状态源。
 *
 * 所有页面顶部都显示这里的数据。
 */
export class WebStatus {
  constructor({ config }) {
    this.serverId = config.get("server.id", "BZSS_Main");
    this.serverName = config.get("server.name", "BZSS Main Server");

    this.state = {
      serverId: this.serverId,
      serverName: this.serverName,

      jsStarted: true,
      pythonLogParser: "unknown",
      udpReceiver: "unknown",
      rcon: "disabled",

      currentLayer: "Unknown",
      matchState: "Unknown",
      playerCount: 0,
      team1Count: 0,
      team2Count: 0,
      squadCount: 0,

      rconQueue: 0,
      recentErrors: 0,

      updatedAt: new Date().toISOString(),
    };
  }

  set(key, value) {
    this.state[key] = value;
    this.state.updatedAt = new Date().toISOString();
  }

  patch(patch) {
    Object.assign(this.state, patch);
    this.state.updatedAt = new Date().toISOString();
  }

  getSnapshot() {
    return { ...this.state };
  }
}
