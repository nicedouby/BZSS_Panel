// -*- coding: utf-8 -*-

export function normalizeObjectiveChain(value = []) {
  return (Array.isArray(value) ? value : []).map((objective, index) => {
    const x = finiteNumber(objective?.x ?? objective?.position?.x);
    const y = finiteNumber(objective?.y ?? objective?.position?.y);
    if (x == null || y == null) return null;
    const id = String(objective?.id ?? objective?.name ?? `p${index + 1}`).trim() || `p${index + 1}`;
    return {
      ...objective,
      id,
      name: String(objective?.name ?? id).trim() || id,
      x,
      y,
      topologyIndex: index,
    };
  }).filter(Boolean);
}

export function normalizeObjectiveOwnership(objectiveState, chain) {
  const byId = new Map();
  if (Array.isArray(objectiveState)) {
    for (const item of objectiveState) {
      const id = String(item?.id ?? item?.name ?? "").trim();
      if (id) byId.set(id, normalizeTeamId(item?.teamId ?? item?.ownerTeamId ?? item?.owner));
    }
  } else if (objectiveState && typeof objectiveState === "object") {
    for (const [id, state] of Object.entries(objectiveState)) {
      const owner = state && typeof state === "object"
        ? state.teamId ?? state.ownerTeamId ?? state.owner
        : state;
      byId.set(String(id), normalizeTeamId(owner));
    }
  }
  return chain.map((objective) => ({
    ...objective,
    ownerTeamId: byId.has(objective.id)
      ? byId.get(objective.id)
      : normalizeTeamId(objective.ownerTeamId ?? objective.teamId ?? objective.owner),
  }));
}

export function resolveCombatPair(objectiveChain, objectiveState) {
  const chain = normalizeObjectiveOwnership(objectiveState, normalizeObjectiveChain(objectiveChain));
  const team1Front = [...chain].reverse().find((objective) => objective.ownerTeamId === 1) ?? null;
  const team2Front = chain.find((objective) => objective.ownerTeamId === 2) ?? null;
  let pair = null;
  for (let index = 0; index < chain.length - 1; index += 1) {
    if (chain[index].ownerTeamId === 1 && chain[index + 1].ownerTeamId === 2) {
      pair = { pointA: chain[index], pointB: chain[index + 1], leftIndex: index, rightIndex: index + 1 };
      break;
    }
  }
  return {
    chain,
    team1Front,
    team2Front,
    pair,
    adjacent: Boolean(pair),
  };
}

function normalizeTeamId(value) {
  const numeric = Number(value);
  return numeric === 1 || numeric === 2 ? numeric : null;
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
