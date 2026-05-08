// -*- coding: utf-8 -*-

export function createPlaytimeModule() {
  return {
    manifest: { id: "module.playtime", name: "Playtime Module", kind: "module", version: "0.1.0", description: "玩家在线时长追踪模块。记录玩家连接至断开的时长，为积分系统、种子奖励、玩家活跃度分析提供基础时长数据。目前以骨架形态存在（接口预留），后续扩展可对接数据库以实现跨赛季时长累计。" },
    apiName: "playtime",
    api: {
      async getPlaytime() { return null; },
    },
  };
}
