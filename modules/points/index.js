// -*- coding: utf-8 -*-

export function createPointsModule() {
  const points = new Map();

  return {
    manifest: { id: "module.points", name: "Points Module", kind: "module", version: "0.1.0" },
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
