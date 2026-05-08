// -*- coding: utf-8 -*-

export function createPointsModule() {
  const points = new Map();

  return {
    manifest: { id: "module.points", name: "Points Module", kind: "module", version: "0.1.0", description: "玩家积分系统模块。提供 getPoints(playerId) 查询和 addPoints(playerId, amount) 添加两个基础接口，内存中维护每位玩家的积分。其他插件（如击杀奖励、种子签到）通过调用此模块 API 来发放或扣除积分，后续可对接数据库实现持久化。" },
    apiName: "points",
    api: {
      getPoints(playerId) { return points.get(playerId) ?? 0; },
      addPoints(playerId, amount) {
        const next = (points.get(playerId) ?? 0) + Number(amount);
        points.set(playerId, next);
        return next;
      },
    },
  };
}
