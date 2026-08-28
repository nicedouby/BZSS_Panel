// -*- coding: utf-8 -*-

import { clamp, distance, resolveCoordinateScaleMeters } from "./geometry.js";

export function resolveLiveHotspot(players, options = {}) {
  const positions = [];
  for (const player of Array.isArray(players) ? players : []) {
    const health = finite(player?.telemetry?.health ?? player?.soldierInfo?.health);
    const inactive = player?.telemetry?.inactive === true
      || player?.inactive === true
      || String(player?.presence?.state ?? "").trim().toLowerCase() === "inactive";
    const noWorldPawn = [player?.presence?.state, player?.telemetry?.presenceHint]
      .map((value) => String(value ?? "").trim().toLowerCase())
      .some((value) => ["nopawn", "pendingdeployment"].includes(value));
    const onVehicle = player?.telemetry?.onVehicle === true || player?.vehicle?.onVehicle === true;
    if (!(health > 0) || inactive || noWorldPawn || onVehicle) continue;
    const teamId = normalizeTeamId(player?.match?.teamId ?? player?.teamId);
    if (!teamId) continue;
    const x = finite(player?.telemetry?.position?.x ?? player?.soldierInfo?.position?.x ?? player?.position?.x);
    const y = finite(player?.telemetry?.position?.y ?? player?.soldierInfo?.position?.y ?? player?.position?.y);
    if (x != null && y != null) {
      const identityKey = String(player?.identity?.key ?? player?.identity?.playerID ?? player?.playerId ?? "").trim();
      positions.push({
        x,
        y,
        teamId,
        key: identityKey || `player:${positions.length}`,
      });
    }
  }

  const coordinateScaleMeters = resolveCoordinateScaleMeters(options?.mapBounds, options?.coordinateScaleMeters);
  const referenceRadiusMeters = positive(options?.config?.referenceRadiusMeters, 1000);
  const minRadiusMeters = nonNegative(options?.config?.minRadiusMeters, 450);
  const maxRadiusMeters = Math.max(minRadiusMeters, nonNegative(options?.config?.maxRadiusMeters, 1600));
  const engagementRangeMeters = clamp(referenceRadiusMeters * 0.45, 250, 650);
  const pairs = [];
  const parents = positions.map((_, index) => index);

  const find = (index) => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = root;
      index = next;
    }
    return root;
  };
  const union = (leftIndex, rightIndex) => {
    const leftRoot = find(leftIndex);
    const rightRoot = find(rightIndex);
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot;
  };

  for (let leftIndex = 0; leftIndex < positions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < positions.length; rightIndex += 1) {
      const left = positions[leftIndex];
      const right = positions[rightIndex];
      if (left.teamId === right.teamId) continue;
      const separationMeters = distance(left, right) * coordinateScaleMeters;
      if (separationMeters > engagementRangeMeters) continue;
      pairs.push({
        leftIndex,
        rightIndex,
        left,
        right,
        separationMeters,
        center: { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 },
      });
      union(leftIndex, rightIndex);
    }
  }
  if (!pairs.length) return null;

  const pairsByCluster = new Map();
  for (const pair of pairs) {
    const key = find(pair.leftIndex);
    if (!pairsByCluster.has(key)) pairsByCluster.set(key, []);
    pairsByCluster.get(key).push(pair);
  }

  let best = null;
  for (const cluster of pairsByCluster.values()) {
    const engaged = new Map();
    let weightedX = 0;
    let weightedY = 0;
    let totalWeight = 0;
    let separationTotal = 0;
    for (const pair of cluster) {
      engaged.set(pair.left.key, pair.left);
      engaged.set(pair.right.key, pair.right);
      const weight = 1 + Math.max(0, 1 - (pair.separationMeters / engagementRangeMeters));
      weightedX += pair.center.x * weight;
      weightedY += pair.center.y * weight;
      totalWeight += weight;
      separationTotal += pair.separationMeters;
    }
    const score = (engaged.size * 1000) + (cluster.length * 10) - (separationTotal / cluster.length);
    if (!best || score > best.score) {
      best = {
        score,
        center: { x: weightedX / totalWeight, y: weightedY / totalWeight },
        engaged: [...engaged.values()],
        pairCount: cluster.length,
      };
    }
  }

  const spreadMeters = Math.max(
    0,
    ...best.engaged.map((player) => distance(best.center, player) * coordinateScaleMeters),
  );
  return {
    x: best.center.x,
    y: best.center.y,
    radiusMeters: clamp(spreadMeters + 125, minRadiusMeters, maxRadiusMeters),
    playerCount: best.engaged.length,
    pairCount: best.pairCount,
    positionSource: "opposing-player-engagement-cluster",
  };
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeTeamId(value) {
  const numeric = Number(value);
  return numeric === 1 || numeric === 2 ? numeric : null;
}

function positive(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function nonNegative(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
}
