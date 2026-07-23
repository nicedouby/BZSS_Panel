// -*- coding: utf-8 -*-

export function buildWeightedSquadVote({ teamPlayerCount = 0, squadSnapshots = [], initiatorKey = "", targetKey = "" } = {}) {
  const eligibleVoters = new Map();
  let yesWeight = 0; let noWeight = 0;
  for (const squad of squadSnapshots) {
    const weight = Math.max(0, Number(squad.weight ?? squad.memberPlayerKeys?.length) || 0);
    const key = String(squad.leaderPlayerKey || "");
    if (key === initiatorKey) yesWeight += weight;
    else if (key === targetKey) noWeight += weight;
    else if (key) eligibleVoters.set(key, { ...squad, weight, ballot: null });
  }
  return { teamPlayerCount: Math.max(0, Number(teamPlayerCount) || 0), yesWeight, noWeight, eligibleVoters, ballots: new Map() };
}

export function castWeightedBallot(vote, playerKey, choice) {
  const voter = vote?.eligibleVoters?.get?.(playerKey); if (!voter) return { ok: false, error: "NotEligible" };
  if (vote.ballots.has(playerKey)) return { ok: false, error: "AlreadyVoted" };
  const normalized = Number(choice); if (normalized !== 1 && normalized !== 2) return { ok: false, error: "InvalidChoice" };
  voter.ballot = normalized; vote.ballots.set(playerKey, normalized);
  if (normalized === 1) vote.yesWeight += voter.weight; else vote.noWeight += voter.weight;
  return { ok: true, weight: voter.weight, choice: normalized };
}

export function evaluateWeightedVote(vote) {
  const denominator = Math.max(0, Number(vote?.teamPlayerCount) || 0);
  if (vote?.yesWeight * 2 > denominator) return "passed";
  let remaining=0; for (const voter of vote?.eligibleVoters?.values?.() ?? []) if (!voter.ballot) remaining += voter.weight;
  return ((Number(vote?.yesWeight)||0)+remaining)*2<=denominator ? "failed" : "pending";
}
