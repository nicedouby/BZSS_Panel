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
      isLocked: normalizeLockState(objective?.isLocked ?? objective?.locked),
      topologyIndex: index,
    };
  }).filter(Boolean);
}

export function normalizeObjectiveOwnership(objectiveState, chain) {
  const byId = new Map();
  if (Array.isArray(objectiveState)) {
    for (const item of objectiveState) {
      const id = String(item?.id ?? item?.name ?? "").trim();
      if (id) byId.set(id, normalizeObjectiveState(item));
    }
  } else if (objectiveState && typeof objectiveState === "object") {
    for (const [id, state] of Object.entries(objectiveState)) {
      byId.set(String(id), normalizeObjectiveState(state));
    }
  }
  return chain.map((objective) => {
    const state = byId.get(objective.id);
    return {
      ...objective,
      ownerTeamId: state
        ? state.ownerTeamId
        : normalizeTeamId(objective.ownerTeamId ?? objective.teamId ?? objective.owner),
      isLocked: state?.isLocked ?? normalizeLockState(objective.isLocked ?? objective.locked),
    };
  });
}

export function resolveCombatPair(objectiveChain, objectiveState) {
  const chain = normalizeObjectiveOwnership(objectiveState, normalizeObjectiveChain(objectiveChain));
  const team1Front = [...chain].reverse().find((objective) => objective.ownerTeamId === 1) ?? null;
  const team2Front = chain.find((objective) => objective.ownerTeamId === 2) ?? null;
  const candidates = [];
  for (let index = 0; index < chain.length - 1; index += 1) {
    if (chain[index].ownerTeamId === 1 && chain[index + 1].ownerTeamId === 2) {
      candidates.push({
        pointA: chain[index],
        pointB: chain[index + 1],
        leftIndex: index,
        rightIndex: index + 1,
        unlockedCount: Number(chain[index].isLocked === false) + Number(chain[index + 1].isLocked === false),
      });
    }
  }
  candidates.sort((left, right) => right.unlockedCount - left.unlockedCount);
  let pair = candidates[0] ?? null;

  // Ownership can lag by one scene frame while AAS/RAAS unlock state already
  // identifies the active pair. Prefer two adjacent unlocked flags as a safe
  // fallback instead of treating a locked objective as the live front.
  if (!pair) {
    for (let index = 0; index < chain.length - 1; index += 1) {
      if (chain[index].isLocked === false && chain[index + 1].isLocked === false) {
        pair = {
          pointA: chain[index],
          pointB: chain[index + 1],
          leftIndex: index,
          rightIndex: index + 1,
          unlockedCount: 2,
        };
        break;
      }
    }
  }
  return {
    chain,
    team1Front,
    team2Front,
    pair,
    adjacent: Boolean(pair && pair.rightIndex === pair.leftIndex + 1),
  };
}

function normalizeObjectiveState(value) {
  if (value && typeof value === "object") {
    return {
      ownerTeamId: normalizeTeamId(value.teamId ?? value.ownerTeamId ?? value.owner),
      isLocked: normalizeLockState(value.isLocked ?? value.locked),
    };
  }
  return { ownerTeamId: normalizeTeamId(value), isLocked: null };
}

function normalizeLockState(value) {
  if (value === true || value === false) return value;
  const text = String(value ?? "").trim().toLowerCase();
  if (["true", "1", "yes", "locked"].includes(text)) return true;
  if (["false", "0", "no", "unlocked"].includes(text)) return false;
  return null;
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
